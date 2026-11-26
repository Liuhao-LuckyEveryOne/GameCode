'use strict';
/**
 * 3D弹球音效分册（audio-pinball.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
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
        /* ---------- 3D弹球音效 ---------- */
        /** 弹柱撞击：高频双音"叮"，清脆金属感 */
        pinBumper: () => { tone(1180, 0.05, 'square', 0.12); tone(1570, 0.08, 'square', 0.1, 0, 0.04); },
        /** 弹射器击飞：快速大幅上滑"嘣" */
        pinSling: () => tone(300, 0.09, 'square', 0.13, 900),
        /** 挡板拍击：极短低音"嗒" + 噪声敲击质感 */
        pinFlip: () => { tone(180, 0.04, 'triangle', 0.1); noise(0.03, 0.05, 600); },
        /** 发射：中频上滑长音，球离台入场的宣告 */
        pinLaunch: () => tone(400, 0.12, 'sawtooth', 0.1, 820),
        /** 墙壁碰撞：极短闷响（调用方需自行节流） */
        pinWall: () => tone(140, 0.03, 'triangle', 0.06),
        /** 失球：下滑哀鸣（球坠入深渊） */
        pinLose: () => tone(520, 0.32, 'sawtooth', 0.13, 110),
        /** 清障达成：清板目标全中的奖励上行四连琶音（随即掉落多球；原借小蜜蜂 beeWaveClear，v3.5 专属化移植） */
        pinClear: () => arpeggio([523, 659, 784, 1047], 0.07),
        /** S 级评级：明亮大调琶音 + 高音 sparkle 长尾，结算面板揭晓 S 级的荣耀音（原借华容道 klRankS，v3.5 专属化移植） */
        pinRankS: () => {
            arpeggio([523, 659, 784, 1047], 0.08, 'triangle', 0.11);
            tone(1568, 0.35, 'triangle', 0.08, 0, 0.36); // 高音 sparkle 长尾
            tone(2093, 0.3, 'sine', 0.05, 0, 0.44);
        },
    });
})();
