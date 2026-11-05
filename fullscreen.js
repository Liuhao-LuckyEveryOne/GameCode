'use strict';
/**
 * 像素街机厅公共全屏控制库
 * 提供全屏切换按钮逻辑，并在进入/退出全屏时将游戏区域等比缩放至
 * 完整落入视口（可放大也可缩小）并居中，保证不超出屏幕、不出现滚动条
 * 各页面（大厅与游戏页）通过 <button id="fullscreenToggle" onclick="FS.toggle(this)"> 引入使用；
 * 按钮文案为"动作提示"语义并以「·」分隔：未全屏显示「全屏 · 开」（提示可开启）、全屏中显示「全屏 · 关」（提示可关闭），
 * 并支持全局快捷键 F 切换（与音效 M 键同模式：
 * 捕获阶段监听防游戏侧拦截，输入场景不占用，嵌入模式转发父页统一处理）
 * 另承担"返回游戏厅"的退出演出：独立打开时先播 CRT 关机动画（整页坍缩熄灭）再导航，
 * 嵌入时转发父页由大厅播放关机演出（initStandaloneExit / initEmbed）
 *
 * 全屏切换附带过渡演出（感知强化版）：全视口 CRT 通电闪白脉冲（径向辉光 0.42s 快闪）
 * + 游戏区提亮聚焦（轻内容时 brightness 1.45→1 先行回落，含 iframe/Canvas 自动跳过）
 * + 平滑缩放（进入 0.5s / 退出 0.45s easeOutQuint），
 * 多重动效同步推进；标题以淡入衔接定位切换；过渡期间抑制 resize 重算防止动画被打断
 *
 * 嵌入模式（?embed=1）：页面作为大厅的 iframe 子页运行时，
 * 全屏状态统一由大厅（顶层文档）持有，子页通过 postMessage 与父页通信：
 *   子 → 父：{ type:'arcade:fs' }    请求切换全屏（等价于父页点击其全屏按钮）
 *   子 → 父：{ type:'arcade:exit' }  请求关闭覆盖层（"← 游戏厅"链接被拦截转发）
 *   子 → 父：{ type:'arcade:hello' } 子页就绪报到，父页回复当前全屏状态
 *   父 → 子：{ type:'arcade:fs', fs:boolean } 广播全屏状态（含切换与回复）
 * 由此保证"大厅 ↔ 各游戏"之间全屏状态无缝保持，退出亦全局生效
 */
