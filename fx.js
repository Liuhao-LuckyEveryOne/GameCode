'use strict';
/**
 * 像素街机厅公共特效库 v1
 * 提供八类横切能力，供全部游戏页复用：
 *   1) DPR 高清适配（setupCanvas/dims）：物理分辨率放大 + CSS 逻辑坐标系，游戏绘制代码零改动获得锐利渲染
 *   2) hitstop 卡帧（hitstop/frozen）：合并、消行、吃食等大事件的"顿挫感"
 *   3) 粒子对象池（Pool）：预分配定长对象，高频粒子演出零 GC 抖动
 *   4) 破纪录金色烟花（recordBurst）：自包含覆盖层，一行接入不改游戏渲染循环
 *   5) 屏幕震动（shake）：CSS transform 抖动画布元素，自驱动短 rAF 线性衰减，不侵入游戏渲染循环
 *   6) 数字滚动补间（tweenNumber）：HUD 分数从当前显示值平滑滚到目标值，替代生硬跳变
 *   7) 键帽实时高亮（KeyLight.init）：带 data-code 属性的键帽按下时点亮，window 级捕获委托零侵入
 *   8) 游玩时长统计（playtime.init）：累计页面可见时长，嵌入模式 postMessage 上报父页、独立运行直写 localStorage
 * 另含 prefersReduced 动效降级开关（respect 系统级"减弱动态效果"设置）
 * 全局暴露 FX 对象；所有页面引入 <script src="fx.js?v=..."> 后即可使用，无任何外部依赖
 */
