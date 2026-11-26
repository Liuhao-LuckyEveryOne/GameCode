'use strict';
/**
 * 1024音效分册（audio-1024.js）—— v3.5（20261118）自 audio.js 游戏专属音效区拆出
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
        /* ---------- 1024 音效 ---------- */
        /** 滑动：短促三角波推移音（方块整体滑动碰撞感） */
        n1024Move: () => tone(260, 0.06, 'triangle', 0.09, 180),
        /** 合并：音高随合并值档位递升的双击音（数字越大音越亮，delay 支持多重合并错峰） */
        n1024Merge: (value, delay = 0) => {
            const step = Math.max(1, Math.round(Math.log2(Math.max(value, 2) / 2)));
            const f = 420 + Math.min(step, 9) * 70;
            tone(f, 0.07, 'square', 0.11, f * 1.25, delay);
            tone(f * 1.5, 0.09, 'square', 0.09, 0, delay + 0.05);
        },
        /** 生成：新块落下的轻点音 */
        n1024Spawn: () => tone(500, 0.04, 'sine', 0.06, 380),
        /** 胜利：达成 1024 的上行琶音 + 高音闪亮收尾 */
        n1024Win: () => { arpeggio([523, 659, 784, 1047, 1319, 1568], 0.09, 'square', 0.13); tone(2093, 0.3, 'sine', 0.06, 0, 0.55); },
        /** 失败：无路可走的下行琶音 */
        n1024Over: () => arpeggio([392, 330, 262, 196], 0.12, 'sawtooth', 0.12),
        /** 破纪录：结算面板五连升音 */
        n1024Record: () => arpeggio([523, 659, 784, 1047, 1319], 0.09, 'square', 0.12),
        /** 连击：音高随连击档位递升的双音（连击越长音越亢奋，封顶防刺耳） */
        n1024Combo: (level) => { const f = 560 + Math.min(level, 8) * 70; tone(f, 0.06, 'square', 0.1); tone(f * 1.5, 0.09, 'square', 0.09, 0, 0.05); },
        /** 里程碑：上行四连琶音接高音闪（首次达成里程碑数值的仪式感） */
        n1024Milestone: () => { arpeggio([523, 659, 784, 1047], 0.07, 'square', 0.12); tone(1568, 0.18, 'sine', 0.07, 0, 0.3); },
        /** 撤销：两段下滑回溯音（时光倒流的低回质感） */
        n1024Undo: () => { tone(430, 0.06, 'triangle', 0.1); tone(280, 0.09, 'triangle', 0.1, 0, 0.06); },
        /** 无效滑动：低频闷响（整盘无路可动的撞墙反馈） */
        n1024Block: () => tone(110, 0.08, 'square', 0.12, 70),
        /** 烟花：噪声绽裂 + 高音下滑余韵（胜利烟花秀每波伴奏） */
        n1024Firework: () => { noise(0.18, 0.08, 600); tone(1500, 0.14, 'sine', 0.05, 420, 0.03); },
        /** 生成4：亮金双音（稀有 4 块登场的专属提示，与普通 2 的轻点音区分） */
        n1024Spawn4: () => { tone(700, 0.05, 'triangle', 0.09); tone(1050, 0.08, 'triangle', 0.08, 0, 0.05); },
        /** 多重合并：一步内多次合并的华彩琶音（合并次数越多音阶越长越华丽，封顶防噪） */
        n1024Multi: (n) => arpeggio([523, 659, 784, 1047, 1319].slice(0, Math.min(2 + n, 5)), 0.06, 'square', 0.12),
        /** 危险预警：空格告急的警报哔（预警级单哔 / 危急级更低沉双哔，压迫感逐级抬升） */
        n1024Danger: (level) => { const f = level >= 2 ? 330 : 440; tone(f, 0.09, 'square', 0.1); if (level >= 2) tone(f, 0.09, 'square', 0.1, 0, 0.14); },
        /** 暂停：下行双音（时间冻结的收束感） */
        n1024Pause: () => { tone(520, 0.07, 'triangle', 0.09); tone(360, 0.09, 'triangle', 0.08, 0, 0.07); },
        /** 恢复：上行双音（解除暂停重新出发的推进感） */
        n1024Resume: () => { tone(360, 0.06, 'triangle', 0.08); tone(560, 0.08, 'triangle', 0.09, 0, 0.06); },
        /** 死局熄灭：长下滑哀鸣（全盘灯火渐暗演出的伴奏，与结算琶音错峰两段式） */
        n1024Fade: () => tone(420, 0.7, 'sawtooth', 0.1, 60),
    });
})();
