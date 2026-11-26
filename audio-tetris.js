'use strict';
/**
 * 俄罗斯方块音效分册（audio-tetris.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
 * 依赖 audio.js（合成引擎与 _tone/_noise/_arpeggio 原语），须在其后、业务 js 之前加载；
 * 挂载方式：Object.assign(SFX, {...})；原语经 SFX._tone / SFX._noise / SFX._arpeggio
 * 内部约定键取用（仅面向分册，业务代码禁止调用下划线键）
 */
(() => {
    // 防御性降级：audio.js 未加载（脚本顺序错误/加载失败）时 SFX 与合成原语可能缺失，
    // 引擎缺失整体跳过注册、原语以空函数兜底，保证本分册加载与音效调用不抛错中断游戏逻辑
    const noop = () => {};
    if (typeof SFX === 'undefined' || SFX === null) return;
    const pickPrimitive = (key) => (typeof SFX[key] === 'function' ? SFX[key] : noop);
    const tone = pickPrimitive('_tone');
    const noise = pickPrimitive('_noise');
    const arpeggio = pickPrimitive('_arpeggio');
    Object.assign(SFX, {
        /* ---------- 俄罗斯方块音效 ---------- */
        /** 移动/软降：极短低音 */
        tMove: () => tone(200, 0.03, 'triangle', 0.08),
        /** 旋转：短促中音 */
        tRotate: () => tone(320, 0.05, 'triangle', 0.1),
        /** 硬降：快速下滑音 */
        tDrop: () => tone(600, 0.08, 'square', 0.08, 150),
        /** 落地锁定：低音钝响 + 噪声撞击 */
        tLock: () => { tone(150, 0.08, 'square', 0.14); noise(0.06, 0.06, 400); },
        /** 消行：音高随消行数递增的琶音（1 行 4 音，2 行及以上 5 音封顶，不再逐档区分） */
        tClear: (lines) => arpeggio([523, 659, 784, 1047, 1319].slice(0, 3 + lines), 0.07),
        /** 升级：六连快速琶音 */
        tLevelUp: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.06),
        /** T-SPIN：上滑双音接高音闪（T 块旋入凹槽的"骚操作"达成提示） */
        tSpin: () => { tone(700, 0.08, 'square', 0.12, 1100); tone(1568, 0.16, 'square', 0.09, 0, 0.07); },
        /** 全消（ALL CLEAR）：六连琶音接高音 sparkle 长尾（清空整个棋盘的大奖仪式感） */
        allClear: () => { arpeggio([523, 659, 784, 1047, 1319, 1568], 0.08, 'square', 0.13); tone(2093, 0.35, 'sine', 0.07, 0, 0.5); },
    });
})();
