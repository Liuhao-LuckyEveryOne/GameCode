/* ============================================================================
 * 像素街机厅 · 共享暂停层 pause-common.js
 * ----------------------------------------------------------------------------
 * 全站七游戏「暂停切换引擎」骨架的唯一实现（由各游戏 js 内的七份同构 togglePause
 * 下沉而来）：守卫准入 → 写游戏暂停标志 → 同步遮罩显隐 → BGM 挂起/接续 →
 * 暂停/恢复音效，这一公共序列的次序与收口在本库统一，各游戏只留差异件——
 *   守卫差异 —— canToggle 由游戏注入（各游戏状态机与成就墙冻结条件不同）
 *   落点差异 —— setPaused 由游戏注入（写自家标志 + 专属反馈：恢复提示行撤下 /
 *              计时基准重置 / 手势终止 / 键鼠状态清空等）
 *   音效差异 —— 1024 用专属 n1024Pause/n1024Resume，其余默认 uiPause/uiResume
 *   BGM 差异 —— snake/tetris 的快照续玩局不经 startGame 起播，恢复侧需幂等补
 *              起播（resumeBgmStart），其余游戏恢复侧只 resume
 * 三个入口的音效策略与既有行为逐一对齐：toggle 手动切换有声（键盘/遮罩点击/
 * 有声失焦共用的主干）；autoPause 静默自动暂停（klotski/bee 失焦 historically
 * 无声，其余五家失焦走有声 toggle）；resume 仅恢复（bee 点击/按键恢复专用）。
 *
 * 分层：装载期零依赖（先于业务 js 加载，加载序由 tests/check.py 检查项 3 守护）；
 *       调用期仅依赖 audio.js 的 SFX（BGM 与音效）；游戏状态经钩子注入，本库
 *       不直接读取任何游戏变量。失焦/切后台双通道注册仍归 snap-common.js 的
 *       Snap.bindFocusLoss（事件通道与暂停引擎各司其职，游戏清理函数自行决定
 *       调 toggle（有声）还是 autoPause（静默））。
 *
 * 挂载到 window：与 snap-common.js / ach-common.js 导出风格一致，游戏直接调用
 * Pause.create。
 * ==========================================================================*/

(function () {
    'use strict';

    /**
     * 创建一款游戏的暂停切换引擎（每游戏一实例；暂停/恢复的唯一出入口）。
     * 序列：setPaused 写游戏标志与专属落点 → 遮罩显隐（传入 overlay 时由库统一
     * 直写 display，bee 等动态文案遮罩不传、由 setPaused 内自行同步）→ BGM
     * pause/resume（恢复侧可选 resumeBgmStart 幂等补起播）→ 暂停/恢复音效
     * （autoPause 静默跳过暂停音，对齐 klotski/bee 失焦无声的既有行为）。
     * @param {{
     *   isPaused: Function,
     *   canToggle: Function,
     *   setPaused: Function,
     *   overlay: (Element|null)=,
     *   pauseSfx: (Function)=,
     *   resumeSfx: (Function)=,
     *   resumeBgmStart: (string)=
     * }} opts 引擎选项：isPaused 读当前暂停态（bee 双标记游戏返回合并读取）/
     *   canToggle 手动切换准入守卫（游戏状态机 + 成就墙冻结检查）/ setPaused
     *   (paused, byBlur) 落点：写游戏暂停标志 + 专属反馈（提示行撤下、计时基准
     *   重置、手势终止、键鼠清空等；byBlur=true 表示失焦自动暂停来源）/ overlay
     *   暂停遮罩元素（可省略，省略时显隐归 setPaused 自理）/ pauseSfx·resumeSfx
     *   暂停与恢复音效（缺省 SFX.uiPause / SFX.uiResume）/ resumeBgmStart 恢复侧
     *   幂等补起播的 BGM 曲名（仅 snake/tetris 需要，start 同名幂等不重启）
     * @returns {{toggle: Function, autoPause: Function, resume: Function}}
     *   引擎 API：toggle 手动切换（canToggle 守卫 + 有声，键盘 P/空格、遮罩点击
     *   与有声失焦共用）/ autoPause 静默自动暂停（仅暂停不恢复、不发声，失焦
     *   自动暂停专用）/ resume 仅恢复（已暂停时执行恢复序列，bee 点击与按键
     *   恢复入口专用）
     */
    function create(opts) {
        if (!opts || !opts.isPaused || !opts.canToggle || !opts.setPaused) {
            throw new Error('Pause.create 参数缺失（isPaused/canToggle/setPaused 必传）');
        }

        /**
         * 执行一次完整的暂停/恢复序列（内部共用；不做任何准入判断）
         * @param {boolean} next 目标暂停态：true 暂停 / false 恢复
         * @param {boolean} byBlur 是否失焦自动暂停来源（true 时静默跳过暂停音）
         */
        function enter(next, byBlur) {
            opts.setPaused(next, byBlur); // 游戏标志与专属落点先行（与既有实现一致：先置态再动遮罩/音频）
            if (opts.overlay) opts.overlay.style.display = next ? 'block' : 'none';
            if (next) {
                SFX.bgm.pause(); // 背景音乐挂起，与暂停遮罩同步
                if (!byBlur) (opts.pauseSfx || SFX.uiPause)(); // 失焦自动暂停不发声（历史行为对齐）
            } else {
                if (opts.resumeBgmStart) SFX.bgm.start(opts.resumeBgmStart); // 快照续玩局未起播时补起播（幂等）
                SFX.bgm.resume(); // 恢复背景音乐接续暂停前进度
                (opts.resumeSfx || SFX.uiResume)(); // 恢复：上行启动音
            }
        }

        return {
            /** 手动切换暂停/继续：canToggle 守卫不过即忽略（含成就墙打开期） */
            toggle: function () {
                if (!opts.canToggle()) return;
                enter(!opts.isPaused(), false);
            },
            /** 失焦自动暂停（静默）：已暂停时幂等跳过，仅暂停绝不自动恢复 */
            autoPause: function () {
                if (opts.isPaused()) return;
                enter(true, true);
            },
            /** 仅恢复（不暂停）：未暂停时空转；bee 的点击/任意键恢复入口专用 */
            resume: function () {
                if (!opts.isPaused()) return;
                enter(false, false);
            }
        };
    }

    /* ---------------------------- 导出 ---------------------------- */

    window.Pause = { create: create };
})();
