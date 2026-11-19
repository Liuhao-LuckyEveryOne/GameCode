/* ==========================================================================
 * arcade-common.js —— 街机厅公共基础库（零依赖，须在 audio/fx/fullscreen 等公共库之前加载）
 * 职责一：跨帧 postMessage 统一来源守卫（全项目 message 监听收口于此，策略改动只改本文件）
 *         + 消息类型注册表（MSG 八类型常量表 / MSG_TARGET 投递目标单点定义，业务侧禁止裸写字面量）
 * 职责二：localStorage 安全存取（JSON 序列化族 saveJSON/loadJSON/loadJSONState + 裸值族 saveRaw/loadRaw/removeRaw，
 *         两族均降级兜底；JSON 族写失败/读损坏同键仅告警一次，精细读用 loadJSONState；
 *         全站 localStorage 直接调用收口于本文件，业务代码禁止绕过）
 * 职责三：指针捕获守卫（setPointerCapture 对已释放/合成指针抛 NotFoundError 的统一兜底）
 * 职责四：通用难度按钮组绑定（bindDifficultyButtons，收编七游戏 selectDifficulty 同构实现）
 * 职责五：系统级「减少动态效果」偏好唯一探测点（prefersReducedMotion，fx/fullscreen/gamepad/大厅统一消费）
 * 职责六：跨游戏渲染/HUD 同构样板工厂（createGridLayer 离屏网格层三件套 / createAchHud 成就墙六件套，
 *         dpr 读取口径与成就墙 id 契约单点收敛；当前 snake/tetris 接入，其余游戏各自变体不强制迁移）
 * 暴露全局：window.Arcade = { onTrustedMessage, MSG, MSG_TARGET, saveJSON, loadJSON, loadJSONState, saveRaw, loadRaw, removeRaw, removeByPrefix, capturePointer, bindDifficultyButtons, prefersReducedMotion, createGridLayer, createAchHud }
 * ========================================================================== */