const FS = (() => {
    /** 全屏时需要缩放的游戏区域选择器（依次匹配第一个命中的元素） */
    const FIT_SELECTORS = ['.layout', '#gameContainer'];

    /** 全屏时需要展示的游戏名称标题选择器（依次匹配第一个命中的元素）：
     *  游戏页为 h1.title，游戏厅大厅为 h1.arcade-title */
    const TITLE_SELECTORS = ['h1.title', 'h1.arcade-title'];

    /** 顶部安全高度（px）：右上角固定的音效/全屏按钮实际占到约 88px
     *  （FULLSCREEN 按钮底缘 = top 60 + 高约 28），取 104px 留出缓冲；
     *  全屏缩放与居中均限制在按钮下方的剩余视口内，
     *  保证任何分辨率下游戏区/说明区都不会覆盖这两个固定按钮 */
    const TOP_SAFE = 104;

    /** 嵌入模式标记：URL 携带 ?embed=1 且确实运行于 iframe 之中 */
    const EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
    /** 消息投递目标：file:// 直开时各帧为独立 opaque origin，需回退 '*' 维持跨帧通信；http(s) 同源部署收紧为 '/'（仅同源可投） */
    const POST_MSG_TARGET = (location.protocol === 'file:') ? '*' : '/';

    /** 用户系统偏好"减少动态效果"：为 true 时跳过全屏过渡动画（无障碍适配） */
    const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /** 最近一次同步的全屏态：供窗口尺寸变化时按当前状态重算缩放（嵌入模式下无法实时读取文档全屏态） */
    let lastFs = false;

    /** 全屏过渡动画进行中标志：期间抑制 resize 重算，防止视口变化事件把进行中的过渡打断成瞬移落位 */
    let fsBusy = false;

    /** 上一次过渡的清理上下文（监听器与兜底定时器）：连续快速切换时作废旧清理，防止旧定时器误清新过渡 */
    let fsPrevClear = null;

    /**
     * 当前是否处于全屏状态（含 Safari 旧版 webkit 前缀兼容）
     * @returns {boolean} 全屏中返回 true
     */
    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    /**
     * 对指定元素发起全屏请求（含 webkit 前缀兼容）
     * @param {HTMLElement} el 目标元素（整个页面文档根元素）
     * @returns {Promise<void>} 全屏请求 Promise
     */
    function request(el) {
        if (el.requestFullscreen) return el.requestFullscreen();
        if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
        return Promise.reject(new Error('当前浏览器不支持全屏 API'));
    }

    /**
     * 退出全屏（含 webkit 前缀兼容）
     * @returns {Promise<void>} 退出请求 Promise
     */
    function exit() {
        if (document.exitFullscreen) return document.exitFullscreen();
        if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
        return Promise.reject(new Error('当前浏览器不支持全屏 API'));
    }

    /**
     * 查找页面游戏名称标题元素（游戏页为 h1.title，大厅为 h1.arcade-title）
     * @returns {HTMLElement|null} 标题元素；无标题页面返回 null
     */
    function findTitle() {
        for (const sel of TITLE_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    /**
     * 全屏缩放前将位于缩放容器内部的标题搬移到 body 末尾
     * 原因：容器获得 transform 后会成为 fixed 后代的包含块，
     * 若标题留在容器内，其 fixed 顶部锚定将随容器变换而错位；
     * 搬出后标题 fixed 锚定视口，且容器测量高度不再含标题占位，
     * 居中计算一次到位。幂等：已搬出（__fsRef 存在）时跳过
     * @param {HTMLElement|null} title 标题元素
     */
    function detachTitleDom(title) {
        if (!title || title.__fsRef) return;
        title.__fsRef = title.nextSibling; // 记住原位锚点，还原时插回
        if (title.parentNode) title.parentNode.removeChild(title);
        document.body.appendChild(title);
    }

    /**
     * 将标题搬回其在文档流中的原位（配合 detachTitleDom 使用）
     * 应在清除标题 fixed 内联样式之后调用，避免搬回瞬间的定位跳变
     * @param {HTMLElement|null} title 标题元素
     */
    function restoreTitleDom(title) {
        if (!title) return;
        if (title.__fsRef && title.__fsRef.parentNode) {
            title.__fsRef.parentNode.insertBefore(title, title.__fsRef);
        }
        title.__fsRef = null;
    }

    /**
     * 检测页面是否声明"全屏时标题保留在内容流中"（页面级差异性行为）
     * body 带 data-fs-keep-title 属性即声明：标题（及其副标题等兄弟元素）
     * 不搬出缩放容器、不做 fixed 顶部锚定，而是随内容区整体缩放居中，
     * 保证"副标题 + 主标题 + 卡片"的相对展示关系与非全屏完全一致；
     * 未声明的页面（各游戏页）保持原行为：标题放大展示于顶部安全区中央
     * @returns {boolean} 页面声明保留标题时返回 true
     */
    function keepTitleInFlow() {
        return !!(document.body && document.body.hasAttribute('data-fs-keep-title'));
    }

    let flashLayer = null; // CRT 闪白覆盖层单例：首次使用时惰性创建，之后常驻复用（opacity 0 隐藏、不挡交互）
    let flashAnim = null; // 当前闪白动画引用：连续快速切换时取消上一次，防止两次闪白叠加过曝

    /**
     * CRT 通电闪白：全视口径向白辉光快闪一次，作为进入/退出全屏的"电源脉冲"
     * 过渡感知的主要来源——嵌入（大厅持全屏）等缩放位移较小的场景，
     * 缩放本身观感微弱，闪白保证切换瞬间始终有明确的视觉回应；
     * 嵌入子页跳过：全屏由顶层大厅持有，闪白由顶层播放一次即可，避免与 iframe 内叠加双重闪
     * 实现要点（针对"白光闪到一半卡住"的修复）：
     * ① 覆盖层单例复用——首次创建后常驻，避免每次切换都"建元素 + 首次光栅化"
     *   与全屏过渡首帧竞争，导致闪白中途掉帧顿挫；
     * ② rAF 错帧启动——全屏切换当帧浏览器忙于视口 resize 与合成层重建，
     *   错开一帧后覆盖层已稳定合成，opacity 动画全程由合成线程平滑推进；
     * ③ 曲线放缓——30% 处（约 126ms）才达峰值、尾部 ease-in 收敛，快闪但不"砸白"
     * @param {number} strength 闪白峰值透明度（0~1）：进入全屏传 0.5（通电感强），退出传 0.32（稍弱区分）
     */
    function crtFlash(strength) {
        if (EMBED || REDUCED) return;
        if (!flashLayer) {
            flashLayer = document.createElement('div');
            // 全视口固定层：径向白辉光（中心亮、四角渐隐，模拟显像管辉光），不拦截任何交互
            flashLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0;' +
                'background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.95) 0%,' +
                'rgba(255,255,255,0.4) 55%, rgba(255,255,255,0) 85%)';
            document.body.appendChild(flashLayer);
        }
        if (flashAnim) flashAnim.cancel(); // 上一次闪白未播完就再次切换：取消旧动画直接重闪
        // 错帧启动：等下一帧覆盖层已稳定合成再开 opacity 动画，避开切换首帧的渲染高峰；
        // 取消动作补挂到回调首行——flashAnim 要等本回调才赋值，同帧内二次触发时外部读到的仍是旧值，
        // 这里按 rAF 注册顺序先 cancel 上一支刚创建（尚未赋值回去）的动画，确保同一时刻只有一支闪白存续
        requestAnimationFrame(() => {
            if (flashAnim) flashAnim.cancel();
            flashAnim = flashLayer.animate([
                { opacity: 0 },
                { opacity: strength, offset: 0.3, easing: 'ease-out' },
                { opacity: 0, easing: 'ease-in' }
            ], { duration: 420 });
        });
    }

    /**
     * 过渡结束后清理全屏缩放容器的内联 transition、filter 与 will-change，并解除 resize 抑制
     * 双保险设计：transitionend 正常触发时立即清理；transform 值未实际变化
     * （无过渡发生）或事件丢失时由超时兜底，确保内联样式不残留；
     * 连续快速切换全屏时先作废旧清理上下文，避免旧定时器/监听误伤新过渡
     * @param {HTMLElement} target 全屏缩放容器元素
     */
    function clearFsTransition(target) {
        if (fsPrevClear) { // 上一次清理仍在挂起：作废之，其过渡样式由本次新过渡接管
            clearTimeout(fsPrevClear.timer);
            target.removeEventListener('transitionend', fsPrevClear.onEnd);
        }
        let done = false;
        function finish() {
            if (done) return;
            done = true;
            clearTimeout(timer);
            target.removeEventListener('transitionend', onEnd);
            fsPrevClear = null;
            target.style.transition = '';
            target.style.filter = ''; // 同步清除"聚焦提亮"内联残留
            target.style.willChange = ''; // 移除合成层预提升标记，交还浏览器自行管理
            fsBusy = false; // 过渡结束：解除 resize 重算抑制
        }
        function onEnd(e) {
            // 只认缩放容器自身的 transform 过渡结束（transitionend 会冒泡，子元素过渡不误清）
            if (e.target === target && e.propertyName === 'transform') finish();
        }
        target.addEventListener('transitionend', onEnd);
        const timer = setTimeout(finish, 650); // 兜底收尾上限，略大于 0.5s 过渡时长
        fsPrevClear = { timer: timer, onEnd: onEnd };
    }

    /**
     * 按全屏态适配游戏名称标题展示
     * 全屏时将标题以 position:fixed 锚定视口、展示于顶部安全区中央
     * （音效/全屏按钮位于右上角，标题居中互不重叠），缩放比优先与游戏区
     * 保持一致（各页视觉比例统一），但不超过安全区高度；
     * fixed 定位不依赖布局测量，与页面内联的舞台缩放逻辑（如华容道 fitStage）
     * 无时序竞态；退出全屏时清除全部内联样式，还原文档流原貌
     * @param {HTMLElement|null} title 标题元素（可为 null，无标题页面直接返回）
     * @param {boolean} on 目标全屏状态（true=适配安全区展示，false=还原）
     * @param {number} gameScale 游戏区的等比缩放比（无游戏区时传 0，仅按安全区约束缩放）
     * @param {boolean} [animate] 是否播标题淡入动画（衔接"文档流 ↔ fixed 安全区"的定位跳变；
     *                            仅全屏真切换的动画路径为 true，resize 重算传 false 不播）
     */
    function applyTitleFs(title, on, gameScale, animate) {
        if (!title) return;
        if (!on) {
            title.style.position = '';
            title.style.left = '';
            title.style.top = '';
            title.style.margin = '';
            title.style.transform = '';
            title.style.zIndex = '';
            title.style.whiteSpace = '';
            // 还原落位后淡入一次，掩盖"fixed 安中区 → 文档流原位"的定位跳变
            if (animate) title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
            return;
        }
        // 先落位 fixed + 单行约束、再测量：标题刚从缩放容器搬出时仍是块级布局，
        // offsetWidth 为全容器宽（而非标题内容宽），直接测量会让宽度约束严重失真，
        // 把本应放大的标题错误压小；落位后 offsetWidth/offsetHeight 即收缩为
        // 最终展示布局的真实尺寸（offset 系列不受 transform 影响，规避动画竞态）
        title.style.position = 'fixed';
        title.style.left = '50%';
        title.style.top = (TOP_SAFE / 2) + 'px';
        title.style.margin = '0';
        title.style.whiteSpace = 'nowrap'; // fixed 收缩宽度后防止长标题折行
        // 标题自身布局高（offsetHeight 不受祖先 transform 影响，规避测量竞态）
        const h = title.offsetHeight || 40;
        // 缩放比：与游戏区同比（视觉统一），但以"安全区高度留 16px 上下缓冲"封顶
        let titleScale = Math.max(0.1, Math.min(gameScale || Infinity, (TOP_SAFE - 16) / h));
        // 宽度约束：缩放后标题右缘不得进入右上角固定按钮区（按钮左缘再留 8px 间隙），
        // 防止窄视口下放大后的长标题（如大厅"像素街机厅"）与音效/全屏按钮相互覆盖
        const fsBtn = document.getElementById('fullscreenToggle');
        if (fsBtn) {
            // 视口中线到按钮左缘的可用半宽（按钮为 fixed 定位，全屏时恒贴视口右上角）
            const gapToBtn = fsBtn.getBoundingClientRect().left - 8 - window.innerWidth / 2;
            // 标题未缩放布局半宽（offsetWidth 同样不受 transform 影响）
            const halfW = (title.offsetWidth || 0) / 2;
            if (halfW > 0 && gapToBtn > 0) titleScale = Math.min(titleScale, gapToBtn / halfW);
        }
        // fixed 锚定视口：水平锚点视口中线、垂直锚点安全区中线，
        // 配合 translate(-50%,-50%) 围绕自身中心精确居中，scale 围绕中心不破坏居中。
        // 需以 !important 写入：标题的 glitch 故障动画（titleGlitch keyframes）会动画 transform，
        // CSS 级联中普通内联声明优先级低于动画，会被动画覆盖导致全屏瞬间跳回未缩放错位态；
        // !important 声明优先级高于动画，可压制其 transform 而保留 filter 扫描线视觉效果
        title.style.setProperty('transform', 'translate(-50%, -50%) scale(' + titleScale + ')', 'important');
        title.style.zIndex = '5'; // 悬于游戏区之上，但低于音效/全屏固定按钮（z-index 10）
        // 展示落位后淡入，避免标题从文档流原位"瞬移"到安全区的跳变感
        if (animate) title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out' });
    }

    /**
     * 按传入的全屏态缩放/还原游戏区域
     * 全屏时将游戏区域等比缩放至完整落入视口（可放大也可缩小），
     * 并整体平移至视口正中，确保游戏区高度绝不超过屏幕、不产生滚动条；
     * 同时隐藏文档滚动条，退出全屏时全部还原；
     * 游戏名称标题：默认移至顶部安全区中央展示（与按钮互不覆盖）；
     * 声明 data-fs-keep-title 的页面（如大厅页）不进入本分支的标题处理，标题随内容流整体缩放
     * @param {boolean} on 目标全屏状态（true=适配屏幕，false=还原）
     * @param {boolean} [animate] 是否播放入场/退场过渡动画（仅全屏真切换时为 true；resize 重算传 false）
     */
    function applyFsScale(on, animate) {
        // 依次查找游戏区域元素，命中第一个选择器即止（现有页面均有 .layout；#gameContainer 仅为无 .layout 页面的兜底）
        let target = null;
        for (const sel of FIT_SELECTORS) {
            target = document.querySelector(sel);
            if (target) break;
        }
        // 游戏名称标题：按页面声明分流——声明 data-fs-keep-title 的页面（大厅）
        // 标题留在内容流中随 .layout 整体缩放；其余页面全屏时统一展示于顶部安全区中央
        const title = findTitle();
        if (!on) {
            // 非全屏：还原缩放、缩放基点、标题与滚动条设置
            if (target) {
                // 切换瞬间平滑缩回原位（easeOutQuint 缓出收尾）；resize 等重算路径直接还原不播动画
                if (animate && !REDUCED) {
                    // 过渡演出（感知强化）：CRT 闪白脉冲（稍弱）+ 回位轻提亮（轻内容）+ 平滑缩回，
                    // 与进入全屏的"上电"演出对称，退出也有可感的"断电回位"脉冲；
                    // 提亮同样仅对纯 DOM 轻内容启用：含 iframe/Canvas 时 filter 每帧重滤镜
                    // 实时重绘的纹理开销巨大（同进入分支），跳过后只留 transform + 闪白
                    const glow = !target.querySelector('iframe, canvas');
                    fsBusy = true; // 过渡进行中：抑制 resize 重算打断
                    crtFlash(0.32); // 全视口 CRT 闪白（比进入时弱，避免出入观感雷同）
                    target.style.willChange = glow ? 'transform, filter' : 'transform'; // 预提升合成层
                    if (glow) target.style.filter = 'brightness(1.4)'; // 回位瞬间轻提亮（脉冲基线）
                    // 强制回流确立"无变换 + 提亮 + 已建层"基线后再开过渡，避免同帧落位跳过动画
                    void target.offsetWidth;
                    target.style.transition = glow
                        ? 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), filter 0.28s ease-out'
                        : 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
                    target.style.transform = '';
                    target.style.transformOrigin = '';
                    if (glow) target.style.filter = 'brightness(1)'; // 提亮先行回落，脉冲与缩放分层可感
                    clearFsTransition(target); // 过渡结束后清理内联 transition/filter/will-change
                } else {
                    target.style.transition = '';
                    target.style.transform = '';
                    target.style.transformOrigin = '';
                    target.style.filter = ''; // 防御性清理：还原路径不残留提亮滤镜
                }
            }
            // 先清除标题 fixed 内联样式，再搬回文档流原位（同一同步任务内无渲染帧，无跳变）；
            // 淡入仅适用于标题被搬出的页面（keep-title 页标题随容器过渡，无跳变不播）
            applyTitleFs(title, false, 0, animate && !REDUCED && !keepTitleInFlow());
            restoreTitleDom(title);
            document.documentElement.style.overflow = '';
            return;
        }
        // 进入全屏即隐藏文档滚动条：必须先于测量与标题取位执行，
        // 否则滚动条移除（约 15px）会改变布局宽度，导致居中基准左右偏差
        document.documentElement.style.overflow = 'hidden';
        // 标题保留内容流模式（大厅页声明 data-fs-keep-title）：
        // 标题随缩放容器一起展示，顶部无需为放大标题预留安全区，
        // 缩放与居中覆盖整个视口高度，使可视展示区域在屏幕高度正中
        const keepTitle = keepTitleInFlow();
        const topOffset = keepTitle ? 0 : TOP_SAFE;
        // 游戏区等比缩放比（无游戏区页面保持 0，标题仅受安全区高度约束）
        let scale = 0;
        if (target) {
            // 标题位于缩放容器内时（如各游戏页 h1.title 在 .layout 中），
            // 先搬出到 body：避免容器 transform 成为 fixed 标题的包含块，
            // 同时让容器测量高度不含标题占位，缩放居中一次到位；
            // keep-title 模式（大厅页）不搬出，标题随容器整体缩放
            if (title && !keepTitle && target.contains(title)) detachTitleDom(title);
            // 测量前禁用过渡并清除旧变换：带过渡的变换会让 getBoundingClientRect
            // 读到动画中间值，导致缩放比与居中平移计算失真（resize 重算必须精确即时）
            target.style.transition = 'none';
            target.style.transform = '';
            const rect = target.getBoundingClientRect();
            // 等比缩放比取宽、高两个约束中较小者，保证完整显示；预留 4% 边距避免贴边
            // 高度约束使用扣除顶部预留（TOP_SAFE 或 keep-title 模式的 0）后的可用高度，
            // 缩放后游戏区/展示区整体落在预留区下方，不与右上角音效/全屏按钮重叠
            // 允许小于 1：容器高于视口时缩小，保证游戏区高度不超过屏幕
            // 嵌入模式下 iframe 全屏时其视口即屏幕尺寸，计算方式不变
            const availH = window.innerHeight - topOffset;
            scale = Math.min(
                window.innerWidth / rect.width,
                availH / rect.height
            ) * 0.96;
            // 水平对齐视口中心；垂直对齐"顶部预留区下方剩余区域"的中心，
            // keep-title 模式预留区为 0，即展示区域在屏幕高度正中
            const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
            const dy = (topOffset + availH / 2) - (rect.top + rect.height / 2);
            target.style.transformOrigin = 'center center'; // 围绕自身中心缩放，配合平移实现居中
            const fit = `translate(${dx}px, ${dy}px) scale(${scale})`;
            // iframe / Canvas 属实时重绘内容：对含它们的容器做 brightness 过渡，
            // GPU 须每帧读取其最新纹理重新执行滤镜（游戏画面还在持续刷新），
            // 开销巨大——正是嵌入游戏后全屏卡顿的根因；此时跳过提亮，
            // 只保留 transform 缩放 + 闪白脉冲（感知主力），过渡全程合成器采样、丝滑不掉帧
            const glow = !target.querySelector('iframe, canvas');
            if (animate && !REDUCED) {
                // 过渡演出（感知强化）：CRT 通电闪白脉冲（全视口）+ 游戏区提亮聚焦（轻内容）+ 平滑放大
                // transform 与 filter 双属性同步过渡，filter 用更短时长先行回落——
                // 亮度脉冲在前 1/3 内衰减完毕、缩放继续推进，"上电 → 聚焦落位"层次更清晰
                fsBusy = true; // 过渡进行中：抑制 resize 重算打断
                crtFlash(0.5); // 全视口 CRT 通电闪白（仅顶层文档播放，嵌入子页由大厅负责）
                // 提亮仅对纯 DOM 轻内容启用（见上方 glow 说明），重内容预提升层只声明 transform
                target.style.willChange = glow ? 'transform, filter' : 'transform';
                if (glow) target.style.filter = 'brightness(1.45)'; // CRT 聚焦上电提亮（脉冲基线）
                // 强制回流确立"无变换 + 提亮 + 已建层"基线后再开过渡，避免同帧落位跳过动画
                void target.offsetWidth;
                // filter 用更短时长先行回落（0.32s < 0.5s）；重内容无 filter，仅过渡 transform
                target.style.transition = glow
                    ? 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), filter 0.32s ease-out'
                    : 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
            }
            target.style.transform = fit;
            if (animate && !REDUCED) {
                if (glow) target.style.filter = 'brightness(1)'; // 提亮先行回落至常态，脉冲与缩放分层可感
                clearFsTransition(target); // 过渡结束后清理内联 transition/filter/will-change，不残留样式
            } else {
                target.style.transition = ''; // 非动画路径不留 'none' 残留
            }
        }
        // 全屏时游戏名称标题统一移至顶部安全区中央（keep-title 模式除外：
        // 大厅页标题已随内容区整体缩放展示，无需也不应再做 fixed 锚定）；
        // 未声明 keep-title 的页面若标题为 .arcade-title（兜底路径，当前站点大厅
        // 已声明 keep-title 不经过此处）：不随内容区同比缩放（内容区缩放比可能小于 1，
        // 会把标题也缩小），改为仅受安全区高度/宽度约束，保持醒目的放大展示
        if (!keepTitle) {
            const freeTitle = !!(title && title.classList.contains('arcade-title'));
            applyTitleFs(title, true, freeTitle ? 0 : scale, animate && !REDUCED);
        }
    }

    /**
     * 同步按钮文本与游戏区域缩放（真正的全屏切换会附带过渡动画，resize 重算则即时生效）
     * @param {boolean} [fs] 外部传入的全屏态（嵌入模式由父页广播）；省略时自行读取文档全屏态
     */
    function sync(fs) {
        const on = typeof fs === 'boolean' ? fs : isFullscreen();
        const switched = on !== lastFs; // 判定本次是否为真正的全屏切换（非 resize 重算），切换瞬间才播过渡
        lastFs = on; // 记录当前全屏态，供窗口尺寸变化时按状态重算
        const btn = document.getElementById('fullscreenToggle');
        if (btn) btn.textContent = on ? '全屏 · 关' : '全屏 · 开'; // 动作提示语义：全屏中提示可关闭，未全屏提示可开启
        applyFsScale(on, switched);
    }

    /**
     * 切换全屏并播报点击反馈音
     * @param {HTMLButtonElement} [btn] 全屏按钮元素（文本由 sync 事件统一更新）
     */
    function toggle(btn) {
        // 音效库存在时播放点击确认音，与音效开关体验一致
        if (typeof SFX !== 'undefined') SFX.uiClick();
        // 按压反馈：轻微下压回弹，强化"已响应"的即时手感（嵌入子页按钮同样生效）
        if (btn && !REDUCED) {
            btn.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(0.92)', offset: 0.4 },
                { transform: 'scale(1)' }
            ], { duration: 160, easing: 'ease-out' });
        }
        // 嵌入模式：全屏状态由大厅持有，转发切换请求（用户激活会随 postMessage 传递到父页）
        if (EMBED) {
            // 目标 origin 取 POST_MSG_TARGET（见顶部定义）：http(s) 同源收紧为 '/'，file:// 直开回退 '*' 维持跨帧通信
            window.parent.postMessage({ type: 'arcade:fs' }, POST_MSG_TARGET);
            return;
        }
        const req = isFullscreen() ? exit() : request(document.documentElement);
        // 拒绝全屏（如非用户手势触发）时静默忽略，避免未处理 rejection
        if (req && req.catch) req.catch(() => {});
    }

    /**
     * 父页角色：向页面内所有子 iframe 广播当前全屏状态
     * （fullscreenchange 不会穿越文档边界，需手动转发给子页同步按钮与缩放）
     */
    function broadcast() {
        document.querySelectorAll('iframe').forEach(f => {
            try {
                f.contentWindow.postMessage({ type: 'arcade:fs', fs: isFullscreen() }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
            } catch (e) { /* 跨源等异常场景静默忽略 */ }
        });
    }

    /**
     * 嵌入模式初始化（子页角色）：
     * 1. 拦截"← 游戏厅"链接，改为通知父页关闭覆盖层（避免 iframe 内导航破坏全屏链）
     * 2. 监听父页全屏状态广播，同步按钮文本与游戏区缩放
     * 3. 向父页报到，请求一次当前全屏态（覆盖广播早于 iframe 就绪而丢失的情况）
     */
    function initEmbed() {
        document.querySelectorAll('a.back-link').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault(); // 阻止 iframe 内导航
                window.parent.postMessage({ type: 'arcade:exit' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
            });
        });
        window.addEventListener('message', e => {
            if (e.source !== window.parent) return; // 只信任父页消息
            const d = e.data;
            if (d && d.type === 'arcade:fs') sync(!!d.fs);
        });
        window.parent.postMessage({ type: 'arcade:hello' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
    }

    /**
     * 独立打开模式（非嵌入）装配：拦截"← 游戏厅"链接，先播 CRT 关机动画再导航回大厅——
     * 整页纵向坍缩为过曝亮线后收束熄灭（Web Animations API，参数与大厅覆盖层关闭的
     * crtShrink 关键帧一致），导航后由大厅自身的 CRT 开机动画接棒，形成"断电 → 通电"闭环；
     * 嵌入模式不介入（关机演出由父页在大厅侧播放，子页仅转发 arcade:exit）
     */
    function initStandaloneExit() {
        let leaving = false; // 演出期间防重复触发（重复点击不重启动画、不重设导航计时）
        document.querySelectorAll('a.back-link').forEach(a => {
            a.addEventListener('click', e => {
                // 嵌入模式走 arcade:exit 转发；用户偏好"减少动态效果"时直接导航，两者均不拦截
                if (EMBED || REDUCED || leaving) return;
                e.preventDefault();
                leaving = true;
                // 坍缩基点取视口中心（补偿页面滚动偏移），保证亮线出现在可视区正中
                document.body.style.transformOrigin =
                    '50% ' + (window.scrollY + window.innerHeight / 2) + 'px';
                // 0.45s：加速坍缩（强缓入）→ 过曝亮线（brightness 抬升）→ 横向收束熄灭
                document.body.animate([
                    { transform: 'scaleY(1)', opacity: 1, filter: 'brightness(1)' },
                    { transform: 'scaleY(0.004)', opacity: 1, filter: 'brightness(2.4)', offset: 0.55, easing: 'ease-out' },
                    { transform: 'scaleY(0.004) scaleX(0.08)', opacity: 0, filter: 'brightness(3.2)' }
                ], { duration: 450, easing: 'cubic-bezier(0.62, 0, 0.84, 0.34)', fill: 'forwards' });
                // 演出播完再导航，随后由大厅的 CRT 开机动画完成"重新通电"
                setTimeout(() => { location.href = a.href; }, 470);
            });
        });
    }

    /**
     * 父页角色消息处理：回复子页状态询问、承接子页全屏切换请求
     */
    window.addEventListener('message', e => {
        if (EMBED) return; // 子页角色已在 initEmbed 单独监听
        // 来源守卫：仅接受同源消息；file:// 直开场景各帧 origin 字面量为 'null'，仅当本页也是 file:// 时豁免
        if (e.origin !== window.location.origin && !(e.origin === 'null' && location.protocol === 'file:')) return;
        const d = e.data;
        if (!d || typeof d.type !== 'string') return;
        if (d.type === 'arcade:hello') {
            broadcast(); // 子页就绪：回复当前全屏状态
        } else if (d.type === 'arcade:fs') {
            // 子页请求切换全屏：等价于点击本页全屏按钮（顶层文档持有状态）
            toggle(document.getElementById('fullscreenToggle'));
        }
    });

    // 全屏状态变化时同步按钮文本与缩放，并向子 iframe 广播（含按 ESC 退出）
    document.addEventListener('fullscreenchange', () => { sync(); broadcast(); });
    document.addEventListener('webkitfullscreenchange', sync);

    // 全局 F 键切换全屏：与音效 M 键同模式——捕获阶段监听防止游戏侧 stopPropagation 拦截，
    // 排除输入场景避免打字误触；嵌入模式下 toggle 内部转发 arcade:fs 由父页统一处理
    if (!window.__arcadeFsKeyBound) {
        window.__arcadeFsKeyBound = true;
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'KeyF' || e.repeat) return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return; // 输入场景不拦截
            toggle(document.getElementById('fullscreenToggle')); // 按钮不存在时按压动画安全跳过，切换仍生效
        }, true);
    }

    // 窗口/视口尺寸变化时（调整窗口、旋转屏幕、嵌入页尺寸变化）按当前全屏态重算缩放；
    // 全屏过渡动画进行中则跳过：fullscreenchange 触发时视口已是最终尺寸、fit 计算已正确，
    // 此后紧随的 resize 重算结果相同，跳过即可避免把进行中的过渡打断成瞬移落位
    window.addEventListener('resize', () => {
        if (fsBusy) return;
        applyFsScale(lastFs, false);
    });

    // 嵌入模式装配
    if (EMBED) initEmbed();
    else initStandaloneExit(); // 独立模式装配：返回大厅前先播 CRT 关机动画

    return {
        /** 切换全屏入口（供按钮 onclick 调用） */
        toggle
    };
})();
