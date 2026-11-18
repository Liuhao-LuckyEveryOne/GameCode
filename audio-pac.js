'use strict';
/**
 * 吃豆人音效分册（audio-pac.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
 * 依赖 audio.js（合成引擎与 _tone/_noise/_arpeggio 原语），须在其后、业务 js 之前加载；
 * 挂载方式：Object.assign(SFX, {...})；原语经 SFX._tone / SFX._noise / SFX._arpeggio
 * 内部约定键取用（仅面向分册，业务代码禁止调用下划线键）
 */
(() => {
    const tone = SFX._tone;
    const noise = SFX._noise;
    const arpeggio = SFX._arpeggio;
    Object.assign(SFX, {
        /* ---------- 吃豆人音效 ---------- */
        /** 吃豆：交替双频 waka-waka */
        pacWaka: (alt) => tone(alt ? 550 : 380, 0.07, 'square', 0.1, alt ? 380 : 550),
        /** 能量豆：上行五连琶音，宣告反杀开始 */
        pacPower: () => arpeggio([262, 330, 392, 523, 659], 0.06, 'square', 0.13),
        /** 吃掉幽灵：低频大幅上滑的长音 */
        pacGhost: () => tone(200, 0.35, 'sawtooth', 0.14, 900),
        /** 死亡：长下滑哀鸣 + 噪声炸裂 */
        pacDeath: () => { tone(600, 0.5, 'sawtooth', 0.15, 80); noise(0.3, 0.08, 300); },
        /** 开场准备：三角波轻快旋律 */
        pacReady: () => arpeggio([523, 784, 659, 1047], 0.1, 'triangle', 0.12),
        /** 清版过关：上行五连琶音 */
        pacLevelUp: () => arpeggio([392, 523, 659, 784, 1047], 0.08),
        /** 幽灵回巢：幽灵抵达巢穴归位提示音（原借小蜜蜂 beeDashReady，v3.5 专属化移植） */
        /** 冲刺冷却就绪：清脆双高音提示 */
        pacGhostHome: () => { tone(880, 0.05, 'sine', 0.09); tone(1320, 0.08, 'sine', 0.09, 0, 0.05); },
        /** 1UP：加命奖励上行琶音（原借小蜜蜂 beeOneUp，v3.5 专属化移植） */
        /** 奖励 1UP：经典四音上行小旋律 */
        pacOneUp: () => arpeggio([659, 784, 1319, 1047], 0.09, 'square', 0.12),
        /** 水果临近：奖励水果现身提示双音（原借华容道 klNear，v3.5 专属化移植） */
        /** 临近出口：轻快上行双哔（曹操一步即可入出口、临门高亮点燃的提示） */
        pacFruitNear: () => { tone(880, 0.06, 'square', 0.08); tone(1175, 0.09, 'square', 0.08, 0, 0.09); },
    });
})();
