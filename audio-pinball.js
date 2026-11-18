'use strict';
/**
 * 3D弹球音效分册（audio-pinball.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
 * 依赖 audio.js（合成引擎与 _tone/_noise/_arpeggio 原语），须在其后、业务 js 之前加载；
 * 挂载方式：Object.assign(SFX, {...})；原语经 SFX._tone / SFX._noise / SFX._arpeggio
 * 内部约定键取用（仅面向分册，业务代码禁止调用下划线键）
 */
(() => {
    const tone = SFX._tone;
    const noise = SFX._noise;
    const arpeggio = SFX._arpeggio;
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
        /** 消行清屏：清障成功四连琶音（原借小蜜蜂 beeWaveClear，v3.5 专属化移植） */
        /** 清波奖励：上行琶音 */
        pinClear: () => arpeggio([523, 659, 784, 1047], 0.07),
        /** S 评级：最高评价荣耀音（原借华容道 klRankS，v3.5 专属化移植） */
        /** S 级评级专属：明亮大调琶音 + 高音 sparkle 长尾（结算面板揭晓 S 级的仪式感） */
        pinRankS: () => {
            arpeggio([523, 659, 784, 1047], 0.08, 'triangle', 0.11);
            tone(1568, 0.35, 'triangle', 0.08, 0, 0.36); // 高音 sparkle 长尾
            tone(2093, 0.3, 'sine', 0.05, 0, 0.44);
        },
    });
})();
