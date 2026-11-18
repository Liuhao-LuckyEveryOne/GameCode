'use strict';
/**
 * 贪吃蛇音效分册（audio-snake.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
 * 依赖 audio.js（合成引擎与 _tone/_noise/_arpeggio 原语），须在其后、业务 js 之前加载；
 * 挂载方式：Object.assign(SFX, {...})；原语经 SFX._tone / SFX._noise / SFX._arpeggio
 * 内部约定键取用（仅面向分册，业务代码禁止调用下划线键）
 */
(() => {
    const tone = SFX._tone;
    const noise = SFX._noise;
    const arpeggio = SFX._arpeggio;
    Object.assign(SFX, {
        /* ---------- 贪吃蛇音效 ---------- */
        /** 吃到食物：双音上行"啵" */
        snakeEat: () => { tone(440, 0.07, 'square', 0.15); tone(660, 0.1, 'square', 0.15, 0, 0.06); },
        /** 转向：极短低音"嗒" */
        snakeTurn: () => tone(220, 0.03, 'triangle', 0.07),
        /** 撞击死亡：下滑哀鸣 + 噪声炸裂（配合死亡熄灭演出，与结算音错开） */
        snakeDie: () => { tone(520, 0.4, 'sawtooth', 0.13, 80); noise(0.2, 0.07, 300); },
        /** 巨果出生：大食物落地双音（原借 1024 n1024Spawn4，v3.5 专属化移植） */
        /** 生成4：亮金双音（稀有 4 块登场的专属提示，与普通 2 的轻点音区分） */
        snakeSpawn4: () => { tone(700, 0.05, 'triangle', 0.09); tone(1050, 0.08, 'triangle', 0.08, 0, 0.05); },
        /** 咬空落空：冲刺落空下滑音（原借俄罗斯方块 tDrop，v3.5 专属化移植） */
        /** 硬降：快速下滑音 */
        snakeMiss: () => tone(600, 0.08, 'square', 0.08, 150),
        /** 穿越传送：蛇形上滑音（原借大厅卡片音 cardSnake，v3.5 专属化移植） */
        /** 贪吃蛇卡片：蛇形上滑音 */
        snakeWarp: () => tone(300, 0.12, 'sawtooth', 0.09, 600),
        /** 金苹果：稀有食物拾取琶音（原借小蜜蜂 beePowerup，v3.5 专属化移植） */
        /** 拾取道具：上行三连音（通用拾取反馈，贪吃蛇金苹果等场合复用） */
        snakeGolden: () => arpeggio([523, 784, 1047], 0.07, 'square', 0.12),
        /** 提速升级：速度提升六级琶音（原借俄罗斯方块 tLevelUp，v3.5 专属化移植） */
        /** 升级：六连快速琶音 */
        snakeSpeedUp: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.06),
    });
})();
