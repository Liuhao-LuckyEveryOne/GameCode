/* ============================================================================
 * 像素街机厅 · 共享成就系统 ach-common.js
 * ----------------------------------------------------------------------------
 * 全站七游戏成就逻辑的唯一实现（v3.0 起由各游戏 js 内的七份同构实现下沉而来）：
 *   存档装载与三代格式迁移（v1 数组 → v2 { unlocked, best }）
 *   → trackRunStat 历史最佳追踪（只增不减，超越即落盘并连带扫描挂靠成就）
 *   → unlockAchievement 幂等解锁（toast + 解锁音 + 史诗/传说金色烟花）
 *   → 成就墙渲染（卡片网格 canonical 标记 + 完成度补间）
 *   → 开合控制（V 开 / Esc 关 / 遮罩与关闭按钮 / 主循环查询 isOpen）
 *
 * 分层：依赖 arcade-common.js（Arcade 安全存储） audio.js（SFX） fx.js（FX 补间/烟花），
 *       位于业务 js 之前加载（加载序由 tests/check.py 检查项 3 守护）。
 *       皮肤（墙/toast 的 CSS）与成就定义表仍归各游戏所有——本库只认类名契约
 *       （.ach-panel/.ach-head/.ach-grid/.ach-card/.ach-toast 等，见 docs/技术文档.md）。
 * 挂载契约（v3.1 双模式）：页面可只留 <div id="achWall" hidden></div> 锚元素，整墙 DOM
 *       由本库构建（id/类名与旧页面 markup 逐字一致，保 CSS 契约与无头测试查询兼容）；
 *       旧式页面（wall 内已有完整 DOM）照常按 id 提取引用回填 mount，双模式向后兼容。
 *
 * 挂载到 window：与 fx.js / arcade-common.js 导出风格一致；
 * Ach.init(opts) 完成后实例方法上提合并到 window.Ach（toggle/isOpen/trackRunStat 等），
 * 供外部脚本与无头测试直接调用（页面内按钮接线由本库统一 addEventListener，无需内联 onclick）。
 * ==========================================================================*/