const FX = (() => {
    /** 是否偏好减弱动效（系统级设置；各游戏据此跳过粒子/卡帧等纯装饰演出） */
    const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /**
     * 高清屏适配：按 devicePixelRatio 放大画布物理分辨率，同时以 setTransform 锁定 CSS 逻辑坐标系，
     * 既有按 CSS 像素坐标的绘制代码无需任何改动即可获得锐利渲染
     * 注意：重复调用安全（以最新 clientWidth 重算）；画布 CSS 尺寸变化后需重新调用；
     *       画布不可见（clientWidth=0）时整体冻结——不写入任何像素属性，仅按上次 dpr 反推逻辑尺寸，
     *       保证任何加载/布局时序下物理分辨率绝对稳定不漂移（不可见期间本就无需渲染）
     * @param {HTMLCanvasElement} canvas 目标画布
     * @param {number} [maxDpr=2] 物理分辨率放大倍率上限（兼顾 4K/移动端性能）
     * @returns {{ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number}} 绘制上下文、CSS 逻辑宽高与实际 dpr
     */
    function setupCanvas(canvas, maxDpr = 2) {
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        const prevDpr = parseFloat(canvas.dataset.dpr) || 1; // 上次适配记录的 dpr（未适配过按 1，即 HTML 初始属性即逻辑尺寸）
        // 不可见冻结：clientWidth=0（display:none、iframe 未完成布局等）时不做任何像素属性写入，
        // 仅按上次 dpr 把现有像素属性反推回 CSS 逻辑尺寸并校正变换；否则一旦把设备像素当
        // CSS 像素使用，dpr>1 时每次调用都会把物理分辨率放大 dpr 倍（指数膨胀），画面整体缩小——
        // 表现为蛇身缩成几个像素不可见、食物缩成小点
        if (!canvas.clientWidth) {
            const w = Math.round(canvas.width / prevDpr);   // 现有物理宽 → CSS 逻辑宽（只读不写）
            const h = Math.round(canvas.height / prevDpr);  // 现有物理高 → CSS 逻辑高（同上）
            canvas.dataset.dpr = String(prevDpr);           // 维持记录一致（值不变，幂等）
            const ctx = canvas.getContext('2d');
            ctx.setTransform(prevDpr, 0, 0, prevDpr, 0, 0); // 与现有像素属性保持同一坐标系
            return { ctx, w, h, dpr: prevDpr };
        }
        const w = canvas.clientWidth;   // 可见：以实际布局 CSS 尺寸为准
        const h = canvas.clientHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.dataset.dpr = String(dpr); // 记录供 dims() 反查
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 物理像素 → CSS 逻辑坐标
        return { ctx, w, h, dpr };
    }

    /**
     * 读取画布的 CSS 逻辑尺寸与 dpr（与 setupCanvas 返回值一致；未适配过的画布按 dpr=1 回退）
     * @param {HTMLCanvasElement} canvas 目标画布
     * @returns {{w: number, h: number, dpr: number}} 逻辑宽高与 dpr
     */
    function dims(canvas) {
        const dpr = parseFloat(canvas.dataset.dpr) || 1;
        return { w: canvas.width / dpr, h: canvas.height / dpr, dpr };
    }

    /* ==================== hitstop 卡帧 ==================== */
    let stopUntil = 0; // 卡帧截止时间戳（performance.now 毫秒）

    /**
     * 触发一次卡帧：截止时刻之前游戏循环应跳过 update 仅渲染（大事件的顿挫定格感）。
     * 连续触发取更晚截止时间，不会互相覆盖缩短；减弱动效时整体跳过
     * @param {number} [ms=50] 卡帧时长（毫秒）
     */
    function hitstop(ms = 50) {
        if (prefersReduced) return;
        stopUntil = Math.max(stopUntil, performance.now() + ms);
    }

    /**
     * 查询当前是否处于卡帧中（游戏循环每帧开头调用：为真则跳过 update 只渲染）
     * @returns {boolean} 是否卡帧中
     */
    function frozen() {
        return performance.now() < stopUntil;
    }

    /* ==================== 粒子对象池 ==================== */
    /**
     * 定长粒子对象池：预分配、循环复用，避免高频演出反复 new 对象造成 GC 抖动。
     * 用法：
     *   const pool = new FX.Pool(300, () => ({x:0,y:0,vx:0,vy:0,life:0,max:1}));
     *   每帧：pool.obtain() 取粒子并填充属性 → 更新/绘制 → pool.sweep() 剔除死亡粒子
     */
    class Pool {
        /**
         * @param {number} [capacity=300] 池上限（满员时 obtain 征用最旧粒子）
         * @param {Function} [factory] 粒子工厂（返回带全部所需字段的_plain对象）
         */
        constructor(capacity = 300, factory = () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1 })) {
            this.items = new Array(capacity);
            for (let i = 0; i < capacity; i++) this.items[i] = factory();
            this.n = 0;      // 活跃粒子数（items 前 n 个为活跃区）
            this.cursor = 0; // 满员征用游标（轮转淘汰最旧）
        }

        /**
         * 取出一个粒子：活跃区未满则取尾部空位；满员时征用游标处最旧粒子（保证演出永不断流）
         * @returns {object} 待填充属性的粒子对象
         */
        obtain() {
            if (this.n < this.items.length) return this.items[this.n++];
            const p = this.items[this.cursor];
            this.cursor = (this.cursor + 1) % this.n;
            return p;
        }

        /**
         * 清扫死亡粒子（life <= 0）：与活跃区尾部交换后缩界，O(n) 零分配。
         * 建议每帧渲染循环结束后调用一次
         */
        sweep() {
            for (let i = this.n - 1; i >= 0; i--) {
                if (this.items[i].life <= 0) {
                    this.n--;
                    if (i < this.n) {
                        // 尾部活跃粒子填补空位，保持活跃区连续
                        const tmp = this.items[i];
                        this.items[i] = this.items[this.n];
                        this.items[this.n] = tmp;
                    }
                }
            }
            if (this.n < this.cursor) this.cursor = 0; // 游标越界兜底
        }

        /** 清空活跃区（粒子对象全部保留复用，零分配） */
        clear() { this.n = 0; this.cursor = 0; }
    }

    /* ==================== 破纪录金色烟花（自包含覆盖层） ==================== */
    /**
     * 破纪录庆祝：自建全屏覆盖 canvas（fixed + pointer-events:none + z-index:99998，
     * 不触碰游戏画布与渲染循环），金色粒子三波喷发约 2.2s 后自毁。
     * 各游戏在刷新纪录处一行调用 FX.recordBurst() 即可；减弱动效时整体跳过
     * @param {{x?: number, y?: number, count?: number}} [opts] 发射点（CSS 像素，缺省屏幕中上）与每波粒子数
     */
    function recordBurst(opts = {}) {
        if (prefersReduced) return;
        const cv = document.createElement('canvas');
        // DPR 适配与 setupCanvas 同款方式：物理分辨率按 dpr 放大 + ctx.scale 锁定 CSS 逻辑坐标系，
        // HiDPI 屏上粒子按设备像素渲染不再发糊；上限 2 与 setupCanvas 一致（兼顾性能）
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = window.innerWidth, H = window.innerHeight; // CSS 逻辑尺寸（粒子坐标保持逻辑像素）
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
        cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99998;';
        document.body.appendChild(cv);
        const ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr); // 物理像素 → CSS 逻辑坐标，后续绘制代码零改动
        const ox = opts.x !== undefined ? opts.x : W / 2;
        const oy = opts.y !== undefined ? opts.y : H * 0.38;
        const count = opts.count || 40;
        const parts = []; // 本地粒子数组（短生命周期一次性演出，无需对象池）
        let raf = 0;
        const timers = []; // 已排期的喷发/兜底定时器 id，finish 时统一取消，避免烟花结束后定时器仍被触发

        /** 收尾：停帧、取消未触发的定时器并移除覆盖层（幂等，可被粒子耗尽与兜底定时器重复触发） */
        const finish = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
            for (const id of timers) clearTimeout(id); // 清理路径顺手取消未触发的喷发/兜底定时器
            timers.length = 0;
            cv.remove();
        };

        /** 单帧推进：物理更新（重力 + 阻尼）+ 金色渐暗绘制（寿命按真实帧时长扣减，见 dt 注释） */
        let lastT = 0; // 上一帧 rAF 时间戳：首帧为 0 时建基准，此后按真实间隔扣减寿命
        const frame = (t) => {
            if (!cv.isConnected) return; // 页面已切换等异常场景立即停止
            // 帧时长（秒）：首帧取 1/60 与旧行为一致；高刷屏按真实 dt 扣减寿命不再减半；
            // 切后台回来首帧 dt 钳位 0.1s，防止粒子被一帧扣光瞬间消失
            const dt = lastT ? Math.min((t - lastT) / 1000, 0.1) : 1 / 60;
            lastT = t;
            ctx.clearRect(0, 0, W, H);
            let alive = false;
            for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (p.life <= 0) continue;
                alive = true;
                p.life -= dt;
                p.vy += 0.06;   // 重力
                p.vx *= 0.985;  // 空气阻尼
                p.vy *= 0.985;
                p.x += p.vx;
                p.y += p.vy;
                ctx.fillStyle = p.life > 0.55 ? '#ffe98a' : '#ffb01f'; // 前段亮金、后段深金
                ctx.fillRect(p.x, p.y, 3, 3);
            }
            if (!alive) return finish();
            raf = requestAnimationFrame(frame);
        };

        // 三波喷发（间隔 260ms），每波 count 粒向四周四散并整体上抛（定时器 id 入列，finish 时统一取消）
        for (let wave = 0; wave < 3; wave++) {
            timers.push(setTimeout(() => {
                if (!cv.isConnected) return;
                for (let i = 0; i < count; i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 2 + Math.random() * 4;
                    parts.push({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 1.1 + Math.random() * 0.5 });
                }
                if (!raf) raf = requestAnimationFrame(frame);
            }, wave * 260));
        }
        timers.push(setTimeout(finish, 2200)); // 兜底自毁（正常应随粒子耗尽提前收尾）
    }

    /* ==================== 屏幕震动（v1.1 新增） ==================== */
    /** 当前震动状态 { el, mag, dur, until, raf }：null 表示无震动（单例驱动，跨游戏页面天然隔离） */
    let shakeState = null;

    /**
     * 屏幕震动：以 CSS transform 平移抖动目标元素（通常为游戏画布），幅度随剩余时长线性衰减归零。
     * fx 自驱动独立 rAF 循环，游戏渲染循环零改动；同一元素连续触发按"最新一次"重启震动窗口
     * （幅度取新值、时长重新计时），切换目标元素时旧元素 transform 立即复位；
     * 减弱动效偏好时整体跳过
     * @param {HTMLElement} el 要抖动的元素（通常传入游戏主画布）
     * @param {number} [intensity=4] 最大抖动幅度（CSS 像素，向两侧随机偏移的上限）
     * @param {number} [duration=240] 震动总时长（毫秒），幅度从 intensity 线性衰减到 0
     */
    function shake(el, intensity = 4, duration = 240) {
        if (!el || prefersReduced) return;
        const until = performance.now() + duration;
        // 换目标：复位旧元素 transform 并把状态切到新元素（驱动循环每帧读 shakeState.el，
        // 未同步赋值时新元素永远抖不起来、旧元素被后续帧继续抖动）
        if (shakeState && shakeState.el !== el) {
            shakeState.el.style.transform = '';
            shakeState.el = el;
        }
        if (!shakeState) {
            shakeState = { el, raf: 0 };
            // 驱动循环：每帧按剩余时长比例衰减幅度，随机方向偏移；结束/目标被移除时复位收尾
            const frame = () => {
                const s = shakeState;
                if (!s || !s.el.isConnected) { // 目标元素已被移除（切游戏等）：直接收尾
                    if (s) s.el.style.transform = '';
                    shakeState = null;
                    return;
                }
                const now = performance.now();
                if (now >= s.until) { // 震动自然结束：复位 transform 并停循环
                    s.el.style.transform = '';
                    shakeState = null;
                    return;
                }
                const k = s.mag * (s.until - now) / s.dur; // 线性衰减系数（末帧趋零）
                const dx = (Math.random() * 2 - 1) * k;
                const dy = (Math.random() * 2 - 1) * k;
                s.el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
                s.raf = requestAnimationFrame(frame);
            };
            shakeState.raf = requestAnimationFrame(frame);
        }
        // 更新本次震动参数（同元素连续触发按最新一次重启：幅度取新值、窗口重新计时）
        shakeState.mag = Math.max(1, intensity);
        shakeState.dur = duration;
        shakeState.until = until;
    }

    /* ==================== 数字滚动补间（v1.1 新增） ==================== */
    /** 进行中的补间表：el → { raf, cur }（cur 为当前动画值，供连续触发衔接起点） */
    const tweens = new Map();

    /**
     * 数字滚动补间：把元素中的数字从当前显示值平滑滚动到目标值（easeOutCubic 缓动）。
     * 起点优先取上一次补间的当前值（连续加分无缝衔接），否则从元素现有文本解析首个整数；
     * 文本格式可经 format 自定义（如 'TOTAL 123' 场景传 v => 'TOTAL ' + v）；
     * 减弱动效偏好时直接写入目标值不动画
     * @param {HTMLElement} el 目标元素（其文本中含数字即可）
     * @param {number} target 目标数值
     * @param {number} [duration=128] 补间时长（毫秒）
     * @param {Function} [format] 数值 → 文本的格式化函数，缺省取整数字符串
     */
    function tweenNumber(el, target, duration = 128, format) {
        if (!el) return;
        // 库级边界防御：目标值非法（NaN/Infinity，如调用方聚合出脏数据）时保持原文本直接返回，
        // 杜绝 8 个页面任何调用点把「NaN」渲染到界面上
        if (!Number.isFinite(target)) return;
        const fmt = typeof format === 'function' ? format : (v => String(Math.round(v)));
        if (prefersReduced || duration <= 0) { el.textContent = fmt(target); return; }
        // 起点：优先衔接进行中补间的当前值；否则从现有文本解析首个整数（无数字按 0 起）
        let tw = tweens.get(el);
        let from;
        if (tw) {
            from = tw.cur;
            cancelAnimationFrame(tw.raf);
        } else {
            const m = /-?\d+/.exec(el.textContent || '');
            from = m ? parseFloat(m[0]) : 0;
        }
        const t0 = performance.now();
        tw = { raf: 0, cur: from };
        tweens.set(el, tw);
        const frame = (t) => {
            const k = Math.min((t - t0) / duration, 1);
            const v = from + (target - from) * (1 - Math.pow(1 - k, 3)); // easeOutCubic：前快后缓
            el.textContent = fmt(Math.round(v));
            tw.cur = v;
            if (k < 1) tw.raf = requestAnimationFrame(frame);
            else tweens.delete(el); // 补间完成：清理记录（下次从文本重新解析起点）
        };
        tw.raf = requestAnimationFrame(frame);
    }

    /* ==================== 键帽实时高亮（v1.1 新增） ==================== */
    /**
     * 键帽实时高亮控制器：window 级 keydown/keyup 捕获委托，按 e.code 点亮/熄灭
     * 页面内所有携带 data-code 属性的键帽（各页 KEYS 面板的 <b data-code="...">）。一次注入通用按压样式，各页面零 CSS 改动
     */
    const KeyLight = {
        /** 是否已初始化（幂等保护，重复调用无害） */
        inited: false,

        /** 初始化：注入按压样式 + 注册 window 级捕获监听（keydown/keyup/blur） */
        init() {
            if (this.inited) return;
            this.inited = true;
            // 通用按压样式：亮度提升 + 轻微下沉缩小（filter 方案对任意配色键帽通用，零页面适配）
            const st = document.createElement('style');
            st.id = 'fxKeyLightStyle';
            st.textContent = '[data-code]{transition:transform .06s ease,filter .06s ease;}'
                + '[data-code].pressed{transform:translateY(1px) scale(.96);filter:brightness(1.65) saturate(1.25);}'
                + '@media (prefers-reduced-motion: reduce){[data-code]{transition:none;}}';
            document.head.appendChild(st);
            /** 按物理键码切换全部匹配键帽的高亮态 @param {string} code e.code 物理键码 @param {boolean} on 是否点亮 */
            const setPressed = (code, on) => {
                document.querySelectorAll('[data-code]').forEach(k => {
                    if (k.dataset.code === code) k.classList.toggle('pressed', on);
                });
            };
            // 捕获阶段监听：先于游戏自身的 stopPropagation 拦截，保证任何键位布局下键帽都点亮
            window.addEventListener('keydown', (e) => setPressed(e.code, true), true);
            window.addEventListener('keyup', (e) => setPressed(e.code, false), true);
            // 窗口失焦清空全部按压态：系统切走时 keyup 会丢失，否则高亮残留
            window.addEventListener('blur', () => {
                document.querySelectorAll('[data-code].pressed').forEach(k => k.classList.remove('pressed'));
            });
        }
    };

    /* ==================== 游玩时长统计（v1.1 新增） ==================== */
    /**
     * 游玩时长追踪器（单例）：累计页面可见时长（rAF 驱动，隐藏页自动不计），
     * 每 15 秒冲账一次 + pagehide 兜底冲账。嵌入模式（?embed 且运行于 iframe）下经
     * postMessage 上报父页 {type:'arcade:playtime', id, seconds} 由大厅统一落盘；
     * 独立运行直接写 localStorage 键 arcade_playtime_<id>（秒累加，读写均 try-catch）
     * @returns {{init: Function}} playtime 对象：init(gameId) 传入游戏 id（与卡片/存档键 id 一致），
     *          幂等可重复调用（游戏侧统一按 FX.playtime.init('id') 对象形状调用）
     */
    const playtime = (() => {
        let id = null;      // 游戏 id（init 时写入）
        let acc = 0;        // 未冲账的累计毫秒数
        let last = 0;       // 上一帧 rAF 时间戳
        let lastVisible = true; // 上一帧是否可见：仅连续可见帧才累计，切后台回来的首帧不计入
        let inited = false; // 幂等保护
        /** 冲账阈值：累计满 15 秒落盘一次，控制写入频率；离页时不足额由 pagehide 兜底 */
        const FLUSH_MS = 15000;

        /** 冲账：把当前累计毫秒换算成秒后落盘/上报（不足 1 秒丢弃，避免高频零碎写入） */
        function flush() {
            const secs = Math.floor(acc / 1000);
            acc = 0;
            if (secs <= 0) return;
            // 嵌入模式：上报父页统一落盘（大厅是持久化唯一方，与音控协议同思路）
            if (window.parent !== window && new URLSearchParams(location.search).has('embed')) {
                // 目标 origin 与全库一致：file:// 直开回退 '*'，http(s) 同源收紧为 '/'
                const target = (location.protocol === 'file:') ? '*' : '/';
                try { window.parent.postMessage({ type: 'arcade:playtime', id: id, seconds: secs }, target); } catch (e) { /* 父页不可达时忽略 */ }
            } else {
                // 独立运行：直接累加写入 localStorage（隐私模式等不可用时静默放弃）
                try {
                    const key = 'arcade_playtime_' + id;
                    const prev = parseInt(localStorage.getItem(key), 10) || 0;
                    localStorage.setItem(key, String(prev + secs));
                } catch (e) { /* 存储不可用：放弃本次冲账 */ }
            }
        }

        /**
         * rAF 驱动：仅页面可见时累计；切后台期间 rAF 暂停，恢复后的首帧 t-last 可能是整段隐藏时长，
         * 故要求「上一帧也可见」才累计——首帧只校正基准，不计入任何时长（否则会被 5 秒钳位
         * 白送最多 5 秒游玩时长）
         * @param {number} t rAF 时间戳（毫秒）
         */
        function frame(t) {
            const visible = document.visibilityState === 'visible';
            if (visible && lastVisible) acc += Math.min(t - last, 5000);
            lastVisible = visible;
            last = t;
            if (acc >= FLUSH_MS) flush();
            requestAnimationFrame(frame);
        }

        /**
         * 初始化追踪（幂等）：启动 rAF 累计并注册 pagehide 兜底冲账
         * @param {string} gameId 游戏 id（与大厅卡片/存档键一致，如 'snake'）
         */
        function init(gameId) {
            if (inited || !gameId) return;
            inited = true;
            id = gameId;
            last = performance.now();
            requestAnimationFrame(frame);
            window.addEventListener('pagehide', flush); // 离页兜底冲账（iframe 被移除时尽力而为）
        }
        // 以 { init } 对象形状导出：全部游戏页统一按 FX.playtime.init('id') 调用，
        // 此前直接 return init 导致 .init 属性不存在，每个游戏页加载即抛 TypeError
        return { init };
    })();

    return { prefersReduced, setupCanvas, dims, hitstop, frozen, Pool, recordBurst, shake, tweenNumber, KeyLight, playtime };
})();