const Arcade = (() => {
    'use strict';

    /**
     * 注册带统一来源守卫的 window message 监听
     * 守卫策略：仅接受同源消息；file:// 直开场景各帧 origin 字面量为 'null'，仅当本页也是
     * file:// 协议时豁免；其余来源（跨源伪造的 arcade:* 指令）在守卫处静默丢弃
     * @param {(e: MessageEvent) => void} handler 通过守卫后的消息回调
     */
    function onTrustedMessage(handler) {
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin && !(e.origin === 'null' && location.protocol === 'file:')) return;
            handler(e);
        });
    }

    /**
     * 消息类型注册表：全站跨帧 postMessage 协议指纹单点定义（2026-11-17 消息收口）。
     * 发送侧与接收侧一律引用本表，禁止散落裸写字面量——发/收两侧各自硬编码易在协议
     * 演进时静默漂移，check.py 第⑤项守护；tests 测试装置以真实报文驱动黑盒验证，
     * 属刻意直写白名单
     */
    const MSG = {
        HELLO: 'arcade:hello',       // 子页就绪报到（fullscreen.js 收发）
        FS: 'arcade:fs',             // 全屏状态广播 / 切换请求（fullscreen.js 收发、klotski 舞台适配跟随）
        SAVE: 'arcade:save',         // 大厅关闭覆盖层前下发进度快照指令（index.js 发、游戏页收）
        SAVED: 'arcade:saved',       // 快照存档回执 ACK：子页写盘完成后回发，父页收到才摘除 iframe（snap-common.js 发、index.js 收）
        AUDIO: 'arcade:audio',       // 音控状态同步：静音开关 + 双通道档位（audio.js 收发）
        PLAYTIME: 'arcade:playtime', // 游玩时长增量上报（fx.js 发、index.js 收）
        FXLEVEL: 'arcade:fxlevel',   // 演出强度档位同步（fx.js 收发、audio.js 面板转发）
        BEHAVIOR: 'arcade:behavior'  // 行为回归测试逐页上报（fx.js 发，测试基建）
    };

    /**
     * 跨文档 postMessage 投递目标 origin：file:// 直开时各帧为独立 opaque origin，需回退 '*'
     * 维持跨帧通信；http(s) 同源部署收紧为 '/'（仅同源可投）。
     * 原 audio/fullscreen/fx/index 四处同款公式的单点定义
     */
    const MSG_TARGET = (location.protocol === 'file:') ? '*' : '/';

    const warnedWriteKeys = new Set(); // 已告警过的写失败键：存储被禁时同键反复失败，仅首次告警避免刷屏

    /**
     * 安全写档：JSON 序列化后写入 localStorage；隐私模式/配额满等存储不可用时降级跳过，
     * 本局不受影响；首次失败控制台告警便于观测（键未落盘由 loadJSON 的兜底值承接）
     * @param {string} key 存档键名
     * @param {*} value 任意可 JSON 序列化的值
     */
    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            if (!warnedWriteKeys.has(key)) { // 同键仅首次告警
                warnedWriteKeys.add(key);
                console.warn('[Arcade] saveJSON 写入失败（本局继续，不持久化）:', key, e);
            }
        }
    }

    const warnedCorruptKeys = new Set(); // 已告警过的损坏键：坏档是玩家侧数据问题，同键首次告警即可定位
    /**
     * 精细读档：与 loadJSON 同源读取，但区分键缺失/内容损坏/存储不可用三种失败态，
     * 供需要差异化处理的调用方使用（如损坏时上报或引导重置）；普通读写无需感知本 API
     * @param {string} key 存档键名
     * @returns {{state:'ok'|'missing'|'corrupt'|'unavailable', value:*, raw:string|null}}
     *   ok：value 为反序列化结果、raw 为原始串；missing：键不存在（value 为 null）；
     *   corrupt：内容损坏（value 为 null、raw 保留坏串便于诊断，同键首次触发控制台告警）；
     *   unavailable：存储不可用（value 为 null）
     */
    function loadJSONState(key) {
        let raw;
        try { raw = localStorage.getItem(key); } catch (e) { return { state: 'unavailable', value: null, raw: null }; }
        if (raw === null) return { state: 'missing', value: null, raw: null };
        try {
            return { state: 'ok', value: JSON.parse(raw), raw: raw };
        } catch (e) {
            if (!warnedCorruptKeys.has(key)) { // 同键仅首次告警
                warnedCorruptKeys.add(key);
                console.warn('[Arcade] 存档数据损坏，已按缺失兜底:', key, e);
            }
            return { state: 'corrupt', value: null, raw: raw };
        }
    }

    /**
     * 安全读档：读取并 JSON 反序列化；键不存在/内容损坏/存储不可用时返回兜底值
     * （需区分失败原因时改用 loadJSONState）
     * @param {string} key 存档键名
     * @param {*} [fallback=null] 读取失败时的兜底值
     * @returns {*} 反序列化结果或 fallback
     */
    function loadJSON(key, fallback = null) {
        const s = loadJSONState(key);
        return s.state === 'ok' ? s.value : fallback; // 缺失/损坏/存储不可用统一走兜底，交由调用方承接
    }

    /**
     * 安全写裸值：字符串原样写入 localStorage（不做 JSON 序列化，兼容历史裸串格式存档，
     * 如分数记录、难度索引、每日任务标记等）；隐私模式/配额满等存储不可用时降级跳过，
     * 本局不受影响；首次失败控制台告警便于观测
     * @param {string} key 存档键名
     * @param {string} value 原样写入的字符串值（非字符串将按 localStorage 规则自动转串）
     */
    function saveRaw(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            if (!warnedWriteKeys.has(key)) { // 同键仅首次告警
                warnedWriteKeys.add(key);
                console.warn('[Arcade] saveRaw 写入失败（本局继续，不持久化）:', key, e);
            }
        }
    }

    /**
     * 安全读裸值：原样返回键内字符串；键不存在返回 null（与 getItem 语义一致），
     * 存储不可用（隐私模式/禁 Cookie）时返回兜底值
     * @param {string} key 存档键名
     * @param {string|null} [fallback=null] 存储不可用时的兜底值
     * @returns {string|null} 键内原始字符串、null（键不存在）或 fallback（存储不可用）
     */
    function loadRaw(key, fallback = null) {
        try { return localStorage.getItem(key); } catch (e) { return fallback; }
    }

    /**
     * 安全删键：移除指定存档键；存储不可用时静默跳过
     * （删除失败等同键暂存，下次同键覆盖写入时自然兜底，不影响主流程）
     * @param {string} key 存档键名
     */
    function removeRaw(key) {
        try { localStorage.removeItem(key); } catch (e) { /* 存储不可用：静默跳过 */ }
    }

    /**
     * 按前缀批量删键：移除所有以 prefix 开头的键（arcade_ach_* / arcade_save_* 等
     * 前缀族键的批量清理入口，供「重置进度」类全量清除使用）；存储不可用时静默跳过。
     * 注意：前缀必须逐字符精确匹配本站自有键命名契约，禁止用宽泛前缀误伤同源其它数据
     * @param {string} prefix 键名前缀（逐字符精确匹配，非正则）
     */
    function removeByPrefix(prefix) {
        let keys;
        try { keys = Object.keys(localStorage); } catch (e) { return; } // 存储不可用：静默跳过
        keys.filter(k => k.startsWith(prefix)).forEach(k => {
            try { localStorage.removeItem(k); } catch (e) { /* 单键失败跳过，继续清理其余键 */ }
        });
    }

    /**
     * 指针捕获守卫：setPointerCapture 在指针已释放（极快点按）、指针 id 失效或
     * 合成事件（如自动化测试派发的假 pointerId）场景下会抛 NotFoundError；
     * 捕获仅是"拖出画布仍跟踪指针"的体验增强，失败无副作用，
     * 统一在此静默兜底，调用方手势主流程不受影响
     * @param {Element} el 捕获目标元素（画布或按钮）
     * @param {number} pointerId 指针 id（取自 pointerdown 事件）
     */
    function capturePointer(el, pointerId) {
        try { el.setPointerCapture(pointerId); } catch (e) { /* 无活动指针：忽略 */ }
    }

    /**
     * 通用难度按钮组绑定：收编七游戏 selectDifficulty 的同构实现，统一点击时序
     * （blur 防空格误触 → 清全部高亮/点亮当前 → saveRaw 持久化 → SFX 点击音 → onChange）
     * @param {Object} o 参数
     * @param {string|Element} o.bar 按钮组容器（选择器或元素）
     * @param {string} [o.btnSelector='.difficulty-btn'] 按钮选择器
     * @param {string} o.storageKey 存档键（经 Arcade.saveRaw 持久化）
     * @param {'index'|'data-diff'} [o.persist='index'] 'index' 存按钮序号（tetris/snake 现状）；
     *   'data-diff' 存 btn.dataset.diff 键名（1024 现状）
     * @param {Function} o.onChange 选中回调（含恢复路径）：(btn, idx, key)=>void，游戏读自身
     *   data-* 写自家难度变量；idx 为按钮序号，key 为 data-diff 键名（data-diff 模式）否则 null
     * @param {Function} [o.canPick] 点击守卫 (btn, idx, key)=>boolean，idx/key 定义同 onChange：
     *   点击时序中最先执行，返回 false 则本次点击整体忽略（不 blur/不高亮/不存档/不发声/
     *   不 onChange），供游戏复刻"未知键名或重复选择直接忽略"类前置守卫；缺省无守卫。
     *   仅约束点击路径——sync 程序化恢复不经过守卫（恢复点由游戏侧外层校验把关）
     * @param {Function} [o.lockedDuringPlay] 对局锁定守卫 ()=>boolean：返回 true 表示对局
     *   进行中，点击整体忽略（短路语义同 canPick），供游戏声明式禁掉对局中切难度——
     *   难度参数（速度/倍率/尺寸等）直接影响对局公平性，局中切换会产生作弊面；
     *   sync 程序化恢复（快照续玩）不受限；缺省不锁定
     * @param {string} [o.activeClass='active'] 高亮类
     * @returns {{sync: Function}} sync(value)：程序化选择（快照恢复/初始化用），按序号或键名
     *   定位按钮→高亮→onChange；不写存档、不发声、不 blur；越界/未知值静默忽略
     */
    function bindDifficultyButtons(o) {
        if (!o || !o.bar || !o.storageKey || typeof o.onChange !== 'function') {
            throw new Error('[Arcade] bindDifficultyButtons 缺少必传参数：bar / storageKey / onChange');
        }
        const persist = o.persist || 'index';
        const activeClass = o.activeClass || 'active';
        const btnSelector = o.btnSelector || '.difficulty-btn';
        const bar = typeof o.bar === 'string' ? document.querySelector(o.bar) : o.bar;
        if (!bar) throw new Error('[Arcade] bindDifficultyButtons 未找到按钮组容器: ' + o.bar);
        const buttons = Array.from(bar.querySelectorAll(btnSelector));

        /** 高亮指定按钮并回调 onChange（供点击与 sync 共用；落盘/发声/blur 由调用方差异化） */
        function activate(btn) {
            const idx = buttons.indexOf(btn);
            const key = persist === 'data-diff' ? btn.dataset.diff : null;
            buttons.forEach(b => b.classList.remove(activeClass));
            btn.classList.add(activeClass);
            o.onChange(btn, idx, key);
        }

        // 逐钮绑定点击：完整收编 tetris 行为（含 blur），snake 缺失的 blur 在此补齐；
        // canPick 守卫最先执行（缺省跳过），拒绝时整条时序短路，等同未点击
        buttons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = buttons.indexOf(btn);
                const key = persist === 'data-diff' ? btn.dataset.diff : null;
                if (typeof o.canPick === 'function' && !o.canPick(btn, idx, key)) return;
                // 对局锁定守卫：对局进行中禁切难度（声明式，短路语义同 canPick，缺省不锁定）
                if (typeof o.lockedDuringPlay === 'function' && o.lockedDuringPlay()) return;
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                activate(btn);
                // 持久化所选难度：index 模式存序号裸串（兼容历史存档格式），data-diff 模式存键名
                saveRaw(o.storageKey, persist === 'data-diff' ? key : String(idx));
                // 音效反馈软依赖：常规加载序下 audio.js 先于业务 js 就绪；本库定位零依赖基础库，
                // 被单独环境（测试装置等）加载时 SFX 可能不存在，typeof 防御跳过发声（与 fullscreen.js 同口径）
                if (typeof SFX !== 'undefined') SFX.uiClick();
            });
        });

        return {
            /**
             * 程序化选择：index 模式按序号（number 或数字串）定位，data-diff 模式按键名匹配
             * btn.dataset.diff；越界/未知值静默忽略，不写存档、不发声、不 blur
             * @param {number|string} value 序号或 data-diff 键名
             */
            sync(value) {
                let target = null;
                if (persist === 'index') {
                    const idx = typeof value === 'number' ? value : parseInt(value, 10);
                    if (Number.isInteger(idx) && idx >= 0 && idx < buttons.length) target = buttons[idx];
                } else {
                    target = buttons.find(b => b.dataset.diff === value) || null;
                }
                if (target) activate(target);
            }
        };
    }

    /**
     * 离屏静态网格层三件套工厂：离屏画布 + 绘制上下文 + 脏标记的通用封装
     * （snake 棋盘背景 / tetris 台面网格的同构样板下沉；渲染行为与两游戏原实现逐位一致）。
     * dpr 读取与 FX.dims 同口径——物理缩放比记录于主画布 dataset.dpr，本库定位零依赖基础库
     * （先于 fx.js 加载），故不引用 FX，按同公式自读（未适配画布按 1 回退，天然带回退语义）
     * @param {HTMLCanvasElement} mainCanvas 主画布：离屏层物理分辨率与其对齐，保证 1:1 贴回不缩放
     * @param {Function} paint 网格内容绘制回调 (layerCtx) => void：仅脏重建时调用一次；
     *   clearRect/底色填充由回调自行负责（snake 不透明暗底覆盖、tetris 透明底，策略不同不强行统一）
     * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, markDirty: Function, blit: Function}}
     */
    function createGridLayer(mainCanvas, paint) {
        const layerCanvas = document.createElement('canvas');
        const layerCtx = layerCanvas.getContext('2d');
        let dirty = true; // 初始即脏：首帧 blit 必然重建一次（等价原实现声明后置位的时序）
        return {
            canvas: layerCanvas,
            ctx: layerCtx,
            /** 置脏：下一帧 blit 重建离屏层内容（主画布物理分辨率/DPR 变化时调用） */
            markDirty() { dirty = true; },
            /**
             * 脏则重建并整层贴回主画布上下文（游戏每帧调用一次）
             * @param {CanvasRenderingContext2D} targetCtx 主画布绘制上下文
             * @param {number} w 贴回目标逻辑宽度（主画布 CSS 逻辑尺寸，如 boardW / VIEW_W）
             * @param {number} h 贴回目标逻辑高度
             */
            blit(targetCtx, w, h) {
                if (dirty) {
                    // 赋 width/height 会整层清空并重置变换，等效原 renderGridLayer 的逐次重建
                    const dpr = parseFloat(mainCanvas.dataset.dpr) || 1;
                    layerCanvas.width = mainCanvas.width;
                    layerCanvas.height = mainCanvas.height;
                    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // 锁 CSS 逻辑坐标，绘制代码零换算
                    if (paint) paint(layerCtx);
                    dirty = false;
                }
                targetCtx.drawImage(layerCanvas, 0, 0, w, h);
            }
        };
    }

    /**
     * 成就墙 HUD 六件套工厂：#achWall/#achGrid/#achCount/#achTotal/#achBarFill/#achToastStack
     * 六个 id 的 DOM 查询单点收敛（snake/tetris 同构样板下沉；id 由共享 CSS 与 ach-common.js
     * 的 Ach.init mount 契约约定，业务页禁止擅改；其余游戏的成就墙变体不强制迁移）
     * @returns {{wall: Element, grid: Element, count: Element, total: Element, barFill: Element, toasts: Element}} 六件套集合：调用方按需解构为具名 const，保持既有引用点零改动
     */
    function createAchHud() {
        return {
            wall: document.getElementById('achWall'),
            grid: document.getElementById('achGrid'),
            count: document.getElementById('achCount'),
            total: document.getElementById('achTotal'),
            barFill: document.getElementById('achBarFill'),
            toasts: document.getElementById('achToastStack')
        };
    }

    // 系统级「减少动态效果」偏好全站唯一探测点：各库/大厅读取本值，禁止各自重复探测
    const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    return { onTrustedMessage, MSG, MSG_TARGET, saveJSON, loadJSON, loadJSONState, saveRaw, loadRaw, removeRaw, capturePointer, bindDifficultyButtons, prefersReducedMotion: REDUCED_MOTION, createGridLayer, createAchHud };
})();
window.Arcade = Arcade;