(function () {
    'use strict';

    /* ---------------------------- 共享常量 ---------------------------- */

    // 稀有度 → 中文标签（卡片左上角徽章文案；七游戏原实现逐字一致，故收编入共享层）
    const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };

    // toast 兜底清理时限：动画事件丢失（标签页隐藏时 animationend 不触发）导致节点残留的保险
    const TOAST_FALLBACK_MS = 6000;

    // toast 堆叠上限：连续解锁时最旧的先出（原七游戏各自为 3/4/无上限，统一取中值）
    const TOAST_STACK_MAX = 4;

    // 完成度计数滚动补间时长（FX.tweenNumber 在 prefers-reduced-motion 下自动降级直写）
    const COUNT_TWEEN_MS = 320;

    /* ---------------------------- 内部工具 ---------------------------- */

    /**
     * 判定对象是否含有自有属性（与原实现一致走 hasOwnProperty.call，
     * 避免 id 恰为 'toString' 等原型键时的误判）
     * @param {Object<string, *>} obj 待查询对象
     * @param {string} key 属性键
     * @returns {boolean} 是否自有属性
     */
    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    /* ---------------------------- 存档装载 ---------------------------- */

    /**
     * 装载成就存档并归一到 v2 格式（兼容三代历史数据，迁移结果立即落盘固化）：
     *   null/损坏     → 全新空档（历史最佳取 bestDefaults）
     *   v1 数组       → 逐 id 迁移为解锁时间戳 0（"已达成"兜底文案，与原实现一致）
     *   v2 对象       → 直接使用，并补齐 bestDefaults 新增统计键（前向兼容新版本定义）
     * 游戏如有自有迁移需求（如 pac 旧键 pacDotsTotal 并入、bee 双代旧键），
     * 经 opts.migrate(raw) 钩子优先处理，返回 null 时回退本默认迁移。
     * @param {{storageKey: string, bestDefaults: Object<string, number>, migrate?: Function}} opts 初始化选项
     * @returns {{unlocked: Object<string, number>, best: Object<string, number>}} v2 成就存档
     */
    function loadStore(opts) {
        const raw = Arcade.loadJSON(opts.storageKey, null);
        // 游戏自有迁移钩子优先（传入即调用，返回合法 v2 形状则直接采用并落盘）
        if (typeof opts.migrate === 'function') {
            const migrated = opts.migrate(raw);
            if (migrated && migrated.unlocked && migrated.best) {
                Arcade.saveJSON(opts.storageKey, migrated); // 迁移即固化，避免每次装载重复迁移
                return migrated;
            }
            // 钩子未接手（返回 null/形状非法）：落入下方默认迁移
        }
        if (raw && !Array.isArray(raw) && raw.unlocked && raw.best) {
            // v2 现役格式：浅拷贝防御外部误改，并补齐新版定义新增的统计键
            const best = Object.assign({}, opts.bestDefaults, raw.best);
            return { unlocked: Object.assign({}, raw.unlocked), best: best };
        }
        // v1 数组 → v2：旧解锁无时间戳统一记 0（成就墙显示"已达成"而非具体日期）
        const unlocked = {};
        if (Array.isArray(raw)) {
            for (const id of raw) unlocked[id] = 0;
        }
        Arcade.saveJSON(opts.storageKey, { unlocked: unlocked, best: Object.assign({}, opts.bestDefaults) });
        return { unlocked: unlocked, best: Object.assign({}, opts.bestDefaults) };
    }

    /* ---------------------------- 挂载 DOM 双模式保障 ---------------------------- */

    /**
     * 挂载 DOM 双模式保障（Wave1 向后兼容，Wave2 起页面只留锚元素）：
     * ① 旧式页面——mount.wall 内已有完整成就墙 DOM：仅在 wall 内按现网 markup 的 id
     *    提取 grid/count/total/barFill 引用，toast 栈按现网实际 DOM 位置（body 直下、
     *    紧随 achWall 的兄弟节点）在文档级按 id 查取，全部回填 mount；
     * ② 新式锚元素——页面只留 <div id="achWall" hidden></div>（wall 无子元素）：库内以
     *    与旧页面 markup 逐字相同的 id/类名/层级 createElement 构建整墙（.ach-panel、
     *    头部、关闭按钮、#achCount/#achTotal、进度条、#achGrid），toast 栈同样按现网
     *    实际 DOM 位置（wall 的下一个兄弟节点）创建。
     * id/类名与旧页面 markup 逐字一致：保 CSS 契约与无头测试查询兼容（两模式均成立）
     * @param {{wall: HTMLElement, grid?: HTMLElement, count?: HTMLElement, total?: HTMLElement,
     *           barFill?: HTMLElement, toasts?: HTMLElement}} mount 挂载对象（节点引用回填其上，
     *           游戏侧若持有引用照旧可用）
     */
    function ensureMountDom(mount) {
        if (mount.wall.childElementCount > 0) {
            // 旧式页面：整墙 DOM 已在页面 markup 中，仅提取引用（未命中时回退调用方传入值）
            mount.grid = mount.wall.querySelector('#achGrid') || mount.grid || null;
            mount.count = mount.wall.querySelector('#achCount') || mount.count || null;
            mount.total = mount.wall.querySelector('#achTotal') || mount.total || null;
            mount.barFill = mount.wall.querySelector('#achBarFill') || mount.barFill || null;
            // toast 栈不在 wall 内（body 直下兄弟节点），文档级按 id 查
            mount.toasts = document.getElementById('achToastStack') || mount.toasts || null;
            return;
        }
        // 新式锚元素：库内构建整墙（id/类名与旧页面 markup 逐字一致，保 CSS 契约与无头测试查询兼容）
        const panel = document.createElement('div');
        panel.className = 'ach-panel';
        const head = document.createElement('div');
        head.className = 'ach-head';
        const titleWrap = document.createElement('div');
        titleWrap.className = 'ach-title-wrap';
        const title = document.createElement('div');
        title.className = 'ach-title';
        title.textContent = '成就墙';
        const sub = document.createElement('div');
        sub.className = 'ach-sub';
        sub.textContent = 'ACHIEVEMENT WALL';
        titleWrap.appendChild(title);
        titleWrap.appendChild(sub);
        const progress = document.createElement('div');
        progress.className = 'ach-progress';
        const countLine = document.createElement('div');
        countLine.className = 'ach-count';
        const count = document.createElement('span');
        count.id = 'achCount';
        count.textContent = '0';
        const total = document.createElement('span');
        total.id = 'achTotal';
        total.textContent = '0';
        countLine.appendChild(count);
        countLine.appendChild(document.createTextNode(' / ')); // 与旧 markup 的"0 / 0"间隔逐字一致
        countLine.appendChild(total);
        const bar = document.createElement('div');
        bar.className = 'ach-bar';
        const barFill = document.createElement('div');
        barFill.className = 'ach-bar-fill';
        barFill.id = 'achBarFill';
        bar.appendChild(barFill);
        progress.appendChild(countLine);
        progress.appendChild(bar);
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ach-close';
        closeBtn.setAttribute('aria-label', '关闭成就墙');
        closeBtn.textContent = '✕';
        head.appendChild(titleWrap);
        head.appendChild(progress);
        head.appendChild(closeBtn);
        const grid = document.createElement('div');
        grid.className = 'ach-grid';
        grid.id = 'achGrid';
        const foot = document.createElement('div');
        foot.className = 'ach-foot';
        foot.textContent = '继续挑战解锁全部成就 · 史诗 / 传说级成就达成时附赠金色烟花庆典';
        panel.appendChild(head);
        panel.appendChild(grid);
        panel.appendChild(foot);
        mount.wall.appendChild(panel);
        // toast 栈按现网 markup 的实际 DOM 位置创建：body 直下、紧随 achWall 的兄弟节点（不在 wall 内）
        const toasts = document.createElement('div');
        toasts.id = 'achToastStack';
        toasts.setAttribute('aria-live', 'polite');
        mount.wall.insertAdjacentElement('afterend', toasts);
        mount.grid = grid;
        mount.count = count;
        mount.total = total;
        mount.barFill = barFill;
        mount.toasts = toasts;
    }

    /* ---------------------------- 初始化入口 ---------------------------- */

    /**
     * 为当前游戏初始化成就系统（每页一实例；本函数无重复调用守卫——重复调用会重复装载存档
     * 并重复注册监听，调用方须保证每页仅初始化一次）
     * 完成后实例方法合并到 window.Ach，供外部脚本与无头测试直接调用。
     * @param {{
     *   defs: Array<{id: string, name: string, icon: string, desc: string, cat: string,
     *               rarity: 'common'|'rare'|'epic'|'legendary', stat: string, target: number}>,
     *   storageKey: string,
     *   bestDefaults: Object<string, number>,
     *   mount: {wall: HTMLElement, grid?: HTMLElement, count?: HTMLElement,
     *           total?: HTMLElement, barFill?: HTMLElement, toasts?: HTMLElement},
     *   sfx?: {unlock?: Function, ui?: Function},
     *   canOpen?: Function,
     *   onToggle?: Function,
     *   migrate?: Function
     * }} opts 初始化选项：defs 定义表 / storageKey 存档键 / bestDefaults 统计默认值 /
     *   mount 仅 wall 必传——旧式页面（wall 内已有 DOM）按 id 提取六节点引用回填，
     *   新式锚元素（wall 为空）由库内构建整墙 DOM 并回填（见 ensureMountDom） /
     *   sfx 音效钩子（默认 newRecord 与 uiClick） / canOpen V 键开墙前置守卫
     *   （如「仅游戏进行中可开」） / onToggle 开合回调（挂起/恢复 BGM 等游戏副作用，
     *   参数 open 布尔） / migrate 自有迁移钩子（见 loadStore）
     * @returns {{toggle: Function, open: Function, close: Function, isOpen: Function,
     *            trackRunStat: Function, unlock: Function, getStore: Function, renderWall: Function}}
     *   实例 API（同时已合并到 window.Ach）
     */
    function init(opts) {
        if (!opts || !Array.isArray(opts.defs) || !opts.storageKey || !opts.bestDefaults ||
            !opts.mount || !opts.mount.wall) {
            throw new Error('Ach.init 参数缺失（defs/storageKey/bestDefaults/mount.wall 必传，其余节点由库内兜齐）');
        }
        const defs = opts.defs;
        const store = loadStore(opts);
        // 挂载 DOM 双模式保障：旧式页面提取引用，新式锚元素库内构建（详见 ensureMountDom）
        ensureMountDom(opts.mount);

        const state = { open: false };

        /* ---- 存档持久化：存储不可用时静默放弃，不影响游戏（Arcade 内部已兜底） ---- */
        function saveStore() {
            Arcade.saveJSON(opts.storageKey, store);
        }

        /* ---- 成就解锁 toast ---- */
        /**
         * 弹出一条解锁 toast（canonical 标记写入 mount.toasts）：播放完
         * 入场-停留-退场全周期动画（toastCycle，各游戏 CSS 自定时长，约定 3.2s）
         * 命中 animationend 自动移除；另设 6s 兜底清理防动画事件丢失；堆叠超限挤掉最旧
         * @param {{name: string, icon: string, rarity: string}} meta 成就定义
         */
        function showToast(meta) {
            const stack = opts.mount.toasts;
            if (!stack) return;
            // 堆叠上限：连续解锁时移除最旧一条，避免长时间连爆刷屏遮挡
            while (stack.childElementCount >= TOAST_STACK_MAX) {
                stack.firstElementChild.remove();
            }
            const el = document.createElement('div');
            el.className = 'ach-toast rarity-' + meta.rarity;
            el.innerHTML = '<span class="toast-icon">' + meta.icon + '</span>' +
                '<div class="toast-body"><span class="toast-cap">成就解锁</span>' +
                '<span class="toast-name">' + meta.name + '</span></div>';
            stack.appendChild(el);
            el.addEventListener('animationend', (ev) => {
                if (ev.animationName === 'toastCycle') el.remove();
            });
            setTimeout(() => { if (el.parentNode) el.remove(); }, TOAST_FALLBACK_MS);
        }

        /* ---- 解锁 ---- */
        /**
         * 解锁成就（幂等：已解锁直接短路返回 false，时间戳不被覆盖）
         * 新解锁 → 持久化时间戳 → toast → 解锁音 → 史诗/传说级全屏金色烟花
         * @param {string} id 成就 id（见游戏定义表）
         * @returns {boolean} 是否发生了新解锁（klotski 结算面板据其收集本局新达成分支）
         */
        function unlock(id) {
            if (hasOwn(store.unlocked, id)) return false;
            store.unlocked[id] = Date.now();
            saveStore();
            const meta = defs.find((a) => a.id === id);
            if (!meta) return false;
            showToast(meta);
            (opts.sfx && opts.sfx.unlock ? opts.sfx.unlock : SFX.newRecord)(); // 复用破纪录号角（bee 等可经 sfx 钩子换音）
            if (meta.rarity === 'epic' || meta.rarity === 'legendary') FX.recordBurst();
            return true;
        }

        /* ---- 历史最佳追踪 ---- */
        /**
         * 追踪一项历史最佳（只增不减）：超越旧值时立即落盘，并连带检查挂靠在该
         * 统计项上的全部成就（如 score 同时驱动百分俱乐部/得分大师两档）
         * @param {string} stat 统计项键（见游戏 bestDefaults）
         * @param {number} value 本局当前值
         */
        function trackRunStat(stat, value) {
            if (!(value > store.best[stat])) return;
            store.best[stat] = value;
            saveStore();
            // 最佳值更新后扫描定义表：目标达成者逐个解锁（unlock 幂等，跨档重扫安全）
            for (const a of defs) {
                if (a.stat === stat && value >= a.target) unlock(a.id);
            }
        }

        /* ---- 成就墙渲染 ---- */
        /**
         * 渲染墙内容：按定义表 × 最新存档生成卡片网格（canonical 标记，七游戏皮肤共用类名契约）。
         * 已解锁按稀有度点亮并流光扫过 / 未解锁灰暗锁定态；进度条截断封顶 100%；
         * 头部完成度计数滚动补间、总进度条宽度过渡；卡片瀑布入场由 CSS 按 --i 序号延迟驱动
         */
        function renderWall() {
            let html = '';
            let gotCount = 0;
            for (let i = 0; i < defs.length; i++) {
                const a = defs[i];
                const got = hasOwn(store.unlocked, a.id);
                if (got) gotCount++;
                const ts = got ? store.unlocked[a.id] : 0;
                // 事件型成就（unlock 直调，stat/target 缺失或 target≤0）无进度语义：
                // 恒显 0 进度，进度文案以「事件达成」标注，避免 NaN/undefined 渲染
                const hasProg = typeof a.stat === 'string' && a.stat && a.target > 0;
                const best = hasProg ? Math.min(store.best[a.stat] || 0, a.target) : 0;
                const pct = hasProg ? Math.min(100, Math.round((best / a.target) * 100)) : 0;
                // 达成日期：迁移的旧解锁无时间戳（记 0），显示"已达成"兜底
                const dateText = got ?
                    (ts ? '达成于 ' + new Date(ts).toLocaleDateString('zh-CN') : '已达成') :
                    a.cat + ' · 尚未达成';
                html += '<div class="ach-card ' + (got ? 'unlocked rarity-' + a.rarity : 'locked') +
                    '" style="--i:' + i + '">' +
                    '<span class="ach-rarity-chip rarity-' + a.rarity + '">' + RARITY_LABEL[a.rarity] + '</span>' +
                    '<div class="ach-icon"><span class="ach-emoji">' + a.icon + '</span>' +
                    (got ? '' : '<span class="ach-lock">🔒</span>') + '</div>' +
                    '<div class="ach-info">' +
                    '<div class="ach-name">' + a.name + '</div>' +
                    '<p class="ach-desc">' + a.desc + '</p>' +
                    '<div class="ach-prog"><div class="ach-prog-fill" style="width:' + pct + '%"></div></div>' +
                    '<div class="ach-prog-meta"><span>' + (hasProg ? best + ' / ' + a.target : '事件达成') + '</span><span>' + dateText + '</span></div>' +
                    '</div></div>';
            }
            opts.mount.grid.innerHTML = html;
            // 头部完成度：已解锁计数滚动补间 + 总数 + 总进度条
            FX.tweenNumber(opts.mount.count, gotCount, COUNT_TWEEN_MS, (v) => String(Math.round(v)));
            opts.mount.total.textContent = String(defs.length);
            opts.mount.barFill.style.width = Math.round((gotCount / defs.length) * 100) + '%';
        }

        /* ---- 开合控制 ---- */
        /**
         * 开合成就墙：打开时先按最新存档重绘内容（瀑布入场与流光自动重播），
         * 随后经 onToggle 回调通知游戏挂起/恢复自有副作用（BGM、冻结标记、清输入等）
         * @param {boolean} [force] 省略时翻转；传入 true/false 强制开/关（幂等）
         */
        function toggle(force) {
            const next = typeof force === 'boolean' ? force : !state.open;
            if (next === state.open) return; // 幂等守卫：重复开关不重播动画不重复播音
            state.open = next;
            if (state.open) {
                renderWall();
                opts.mount.wall.hidden = false;
            } else {
                opts.mount.wall.hidden = true;
            }
            (opts.sfx && opts.sfx.ui ? opts.sfx.ui : SFX.uiClick)();
            if (typeof opts.onToggle === 'function') opts.onToggle(state.open);
        }

        /** 关闭墙（若未打开则空操作）；开局/读档时的防御性收墙走此入口 */
        function close() {
            if (state.open) toggle(false);
        }

        /* ---- 事件接线（遮罩 / 关闭按钮 / 键盘） ---- */

        // 点击遮罩空白处关闭（面板区域内的点击不触发）；pointerdown 亦兼容（原 tetris/pinball 用法）
        opts.mount.wall.addEventListener('click', (event) => {
            if (event.target === opts.mount.wall) toggle(false);
        });

        // 关闭按钮（各游戏 html .ach-close 已存在则接线；金杯触发器派发的合成 KeyV 同样走下方键盘分支）
        const closeBtn = opts.mount.wall.querySelector('.ach-close');
        if (closeBtn) closeBtn.addEventListener('click', () => toggle(false));

        // V 开 / Esc 关（与原各游戏分支语义一致：Esc 仅在墙打开时拦截，不影响其它 Esc 用途）
        window.addEventListener('keydown', (ev) => {
            const isV = ev.code === 'KeyV' || ev.key === 'v' || ev.key === 'V';
            if (isV) {
                if (ev.repeat) return; // 防长按连发：系统按键重复率下反复切换成就墙开合
                // canOpen 守卫缺省恒可开；游戏以回调表达原分支条件（如仅暂停/进行中放行）
                if (!opts.canOpen || opts.canOpen()) {
                    ev.preventDefault();
                    toggle();
                }
                return;
            }
            if (ev.key === 'Escape' && state.open) {
                ev.preventDefault();
                toggle(false);
            }
        });

        /* ---- 实例 API（合并到 window.Ach，供外部脚本与无头测试调用） ---- */
        const api = {
            toggle: toggle,
            open: () => toggle(true),
            close: close,
            isOpen: () => state.open,
            trackRunStat: trackRunStat,
            unlock: unlock,
            getStore: () => store,
            renderWall: renderWall
        };
        Object.assign(window.Ach, api);
        return api;
    }

    /* ---------------------------- 导出 ---------------------------- */

    window.Ach = { init: init, RARITY_LABEL: RARITY_LABEL };
})();
