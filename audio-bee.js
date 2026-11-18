'use strict';
/**
 * 小蜜蜂音效分册（audio-bee.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
 * 依赖 audio.js（合成引擎与 _tone/_noise/_arpeggio 原语），须在其后、业务 js 之前加载；
 * 挂载方式：Object.assign(SFX, {...})；原语经 SFX._tone / SFX._noise / SFX._arpeggio
 * 内部约定键取用（仅面向分册，业务代码禁止调用下划线键）
 */
(() => {
    const tone = SFX._tone;
    const noise = SFX._noise;
    const arpeggio = SFX._arpeggio;
    Object.assign(SFX, {
        /* ---------- 小蜜蜂音效 ---------- */
        /** 射击：极短高频激光"哔" */
        beeShoot: () => tone(900, 0.05, 'square', 0.07, 480),
        /** 蜜蜂被击落：短促下滑 + 噪声碎裂 */
        beeDie: () => { tone(620, 0.09, 'square', 0.1, 220); noise(0.06, 0.06, 900); },
        /** 精英蜂受击未死：低频钝响（亦用于 Boss 受击） */
        beeArmorHit: () => tone(160, 0.06, 'square', 0.12),
        /** 精英蜂被击落：更低沉的双段爆裂 */
        beeEliteDie: () => { tone(420, 0.12, 'sawtooth', 0.11, 140); noise(0.1, 0.07, 500); },
        /** 俯冲警报：快速下滑啸音，提示玩家闪避 */
        beeDive: () => tone(1200, 0.25, 'sawtooth', 0.06, 300),
        /** Boss 登场警告：低频三连轰鸣（精英阵事件波亦复用） */
        beeBossWarn: () => { tone(98, 0.18, 'sawtooth', 0.14); tone(98, 0.18, 'sawtooth', 0.14, 0, 0.25); tone(98, 0.25, 'sawtooth', 0.16, 0, 0.5); },
        /** Boss 入场警报：低频三连轰鸣接三轮高音警笛滑降，总长约 1.8 秒与警告演出等长 */
        beeBossAlarm: () => {
            tone(98, 0.18, 'sawtooth', 0.14);
            tone(98, 0.18, 'sawtooth', 0.14, 0, 0.25);
            tone(98, 0.25, 'sawtooth', 0.16, 0, 0.5);
            tone(880, 0.28, 'sawtooth', 0.08, 440, 0.75);
            tone(880, 0.28, 'sawtooth', 0.09, 440, 1.1);
            tone(660, 0.32, 'sawtooth', 0.1, 330, 1.45);
        },
        /** Boss 被击败：长噪声爆炸 + 下行琶音 */
        beeBossDie: () => { noise(0.5, 0.12, 250); arpeggio([392, 330, 262, 196, 131], 0.1, 'sawtooth', 0.12); },
        /** Boss 落地冲击：超低频重锤 + 带通噪声轰鸣，配合震屏与尘爆粒子（入场演出收束） */
        beeBossLand: () => { tone(60, 0.32, 'sawtooth', 0.2, 28); tone(120, 0.18, 'square', 0.1, 50, 0.03); noise(0.28, 0.15, 130); },
        /** 玩家被击中：下滑哀鸣 + 噪声撞击 */
        beePlayerHit: () => { tone(560, 0.35, 'sawtooth', 0.14, 90); noise(0.2, 0.08, 350); },
        /** 护盾抵挡：清脆玻璃质感双音 */
        beeShieldHit: () => { tone(880, 0.05, 'triangle', 0.12); tone(1320, 0.08, 'triangle', 0.1, 0, 0.04); },
        /** 拾取道具：上行三连音（通用拾取反馈，贪吃蛇金苹果等场合复用） */
        beePowerup: () => arpeggio([523, 784, 1047], 0.07, 'square', 0.12),
        /** 拾取武器升级：五连急速上行琶音，火力递升的爆发感 */
        beePowerupWeapon: () => arpeggio([392, 523, 659, 784, 1047], 0.05, 'square', 0.12),
        /** 拾取护盾：三角波低→高充能上滑 + 高音尾音确认，能量充盈质感 */
        beePowerupShield: () => { tone(196, 0.26, 'triangle', 0.13, 784); tone(1047, 0.14, 'triangle', 0.11, 0, 0.24); },
        /** 拾取 1UP：温暖四连上行琶音 + 高音铃点，续命复苏感 */
        beePowerupLife: () => { arpeggio([523, 659, 784, 1047], 0.08, 'triangle', 0.13); tone(1568, 0.2, 'square', 0.08, 0, 0.32); },
        /** 连击倍率提升：音高随倍率递增的双音 */
        beeCombo: (mult) => { const f = 660 + mult * 120; tone(f, 0.06, 'square', 0.11); tone(f * 1.5, 0.09, 'square', 0.11, 0, 0.05); },
        /** 奖励 1UP：经典四音上行小旋律 */
        beeOneUp: () => arpeggio([659, 784, 1319, 1047], 0.09, 'square', 0.12),
        /** 清波奖励：上行琶音 */
        beeWaveClear: () => arpeggio([523, 659, 784, 1047], 0.07),
        /** 分裂蜂裂解：快速两段下滑 */
        beeSplit: () => { tone(760, 0.06, 'square', 0.1, 420); tone(420, 0.06, 'square', 0.1, 220, 0.06); },
        /** 自爆蜂引爆：噪声爆裂 + 低频冲击 */
        beeBomberBoom: () => { noise(0.25, 0.11, 350); tone(120, 0.25, 'sawtooth', 0.13, 40); },
        /** 冲刺：快速上滑嗖音 */
        beeDash: () => tone(300, 0.12, 'sawtooth', 0.08, 900),
        /** 激光射击：高频电音 zap */
        beeLaser: () => tone(1400, 0.06, 'sawtooth', 0.06, 700),
        /** 全屏炸弹：长噪声巨响 + 低音轰鸣 */
        beeBomb: () => { noise(0.45, 0.13, 200); tone(80, 0.4, 'sawtooth', 0.15, 30); },
        /** 时停：下行滑音接回弹，时间扭曲质感 */
        beeSlow: () => { tone(900, 0.3, 'sine', 0.1, 200); tone(200, 0.2, 'sine', 0.08, 500, 0.3); },
        /** 磁铁：短促双上滑音 */
        beeMagnet: () => { tone(500, 0.08, 'triangle', 0.11, 900); tone(700, 0.1, 'triangle', 0.1, 1200, 0.07); },
        /** 成就解锁：胜利五连琶音 */
        beeAchievement: () => arpeggio([523, 659, 784, 880, 1319], 0.09, 'square', 0.12),
        /** 冲刺冷却就绪：清脆双高音提示 */
        beeDashReady: () => { tone(880, 0.05, 'sine', 0.09); tone(1320, 0.08, 'sine', 0.09, 0, 0.05); },
        /** 蜂群碰壁下压：低沉钝响 */
        beeThud: () => tone(70, 0.12, 'square', 0.13, 45),
        /** Boss 狂暴：急促上行警示双鸣 */
        beeEnrage: () => { tone(150, 0.1, 'sawtooth', 0.12, 240); tone(240, 0.16, 'sawtooth', 0.13, 360, 0.1); },
        /** 低命警报：急促双哔 */
        beeAlarm: () => { tone(740, 0.09, 'square', 0.1); tone(740, 0.09, 'square', 0.1, 0, 0.16); },
        /** 连环殉爆小爆：中频噪声短爆 */
        beeBoom: () => { noise(0.12, 0.09, 500); tone(200, 0.12, 'square', 0.08, 60); },
        /** 新纪录达成：辉煌六连琶音 */
        beeRecord: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.09, 'square', 0.12),
    });
})();
