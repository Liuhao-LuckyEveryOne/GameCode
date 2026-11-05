'use strict';

/* ======================================================================
 * 吃豆人 (PAC-MAN) —— 复古街机风 Canvas 实现
 * 19x21 迷宫、四幽灵 AI（scatter/chase 相位 + 惊惧 + 回巢）、
 * 能量豆反杀连击、生命与关卡推进
 * 手感：方向预输入队列（快速连按不丢键）+ 近格心预转向吸附（低延迟转向）
 * 特效：能量豆全屏蓝闪 / 吃豆·吃幽灵粒子迸溅 /
 *      幽灵眼睛回巢拖尾 / 吃豆人移动残影 / 能量豆倒计时环（剩余反杀时间）/
 *      得分飘字弹跳放大
 * 体验升级：迷宫离屏缓存 + DPR 高清适配 / 左右穿墙隧道 /
 *      水果奖励（70/170 颗豆触发） / 幽灵随关提速 / 1UP 奖励命 /
 *      反杀连吃音效 / BGM 接入 / 破纪录庆祝 / 精致 DOM 成就墙（V/Esc 开合，8 条成就四档稀有度）/
 *      CRT 开关机音 / prefers-reduced-motion 动效降级
 * ==================================================================== */

/* ===================== 常量定义 ===================== */

/** 单个迷宫格子的像素尺寸 */
const CELL = 24;

/** 迷宫布局：# 墙 . 豆 o 能量豆 = 幽灵门 G 幽灵屋内部 P 吃豆人出生点 */
const MAZE = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.###.#.###.####',
    '####.#.......#.####',
    '####.#.##=##.#.####',
    '####.#.#GGG#.#.####',
    '     #.#####.#     ', // 中间行左右两侧为穿墙隧道（空格 = 无豆通道），与 col4/col14 竖向通道相连
    '####.#.......#.####',
    '####.#.#####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'
];
/** 迷宫行数 */
const ROWS = MAZE.length;
/** 迷宫列数 */
const COLS = MAZE[0].length;

/** 地形类型：墙 */
const T_WALL = 0;
/** 地形类型：空地 */
const T_EMPTY = 1;
/** 地形类型：普通豆子 */
const T_DOT = 2;
/** 地形类型：能量豆 */
const T_POWER = 3;
/** 地形类型：幽灵门 */
const T_DOOR = 4;

/** 方向向量表 */
const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
};
/** 反方向对照表 */
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
/** 幽灵选路时的候选顺序（经典平局优先级：上左下右） */
const DIR_ORDER = ['up', 'left', 'down', 'right'];

/** 幽灵屋门口外的格（exit 模式目标点） */
const EXIT = { x: 9, y: 7 };
/** 幽灵屋内部中心格（eyes 模式目标点） */
const HOME = { x: 9, y: 9 };

/** 幽灵相位循环：[模式, 持续秒数]，循环往复 */
const PHASES = [['scatter', 5], ['chase', 18]];

/** 四只幽灵定义：名字 / 颜色 / 散开角 / 出生格 / 出屋延迟（秒） */
const GHOST_DEFS = [
    { name: 'blinky', color: '#ff3b3b', scatter: { x: 17, y: 1 }, spawn: { x: 9, y: 7 }, releaseDelay: 0 },
    { name: 'pinky',  color: '#ffb8de', scatter: { x: 1, y: 1 },  spawn: { x: 9, y: 9 }, releaseDelay: 2 },
    { name: 'inky',   color: '#35e0ff', scatter: { x: 1, y: 19 }, spawn: { x: 8, y: 9 }, releaseDelay: 4 },
    { name: 'clyde',  color: '#ffb347', scatter: { x: 17, y: 19 }, spawn: { x: 10, y: 9 }, releaseDelay: 6 }
];

/** 吃豆人基础速度（像素/秒，随关卡提升） */
const PAC_BASE_SPEED = 105;
/** 吃豆人速度上限（像素/秒） */
const PAC_MAX_SPEED = 150;
/** 转向预输入队列最大深度：同时保留"当前意图 + 下一意图"，快速连按两下不丢第一下 */
const DIR_QUEUE_MAX = 2;
/** 近格心预转向吸附距离（像素）：进入该范围即提前完成转向，压缩按键响应延迟（街机原版允许约 50% 格预转，此处取 25% 保守值） */
const TURN_SNAP_DIST = CELL * 0.25;
/** 吃豆人与幽灵的碰撞判定半径（像素） */
const HIT_RADIUS = CELL * 0.55;
/** 死亡动画时长（秒） */
const DEATH_DURATION = 1.4;
/** 清版庆祝时长（秒） */
const CLEAR_DURATION = 1.6;
/** 就绪倒计时时长（秒） */
const READY_DURATION = 1.5;
/** 惊惧模式最后闪烁的时长（秒） */
const FLICKER_DURATION = 2;
/** 惊惧/清版闪烁间隔（毫秒）：reduced-motion 用户降低闪烁频率以减轻视觉刺激 */
const FLICKER_MS = FX.prefersReduced ? 320 : 150;
/** 水果出现所需的累计吃豆数（每关两次：首次与再次达到） */
const FRUIT_DOT_GOALS = [70, 170];
/** 水果存活时长（秒） */
const FRUIT_LIFETIME = 9;
/** 水果最后闪烁提醒的时长（秒） */
const FRUIT_BLINK_DURATION = 2;
/** 水果出生格：幽灵屋正下方中央通道（不可放幽灵屋顶墙格） */
const FRUIT_POS = { x: 9, y: 11 };
/** 水果基础分（乘以关卡数，封顶 1000） */
const FRUIT_BASE_SCORE = 100;
/** 水果得分上限 */
const FRUIT_MAX_SCORE = 1000;
/** 1UP 奖励生命所需的本局累计得分 */
const ONE_UP_SCORE = 10000;
/* ===================== 成就系统 v2 常量（DOM 成就墙，与贪吃蛇/1024 同构；实现见文件尾「成就系统 v2」区块） =====================
 * 存档格式 v2：{ unlocked:{id:时间戳ms}, best:{统计名:历史最大值} }，键 arcade_ach_pac 不变；
 * 旧格式（纯数组 id 列表）读取时全量迁移进新 unlocked（时间戳 0），老玩家成就绝不丢失；
 * 旧 pacDotsTotal 独立键读取时并入 best.dotsTotal（取较大值），跨局累计吃豆进度无缝接续。
 * 成就墙为 body 直挂的全屏 DOM 覆盖层（#achWall），打开期间逻辑 tick 冻结、对局输入吞键，
 * 渲染循环照常推进（成就墙 CSS 动画不受逻辑暂停影响）；
 * 解锁演出：右上角 DOM toast 堆叠（稀有度色边，自动消退）+ 史诗/传说追加金色烟花
 * （FX.recordBurst）+ 解锁音（SFX.newRecord）；开合面板播 UI 点击音（SFX.uiClick）。
 */

/** 成就存档 localStorage 键（跨局持久化，与贪吃蛇的 arcade_ach_snake 同族） */
const ACH_KEY_PAC = 'arcade_ach_pac';
/** 进度镜像快照存档键（localStorage）：返回游戏厅/收到 arcade:save 消息/关页时保存当前局，下次进入合法则恢复续玩 */
const SNAPSHOT_KEY = 'arcade_save_pac';
/** 旧版跨局累计吃豆独立键：v2 后累计值改存 achStore.best.dotsTotal，本键仅用于迁移读取 */
const DOTS_TOTAL_KEY = 'pacDotsTotal';
/** 稀有度 → 中文标签（成就卡片徽章与解锁 toast 通用） */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
/** 历史最佳统计默认值：best 里缺省的统计一律按默认起算（新增统计向后兼容旧档） */
const ACH_BEST_DEFAULTS = { score: 0, level: 1, dotsTotal: 0, ghostCombo: 0 };
/** 成就定义表（8 条，四档稀有度 普通3/稀有2/史诗2/传说1，顺序即成就墙展示顺序）：
 *  stat/target 驱动进度条；stat 为 null 的事件型成就（allDots/combo4）无进度条，达标瞬间直接解锁 */
const ACHIEVEMENTS_PAC = [
    { id: 'dots500',    name: '豆豆大胃王', icon: '🍒', rarity: 'common',    desc: '跨局累计吃豆 500 颗',     stat: 'dotsTotal',  target: 500 },
    { id: 'score5000',  name: '街机新秀',   icon: '🎯', rarity: 'common',    desc: '单局得分达到 5000',       stat: 'score',      target: 5000 },
    { id: 'ghost2',     name: '连环反杀',   icon: '👻', rarity: 'common',    desc: '单次能量期吃掉 2 只幽灵', stat: 'ghostCombo', target: 2 },
    { id: 'allDots',    name: '颗粒归仓',   icon: '🧹', rarity: 'rare',      desc: '单关吃光全部豆子',        stat: null,         target: null },
    { id: 'level3',     name: '深入迷宫',   icon: '🗺️', rarity: 'rare',      desc: '单局推进到第 3 关',       stat: 'level',      target: 3 },
    { id: 'score20000', name: '高分传说',   icon: '🏆', rarity: 'epic',      desc: '单局得分达到 20000',      stat: 'score',      target: 20000 },
    { id: 'dots2000',   name: '千豆百炼',   icon: '💠', rarity: 'epic',      desc: '跨局累计吃豆 2000 颗',    stat: 'dotsTotal',  target: 2000 },
    { id: 'combo4',     name: '四连反杀',   icon: '⚡', rarity: 'legendary', desc: '单次能量期吃掉 4 只幽灵', stat: null,         target: null },
];

/* ===================== DOM 引用 ===================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const livesCanvas = document.getElementById('livesCanvas');
const livesCtx = livesCanvas.getContext('2d');
const scoreVal = document.getElementById('scoreVal');
const levelVal = document.getElementById('levelVal');
const highVal = document.getElementById('highVal');
const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScore = document.getElementById('finalScore');
const newRecord = document.getElementById('newRecord');
/** 暂停遮罩中的"已恢复上次进度"提示行（仅快照恢复成功时显示） */
const restoreNote = document.getElementById('restoreNote');

/* ===================== 显示状态 ===================== */

/** 画布逻辑尺寸视图 { ctx, w, h, dpr }：w/h 为 CSS 逻辑像素，绘制一律基于此坐标 */
let view = { ctx: null, w: COLS * CELL, h: ROWS * CELL, dpr: 1 };
/** 迷宫静态层离屏画布（墙体 + 幽灵门，物理分辨率与主画布一致），每帧一次 drawImage */
const mazeCanvas = document.createElement('canvas');
/** 离屏画布绘制上下文 */
const mazeCtx = mazeCanvas.getContext('2d');
/** 离屏层当前闪白相位：-1 未渲染 / 0 常态 / 1 闪白（相位变化才重建，避免每帧重绘墙层） */
let mazeLayerFlash = -1;

/* ===================== 游戏状态 ===================== */

/** 迷宫网格（二维数组，值为地形类型） */
let grid = [];
/** 剩余豆子数量（含能量豆），归零即清版 */
let dotCount = 0;
/** 当前分数 */
let score = 0;
/** 当前关卡（1 起） */
let level = 1;
/** 剩余生命 */
let lives = 3;
/** 本地最高分（localStorage 持久化） */
let highScore = 0;
/** 本局开始时已存在的最高分，用于判定"新纪录"提示 */
let recordBase = 0;

/** 游戏状态机：start | ready | play | dying | clear | over */
let state = 'start';
/** 是否暂停 */
let isPaused = false;

/** 吃豆人实体 */
let pac = null;
/** 幽灵实体数组 */
let ghosts = [];

/** 惊惧模式剩余时间（秒），0 表示未激活 */
let frightTimer = 0;
/** 当前惊惧时长（秒），由难度决定 */
let frightDur = 8;
/** 幽灵基础速度（像素/秒），由难度决定 */
let ghBase = 95;
/** 分数倍率（作用于豆子/能量豆得分），由难度决定；幽灵连击分保持经典固定值 */
let scoreMult = 2;
/** 无敌模式开关（仅"无敌"难度为 true）：非惊惧态幽灵碰到玩家不掉命、不重置位置、无死亡动画，二者互相穿过 */
let invincibleMode = false;
/** 难度选择存档键（localStorage），页面加载时恢复上一次选择 */
const DIFFICULTY_KEY = 'pacDifficulty';
/** 连续吃幽灵的连击数（决定 200/400/800/1600 分） */
let ghostCombo = 0;
/** waka 音交替标志（吃豆音高低交替，模拟经典 waka-waka） */
let wakaAlt = false;
/** 本局累计吃豆数（含能量豆，驱动水果 70/170 触发） */
let pacDotsEaten = 0;
/** 水果已触发次数索引（对应 FRUIT_DOT_GOALS，取值 0/1/2，2 表示本关两次均已出过） */
let fruitSpawned = 0;
/** 当前水果状态：null 不存在 / { timer } 剩余存活秒数 */
let fruit = null;
/** 本局是否已发放过 1UP 奖励生命（每局仅一次） */
let oneUpGiven = false;
/** 本局是否已触发过破纪录庆祝（幂等标志） */
let recordBroken = false;

/** 当前相位索引（对应 PHASES） */
let phaseIndex = 0;
/** 当前相位已持续时间（秒） */
let phaseTimer = 0;

/** ready 状态剩余时间（秒） */
let readyTimer = 0;
/** dying 状态剩余时间（秒） */
let dyingTimer = 0;
/** clear 状态剩余时间（秒） */
let clearTimer = 0;

/** 吃幽灵 / 得分浮动文字数组 { x, y, text, timer } */
const floatTexts = [];

/* ===================== 特效状态 ===================== */

/** 吃豆 / 吃幽灵粒子池 { x, y, vx, vy, life, maxLife, color, size }：预分配零分配复用，满员自动征用最旧粒子 */
const particlePool = new FX.Pool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2 }));
/** 幽灵眼睛回巢拖尾点 { x, y, t }（t 为剩余寿命 1 → 0） */
const eyeTrails = [];
/** 吃豆人移动残影点 { x, y, t }（t 为剩余寿命 1 → 0），强化移动速度感 */
const pacTrails = [];
/** 眼睛拖尾采样计时器（秒，限频 30ms 采样一次） */
let trailPushTimer = 0;
/** 能量豆全屏蓝闪剩余时间（秒），0 表示无 */
let powerFlash = 0;
/** 反杀 / 死亡等高强度时刻的画布震动剩余时间（秒），0 表示无 */
let shakeTime = 0;
/** 死亡瞬间全屏白闪剩余时间（秒），0 表示无 */
let deathFlashTime = 0;
/** 粒子重力（像素/秒²） */
const PARTICLE_GRAVITY = 320;

/**
 * 在指定位置喷出一组粒子
 * @param {number} px 粒子出生点像素 x 坐标
 * @param {number} py 粒子出生点像素 y 坐标
 * @param {string} color 粒子颜色
 * @param {number} count 粒子数量
 * @param {number} [speed=120] 散射初速（像素/秒）
 */
function spawnParticles(px, py, color, count, speed = 120) {
    // reduced-motion 用户跳过粒子特效（飘字/音效等必要反馈不受影响）
    if (FX.prefersReduced) return;
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2; // 均匀环向散射
        const spd = speed * (0.5 + Math.random() * 0.7);
        const p = particlePool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = px;
        p.y = py;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 40; // 轻微上抛
        p.life = 0.3 + Math.random() * 0.3;  // 0.3 ~ 0.6 秒寿命
        p.maxLife = p.life;
        p.color = color;
        p.size = 2 + Math.random() * 2.5;
    }
}

/* ===================== 工具函数 ===================== */

/**
 * 获取指定格子的像素中心坐标 x
 * @param {number} c 列号
 * @returns {number} 格心像素 x
 */
function centerX(c) { return (c + 0.5) * CELL; }

/**
 * 获取指定格子的像素中心坐标 y
 * @param {number} r 行号
 * @returns {number} 格心像素 y
 */
function centerY(r) { return (r + 0.5) * CELL; }

/**
 * 判断吃豆人能否进入某格（不可穿墙与幽灵门）；
 * 列号取模环绕支持左右穿墙隧道（越界列折回对侧）
 * @param {number} c 列号
 * @param {number} r 行号
 * @returns {boolean} 是否可通行
 */
function canPass(c, r) {
    if (r < 0 || r >= ROWS) return false;
    const wc = ((c % COLS) + COLS) % COLS; // 列号取模：-1 → 18、19 → 0，隧道环绕
    const t = grid[r][wc];
    return t !== T_WALL && t !== T_DOOR;
}

/**
 * 判断幽灵能否进入某格（门仅 exit/eyes 模式可通行）；
 * 列号取模环绕与吃豆人共用同一隧道规则
 * @param {object} g 幽灵实体
 * @param {number} c 列号
 * @param {number} r 行号
 * @returns {boolean} 是否可通行
 */
function ghostCanPass(g, c, r) {
    if (r < 0 || r >= ROWS) return false;
    const wc = ((c % COLS) + COLS) % COLS; // 列号取模：隧道环绕
    const t = grid[r][wc];
    if (t === T_WALL) return false;
    if (t === T_DOOR) return g.mode === 'exit' || g.mode === 'eyes';
    return true;
}

/**
 * 解析迷宫字符串，生成网格并统计豆子总数
 */
function buildGrid() {
    grid = [];
    dotCount = 0;
    for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
            const ch = MAZE[r][c];
            let t = T_EMPTY;
            if (ch === '#') t = T_WALL;
            else if (ch === '.') t = T_DOT;
            else if (ch === 'o') t = T_POWER;
            else if (ch === '=') t = T_DOOR;
            // G 与 P 均为空地（出生点），不计豆
            if (t === T_DOT || t === T_POWER) dotCount++;
            row.push(t);
        }
        grid.push(row);
    }
}

/**
 * 重置吃豆人与四只幽灵到出生位置（死亡/清版/开局共用）
 */
function resetPositions() {
    // 吃豆人回到 P 点，默认朝左
    pac = {
        x: centerX(9), y: centerY(15),
        cell: { x: 9, y: 15 },
        dir: 'left', dirQueue: [], // dirQueue：转向预输入队列（深度 2），替代单槽 nextDir 防止快速连按丢键
        stopped: false
    };
    // 四只幽灵回到各自出生格
    ghosts = GHOST_DEFS.map(def => ({
        name: def.name,
        color: def.color,
        scatter: def.scatter,
        releaseDelay: def.releaseDelay,
        x: centerX(def.spawn.x), y: centerY(def.spawn.y),
        cell: { x: def.spawn.x, y: def.spawn.y },
        dir: 'up',
        mode: 'house',          // house -> exit -> roam(或 eyes) -> ...
        frightened: false,
        releaseTimer: 0
    }));
    phaseIndex = 0;
    phaseTimer = 0;
    SFX.bgm.setIntensity(false); // 重开/新关相位归散开：脱离追击危险分层（start 换曲已重置，此处兜底同一页面内重置）
    frightTimer = 0;
    ghostCombo = 0;
    // 水果状态复位：清除场上水果，吃豆计数与触发进度归零（每关重新累计）
    fruit = null;
    pacDotsEaten = 0;
    fruitSpawned = 0;
    floatTexts.length = 0;
    particlePool.clear();   // 归还全部吃豆粒子（池对象保留复用）
    eyeTrails.length = 0;   // 清空眼睛拖尾
    pacTrails.length = 0;   // 清空吃豆人残影
    powerFlash = 0;         // 复位蓝闪
}

/* ===================== 实体移动核心 ===================== */

/**
 * 像素级移动：沿当前方向前进 dist 像素，每次穿越格心触发一次回调。
 * 实体坐标可能落在两格之间，cell 始终表示最近经过（或当前所在）格心的格。
 * @param {object} e 实体（pac 或幽灵），需含 x/y/cell/dir/stopped 字段
 * @param {number} dist 本帧移动距离（像素）
 * @param {Function} onCenter 穿越格心时的回调（用于转向/吃豆/停止判定）
 */
function stepEntity(e, dist, onCenter) {
    let guard = 0; // 防御：单帧穿越格心次数有限，避免死循环
    while (dist > 0.0001 && guard++ < 8) {
        const d = DIRS[e.dir];
        const ccx = centerX(e.cell.x);
        const ccy = centerY(e.cell.y);
        // 计算沿当前方向到下一个格心的距离（已过格心则为下一格距离）
        let ahead;
        if (d.x !== 0) {
            const dx = (ccx - e.x) * d.x;
            ahead = dx > 0.0001 ? dx : dx + CELL;
        } else {
            const dy = (ccy - e.y) * d.y;
            ahead = dy > 0.0001 ? dy : dy + CELL;
        }
        const step = Math.min(dist, ahead);
        e.x += d.x * step;
        e.y += d.y * step;
        dist -= step;
        if (step >= ahead - 0.001) {
            // 抵达格心：更新所在格并回调（转向 / 吃豆 / 停止判定）
            e.cell.x = Math.round(e.x / CELL - 0.5);
            e.cell.y = Math.round(e.y / CELL - 0.5);
            // 隧道环绕：cell 越出左右边界时折回对侧，并同步像素坐标
            // （瞬移发生在实体完全走出画布之后，视觉不可察觉）
            if (e.cell.x < 0) {
                e.cell.x = COLS - 1;
                e.x += COLS * CELL;
            } else if (e.cell.x >= COLS) {
                e.cell.x = 0;
                e.x -= COLS * CELL;
            }
            onCenter(e);
            if (e.stopped) break; // 吃豆人撞墙停下
        } else {
            break; // 剩余距离不足以到达下一个格心
        }
    }
}

/**
 * 吃豆人穿越格心：吃豆、触发惊惧、按玩家输入转向、必要时停住
 */
function pacOnCenter() {
    // 吃掉当前格的豆子
    const t = grid[pac.cell.y][pac.cell.x];
    if (t === T_DOT) {
        grid[pac.cell.y][pac.cell.x] = T_EMPTY;
        dotCount--;
        addScore(10 * scoreMult);
        // 累计吃豆：本局计数驱动水果触发，跨局累计值入成就存档并判定 dots500 / dots2000 进度
        pacDotsEaten++;
        trackCumulativeStat('dotsTotal', 1);
        checkFruitSpawn();
        spawnParticles(centerX(pac.cell.x), centerY(pac.cell.y), '#ffd7a8', 3, 70); // 微型金粒迸溅
        // 立体声定位：按吃豆点在迷宫中的水平位置分配左右声道（左半左响右半右响）
        SFX.pan(((centerX(pac.cell.x) / (COLS * CELL)) - 0.5) * 1);
        SFX.pacWaka(wakaAlt);
        wakaAlt = !wakaAlt;
    } else if (t === T_POWER) {
        grid[pac.cell.y][pac.cell.x] = T_EMPTY;
        dotCount--;
        addScore(50 * scoreMult);
        powerFlash = 0.3; // 全屏蓝闪，强化" Power "瞬间
        spawnParticles(centerX(pac.cell.x), centerY(pac.cell.y), '#ffe9b0', 12);
        SFX.pacPower();
        triggerFright();
    }
    if (dotCount <= 0) {
        startClear();
        return;
    }
    // 按序消费预输入队列（快速连按不丢键）；无可用转向时维持原方向，再走不通则停住
    if (!applyQueuedTurn() && !canPass(pac.cell.x + DIRS[pac.dir].x, pac.cell.y + DIRS[pac.dir].y)) {
        pac.stopped = true;
    }
}

/* ===================== 转向预输入队列 ===================== */

/**
 * 键盘方向预输入入队：与队尾同向去重；队列已满时移除最旧方向（最新意图优先）。
 * 深度为 2 的队列让"快速连按两下换向"不丢第一下，消除单槽预输入被覆盖导致的转向丢失
 * @param {string} dir 方向（up/down/left/right）
 */
function queueDirection(dir) {
    if (pac.dirQueue[pac.dirQueue.length - 1] === dir) return; // 与队尾同向，无需重复入队
    if (pac.dirQueue.length >= DIR_QUEUE_MAX) pac.dirQueue.shift(); // 队列满则淘汰最旧方向
    pac.dirQueue.push(dir);
}

/**
 * 在格心处按序消费预输入：取队列中第一个可通行方向作为新行进方向，
 * 并连同其之前的陈旧条目一并出队（防止失效按键滞留，导致在远处路口突兀转向）
 * @returns {boolean} 是否成功应用了转向
 */
function applyQueuedTurn() {
    for (let i = 0; i < pac.dirQueue.length; i++) {
        const dir = pac.dirQueue[i];
        if (canPass(pac.cell.x + DIRS[dir].x, pac.cell.y + DIRS[dir].y)) {
            pac.dir = dir;                 // 应用玩家意图
            pac.dirQueue.splice(0, i + 1); // 已应用项与其之前的过期项全部出队
            return true;
        }
    }
    return false;
}

/**
 * 幽灵穿越格心：检查是否到达出口/巢穴以切换模式，然后按 AI 选路
 * @param {object} g 幽灵实体
 */
function ghostOnCenter(g) {
    // 到达门口外格：从 exit 转入 roam（开始参与相位循环）
    if (g.mode === 'exit' && g.cell.x === EXIT.x && g.cell.y === EXIT.y) {
        g.mode = 'roam';
    }
    // 眼睛回到巢穴中心：复活为 exit 模式重新出屋
    else if (g.mode === 'eyes' && g.cell.x === HOME.x && g.cell.y === HOME.y) {
        g.mode = 'exit';
        g.frightened = false;
        SFX.beeDashReady(); // 眼睛归巢复活：复用小蜜蜂冲刺就绪清脆双高音（幽灵即将重新出屋）
    }
    ghostChooseDir(g);
}

/**
 * 计算幽灵当前的目标格（决定选路方向）
 * @param {object} g 幽灵实体
 * @returns {object} 目标格 { x, y }
 */
function ghostTarget(g) {
    // 出屋 / 回巢阶段直接奔向固定点
    if (g.mode === 'exit') return EXIT;
    if (g.mode === 'eyes') return HOME;
    const scatter = PHASES[phaseIndex][0] === 'scatter';
    // 追击阶段按各自性格计算目标
    if (!scatter) {
        if (g.name === 'blinky') return pac.cell; // 直接追当前格
        if (g.name === 'pinky') {                 // 预判前方 4 格
            return { x: pac.cell.x + DIRS[pac.dir].x * 4, y: pac.cell.y + DIRS[pac.dir].y * 4 };
        }
        if (g.name === 'inky') {                  // 包抄：抄到吃豆人身后 2 格
            return { x: pac.cell.x - DIRS[pac.dir].x * 2, y: pac.cell.y - DIRS[pac.dir].y * 2 };
        }
        // clyde：距离远时追击，靠近后害羞地折回散开角
        const dist = Math.hypot(g.cell.x - pac.cell.x, g.cell.y - pac.cell.y);
        return dist > 8 ? pac.cell : g.scatter;
    }
    return g.scatter; // 散开阶段各回各角
}

/**
 * 幽灵在格心选择下一步方向：
 * 排除反向；惊惧时随机；否则选距目标最近的选项（经典平局序）；死路才允许掉头
 * @param {object} g 幽灵实体
 */
function ghostChooseDir(g) {
    const opts = [];
    for (const d of DIR_ORDER) {
        if (d === OPPOSITE[g.dir]) continue; // 经典规则：不许原地掉头
        const nx = g.cell.x + DIRS[d].x;
        const ny = g.cell.y + DIRS[d].y;
        if (ghostCanPass(g, nx, ny)) opts.push(d);
    }
    let choice;
    if (opts.length === 0) {
        choice = OPPOSITE[g.dir]; // 死路（例如惊惧掉头后的特殊情况）允许反向
    } else if (g.frightened && g.mode === 'roam') {
        choice = opts[(Math.random() * opts.length) | 0]; // 惊惧时慌不择路
    } else {
        const target = ghostTarget(g);
        let best = Infinity;
        for (const d of opts) {
            const nx = g.cell.x + DIRS[d].x;
            const ny = g.cell.y + DIRS[d].y;
            const dd = (nx - target.x) * (nx - target.x) + (ny - target.y) * (ny - target.y);
            if (dd < best) { best = dd; choice = d; }
        }
    }
    g.dir = choice;
}

/**
 * 计算幽灵当前实际移动速度（像素/秒）；
 * 基准速度随关卡以 ×1.05 累乘提升，上限为吃豆人当前速度的 0.95 倍
 * （保证高关卡下吃豆人直线仍可甩开幽灵，维持可玩性）
 * @param {object} g 幽灵实体
 * @returns {number} 移动速度
 */
function ghostSpeed(g) {
    // 关卡提速基准：×1.05^(level-1) 累乘，封顶吃豆人当前速度的 0.95 倍
    const pacSpeed = Math.min(PAC_BASE_SPEED + (level - 1) * 5, PAC_MAX_SPEED);
    const base = Math.min(ghBase * Math.pow(1.05, level - 1), pacSpeed * 0.95);
    if (g.mode === 'eyes') return ghBase * 2.4; // 眼睛飞速回巢
    if (g.mode === 'exit') return ghBase * 0.7; // 出屋缓慢
    if (g.frightened) return base * 0.55;       // 惊惧减速
    return base;
}

/* ===================== 流程控制 ===================== */

/**
 * 触发惊惧模式：除回巢眼睛外全部幽灵进入惊惧状态（roam 幽灵掉头），重置连击。
 * 出屋(exit)/屋内(house)幽灵同样进入惊惧属有意取舍：降低无敌/演示档下被屋口幽灵偷袭的压迫感，演示难度友好，非逻辑错误。
 */
function triggerFright() {
    frightTimer = frightDur;
    ghostCombo = 0;
    for (const g of ghosts) {
        if (g.mode === 'eyes') continue; // 眼睛不受影响
        g.frightened = true;
        if (g.mode === 'roam') g.dir = OPPOSITE[g.dir]; // 经典掉头反应
    }
}

/**
 * 进入清版庆祝状态（墙体闪白）
 */
function startClear() {
    state = 'clear';
    clearTimer = CLEAR_DURATION;
    frightTimer = 0;
    for (const g of ghosts) g.frightened = false;
    SFX.pacLevelUp();
    SFX.bgm.stop(); // 胜利（通关）时停止 BGM，下一关 ready 阶段重新起播
    unlockAchievement('allDots'); // 单关吃光全部豆子成就
}

/**
 * 进入死亡动画状态
 */
function startDying() {
    state = 'dying';
    dyingTimer = DEATH_DURATION;
    frightTimer = 0;
    for (const g of ghosts) g.frightened = false;
    deathFlashTime = 0.12; // 死亡瞬间全屏白闪
    // reduced-motion 用户跳过整屏震动（保留白闪作为死亡必要反馈）
    if (!FX.prefersReduced) shakeTime = 0.25;
    SFX.pacDeath();
    SFX.bgm.stop(); // 死亡时停止 BGM，重生 ready 阶段重新起播
}

/**
 * 游戏结束：展示最终分数与新纪录提示
 */
function gameOver() {
    state = 'over';
    finalScore.textContent = score;
    if (score > recordBase) {
        try {
            localStorage.setItem('pacHighScore', String(score));
        } catch (e) { /* 存储不可用（隐私模式/禁用站点数据）：静默跳过持久化 */ }
        newRecord.style.display = 'block';
    } else {
        newRecord.style.display = 'none';
    }
    gameOverScreen.style.display = 'block';
    SFX.gameOver();
    SFX.bgm.stop(); // 游戏结束时停止 BGM
    try {
        localStorage.removeItem(SNAPSHOT_KEY); // 游戏结束即清除进度快照：下次进入按原逻辑新开局
    } catch (e) { /* 存储不可用：静默跳过，确保结算面板与音效不受存储异常中断 */ }
}

/* ===================== 进度镜像快照 ===================== */

/**
 * 保存当前局进度镜像快照到 localStorage（键 arcade_save_pac）。
 * 触发点：父页 arcade:save 消息 / 左上角返回链接 click / window pagehide。
 * 仅"进行中(play)或就绪(ready，含恢复后暂停中)"可镜像；未开始(start)、
 * 死亡(dying)/清版(clear)过场、已结束(over)等状态一律清除残留快照，保证下次进入不会恢复到非法局面。
 * 组装纯数据快照（数值/字符串/布尔/数组，不含函数与 DOM 引用），整体 try/catch 异常静默。
 */
function saveSnapshot() {
    try {
        // 状态门槛：进行中/暂停中才保存，其余界面（开始/死亡/清版/结算）删除旧快照
        if (state !== 'play' && state !== 'ready') {
            localStorage.removeItem(SNAPSHOT_KEY);
            return;
        }
        // 豆子集合压位串：每格一字符（'0' 空地或已吃 / '1' 普通豆 / '2' 能量豆），
        // 长度恒为 ROWS×COLS，恢复时与原迷宫逐格互验（豆只能落在原豆位上）
        let dots = '';
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const t = grid[r][c];
                dots += t === T_DOT ? '1' : t === T_POWER ? '2' : '0';
            }
        }
        // 纯数据快照：首字段固定版本号 v=1（恢复时 !==1 即弃用）
        const snap = {
            v: 1,                          // 快照协议版本
            score, level, lives,           // 分数 / 关卡 / 剩余生命
            dotCount,                      // 剩余豆子数（含能量豆，与压位串统计互验）
            dots,                          // 豆子集合压位串
            recordBase,                    // 本局开局时最高分（破纪录判定基准）
            oneUpGiven, recordBroken,      // 本局一次性标志（防恢复后重复奖励 1UP / 重复破纪录庆祝）
            frightTimer,                   // 惊惧模式剩余时间（秒）
            frightDur,                     // 当前难度惊惧总时长
            ghBase,                        // 当前难度幽灵基础速度
            scoreMult,                     // 当前难度分数倍率
            invincibleMode,                // 无敌难度开关
            ghostCombo,                    // 惊惧连锁计数（200/400/800/1600 分档）
            phaseIndex,                    // scatter/chase 相位索引
            phaseTimer,                    // 当前相位已持续时间（秒）
            pacDotsEaten,                  // 本关累计吃豆数（驱动水果 70/170 触发）
            fruitSpawned,                  // 水果已触发次数（0/1/2）
            fruit: fruit ? { timer: fruit.timer } : null, // 场上水果剩余存活时间
            pac: {                         // 吃豆人：像素坐标 / 所在格 / 方向 / 预输入队列 / 停止标志
                x: pac.x, y: pac.y,
                cx: pac.cell.x, cy: pac.cell.y,
                dir: pac.dir,
                queue: pac.dirQueue.slice(),
                stopped: pac.stopped
            },
            ghosts: ghosts.map(g => ({     // 四幽灵：像素坐标 / 所在格 / 方向 / 模式 / 惊惧 / 出屋计时
                name: g.name,
                x: g.x, y: g.y,
                cx: g.cell.x, cy: g.cell.y,
                dir: g.dir,
                mode: g.mode,              // house | exit | roam | eyes
                frightened: g.frightened,
                releaseTimer: g.releaseTimer
            }))
        };
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch (e) { /* 存储不可用或序列化失败时静默放弃，绝不妨碍游戏运行 */ }
}

/**
 * 从 localStorage 恢复进度镜像快照（初始化时调用一次）。
 * 读取 → JSON.parse → 校验 v===1 且逐字段类型/范围合法（坐标在迷宫范围内、
 * 生命/分数非负有限、幽灵数量与枚举合法、豆子压位串与迷宫规格逐格互验）；
 * 任何异常或非法数据 → 清除快照并返回 false（回退原新开局逻辑），绝不因脏数据抛错。
 * 校验全部通过 → 覆盖游戏状态并停在暂停遮罩等待玩家按 P 继续（防恢复即死），返回 true。
 * @returns {boolean} 是否成功恢复（true：已续玩就绪；false：无快照或快照非法已清除）
 */
function restoreSnapshot() {
    try {
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        if (raw === null) return false; // 无快照：按原逻辑新开局
        const s = JSON.parse(raw);
        // 首字段版本校验：v !== 1 即弃用
        if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) {
            throw new Error('snapshot version mismatch');
        }
        /* ---- 局部校验辅助：任一不合法立即抛错，由 catch 统一清除快照并返回 false ---- */
        /** 断言辅助：条件不成立即抛错中断恢复流程 @param {boolean} cond 断言条件 */
        const need = cond => { if (!cond) throw new Error('invalid snapshot field'); };
        /** 有限数值校验（排除 NaN/Infinity/字符串），并限定闭区间范围 @returns {number} 原值 */
        const num = (v, min, max) => { need(Number.isFinite(v) && v >= min && v <= max); return v; };
        /** 布尔类型校验 @returns {boolean} 原值 */
        const bool = v => { need(typeof v === 'boolean'); return v; };
        /** 方向枚举校验（必须为 up/down/left/right 之一） */
        const dirOk = d => { need(typeof d === 'string' && Object.prototype.hasOwnProperty.call(DIRS, d)); };

        /* ---- 标量字段校验 ---- */
        num(s.score, 0, Number.MAX_SAFE_INTEGER);   // 分数非负且有限
        num(s.level, 1, Number.MAX_SAFE_INTEGER);   // 关卡 ≥ 1
        num(s.lives, 0, 99);                        // 生命非负且有限
        num(s.dotCount, 1, Number.MAX_SAFE_INTEGER); // 剩余豆数 > 0（0 为清版瞬间，快照失效）
        need(typeof s.dots === 'string' && s.dots.length === ROWS * COLS); // 压位串与迷宫规格匹配
        num(s.recordBase, 0, Number.MAX_SAFE_INTEGER);
        bool(s.oneUpGiven);
        bool(s.recordBroken);
        num(s.frightTimer, 0, 600);
        num(s.frightDur, 0.5, 600);
        num(s.ghBase, 1, 1000);
        num(s.scoreMult, 1, 100);
        bool(s.invincibleMode);
        need(Number.isInteger(s.ghostCombo) && s.ghostCombo >= 0 && s.ghostCombo <= 3);
        need(Number.isInteger(s.phaseIndex) && s.phaseIndex >= 0 && s.phaseIndex < PHASES.length);
        num(s.phaseTimer, 0, 100000);
        num(s.pacDotsEaten, 0, Number.MAX_SAFE_INTEGER);
        need(Number.isInteger(s.fruitSpawned) && s.fruitSpawned >= 0 && s.fruitSpawned <= FRUIT_DOT_GOALS.length);
        if (s.fruit !== null) { // 水果：null 或 { timer ∈ (0, FRUIT_LIFETIME] }
            need(typeof s.fruit === 'object' && s.fruit !== null && !Array.isArray(s.fruit));
            num(s.fruit.timer, 0.001, FRUIT_LIFETIME);
        }

        /* ---- 实体校验：像素坐标在迷宫范围（左右隧道侧留 2 格瞬移余量）、格号严格界内、枚举合法 ---- */
        const rangeX = COLS * CELL + CELL * 2;
        /** 单实体公共校验：像素坐标 / 所在格 / 方向 @param {object} e 实体快照 */
        const checkEntity = e => {
            num(e.x, -rangeX, rangeX);
            num(e.y, 0, ROWS * CELL);
            need(Number.isInteger(e.cx) && e.cx >= 0 && e.cx < COLS); // 所在格严格在迷宫内
            need(Number.isInteger(e.cy) && e.cy >= 0 && e.cy < ROWS);
            dirOk(e.dir);
        };
        need(s.pac && typeof s.pac === 'object' && !Array.isArray(s.pac));
        checkEntity(s.pac);
        bool(s.pac.stopped);
        need(Array.isArray(s.pac.queue) && s.pac.queue.length <= DIR_QUEUE_MAX);
        s.pac.queue.forEach(dirOk); // 预输入队列每项均须为合法方向
        need(Array.isArray(s.ghosts) && s.ghosts.length === GHOST_DEFS.length); // 幽灵数量固定 4
        const MODES = ['house', 'exit', 'roam', 'eyes'];
        s.ghosts.forEach((g, i) => {
            need(g && typeof g === 'object' && !Array.isArray(g));
            need(g.name === GHOST_DEFS[i].name); // 序号与幽灵定义表一一对应
            checkEntity(g);
            need(MODES.includes(g.mode)); // 模式枚举合法
            bool(g.frightened);
            num(g.releaseTimer, 0, 100000);
        });

        /* ---- 豆子集合与迷宫逐格互验：快照豆位必须落在原迷宫豆位上（墙/门格不允许出现豆） ---- */
        buildGrid(); // 以原迷宫重建基准网格（与初始化等价，快照失败时无残留影响）
        let dotsLeft = 0;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const ch = s.dots[r * COLS + c];
                const orig = grid[r][c];
                if (ch === '1') {
                    need(orig === T_DOT);  // 声称存在普通豆的格子，原迷宫必须是普通豆位
                    dotsLeft++;
                } else if (ch === '2') {
                    need(orig === T_POWER); // 能量豆同理
                    dotsLeft++;
                } else {
                    need(ch === '0'); // 其余字符一律非法
                    if (orig === T_DOT || orig === T_POWER) grid[r][c] = T_EMPTY; // 已吃掉的豆格清空
                }
            }
        }
        need(dotsLeft === s.dotCount); // 压位串统计与 dotCount 双保险互验

        /* ---- 全部校验通过：覆盖游戏状态 ---- */
        dotCount = dotsLeft;
        score = s.score;
        level = s.level;
        lives = s.lives;
        recordBase = s.recordBase;
        oneUpGiven = s.oneUpGiven;
        recordBroken = s.recordBroken;
        frightTimer = s.frightTimer;
        frightDur = s.frightDur;
        ghBase = s.ghBase;
        scoreMult = s.scoreMult;
        invincibleMode = s.invincibleMode;
        ghostCombo = s.ghostCombo;
        phaseIndex = s.phaseIndex;
        phaseTimer = s.phaseTimer;
        SFX.bgm.setIntensity(PHASES[phaseIndex][0] === 'chase'); // 续玩追击相位直接进入危险分层，与恢复局面匹配
        pacDotsEaten = s.pacDotsEaten;
        fruitSpawned = s.fruitSpawned;
        fruit = s.fruit ? { timer: s.fruit.timer } : null;
        pac = {
            x: s.pac.x, y: s.pac.y,
            cell: { x: s.pac.cx, y: s.pac.cy },
            dir: s.pac.dir,
            dirQueue: s.pac.queue.slice(),
            stopped: s.pac.stopped
        };
        // 幽灵按定义表重建：name/color/scatter/releaseDelay 取常量，动态量取快照
        ghosts = GHOST_DEFS.map((def, i) => ({
            name: def.name,
            color: def.color,
            scatter: def.scatter,
            releaseDelay: def.releaseDelay,
            x: s.ghosts[i].x, y: s.ghosts[i].y,
            cell: { x: s.ghosts[i].cx, y: s.ghosts[i].cy },
            dir: s.ghosts[i].dir,
            mode: s.ghosts[i].mode,
            frightened: s.ghosts[i].frightened,
            releaseTimer: s.ghosts[i].releaseTimer
        }));
        highScore = Math.max(highScore, score); // HUD 最高分与当前分取大（与 addScore 口径一致）
        // 演出类不可安全镜像量复位：粒子/拖尾/飘字/闪烁全部归零（不影响玩法数据）
        floatTexts.length = 0;
        particlePool.clear();
        eyeTrails.length = 0;
        pacTrails.length = 0;
        powerFlash = 0;
        shakeTime = 0;
        deathFlashTime = 0;
        trailPushTimer = 0;
        wakaAlt = false;
        // 停在暂停遮罩等待玩家按 P 继续（防恢复即死）：进入 ready 但冻结倒计时
        state = 'ready';
        readyTimer = READY_DURATION;
        isPaused = true;
        startScreen.style.display = 'none';
        gameOverScreen.style.display = 'none';
        pauseScreen.style.display = 'block';
        if (restoreNote) restoreNote.style.display = 'block'; // 遮罩追加"已恢复上次进度"提示
        // 刷新 HUD 与画布一帧（此后主循环暂停中仅渲染，逻辑冻结直到玩家按 P）
        updateHUD();
        drawLives();
        draw(performance.now());
        return true;
    } catch (e) {
        // 任何异常（解析失败/字段非法/存储异常）均视为脏数据：清除快照并回退新开局
        try { localStorage.removeItem(SNAPSHOT_KEY); } catch (e2) { /* 存储整体不可用时忽略 */ }
        return false;
    }
}

/**
 * 开始新游戏（开始界面 / 结束界面按钮调用）
 */
function startGame() {
    score = 0;
    level = 1;
    lives = 3;
    try {
        highScore = parseInt(localStorage.getItem('pacHighScore') || '0', 10); // 存储不可用时静默保持默认 0
    } catch (e) { /* 存储不可用（隐私模式/禁用站点数据）：不中断开局流程 */ }
    recordBase = highScore;
    // 本局一次性标志复位：1UP 奖励与破纪录庆祝每局仅触发一次
    oneUpGiven = false;
    recordBroken = false;
    // 重置成就演出状态：成就墙收起（toast 为自动消退的 DOM 节点无需清理；解锁记录持久化不受影响）
    achPanelOpen = false;
    achWall.hidden = true;
    buildGrid();
    resetPositions();
    state = 'ready';
    readyTimer = READY_DURATION;
    isPaused = false;
    startScreen.style.display = 'none';
    pauseScreen.style.display = 'none';
    if (restoreNote) restoreNote.style.display = 'none'; // 新开局复位"已恢复"提示，防止后续正常暂停误显示
    gameOverScreen.style.display = 'none';
    SFX.pacReady();
    SFX.bgm.start('pac'); // 开局起播吃豆人 BGM（同名重复调用幂等，死亡/清版后 ready 复播走同一入口）
}

/**
 * 切换暂停状态并同步遮罩显示；BGM 跟随暂停/恢复
 */
function togglePause() {
    isPaused = !isPaused;
    pauseScreen.style.display = isPaused ? 'block' : 'none';
    // BGM 三态收敛：暂停时挂起、恢复时继续（bgm 内部幂等，重复调用安全）
    if (isPaused) {
        SFX.bgm.pause();
        SFX.uiPause(); // 暂停：下行收束音，与暂停蒙层同步反馈
    } else {
        SFX.bgm.resume();
        SFX.uiResume(); // 继续：上行启动音，恢复对局节奏
        if (restoreNote) restoreNote.style.display = 'none'; // 恢复局继续后"已恢复上次进度"提示完成使命
    }
}

/**
 * 选择难度：读取按钮上的惊惧时长、幽灵速度、分数倍率与无敌标记并持久化选择
 * @param {HTMLButtonElement} btn 被点击的难度按钮
 */
function selectDifficulty(btn) {
    btn.blur(); // 移除焦点，防止空格误触按钮
    document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    frightDur = parseFloat(btn.dataset.fright);
    ghBase = parseFloat(btn.dataset.ghspeed);
    scoreMult = parseInt(btn.dataset.mult, 10);
    // 无敌难度按钮携带 data-invincible="1"，据此切换无敌开关（其余难度无该属性，恢复为 false）
    invincibleMode = btn.dataset.invincible === '1';
    // 持久化所选难度（按钮组中的序号），供下次加载时恢复；存储不可用时静默跳过，保证后续 uiClick 音效正常
    try {
        localStorage.setItem(DIFFICULTY_KEY, String([...document.querySelectorAll('.difficulty-btn')].indexOf(btn)));
    } catch (e) { /* 存储不可用（隐私模式/禁用站点数据）：静默忽略 */ }
    SFX.uiClick();
}

/**
 * 累加分数并同步内存中的最高分（HUD 显示由每帧渲染统一刷新）；
 * 同时检查两件事：本局累计 10000 分的 1UP 生命奖励（每局一次）、
 * 实时打破历史最高分的破纪录庆祝（每局一次）
 * @param {number} n 增加的分数
 */
function addScore(n) {
    score += n;
    if (score > highScore) highScore = score;
    trackRunStat('score', score); // 成就埋点：单局得分上报（驱动 score5000 / score20000 进度判定）
    // 1UP：单局累计达 10000 分且尚未发放时奖励一条命（仅一次/局）
    if (!oneUpGiven && score >= ONE_UP_SCORE) {
        oneUpGiven = true;
        lives++;
        floatTexts.push({ x: centerX(pac.cell.x), y: centerY(pac.cell.y) - CELL, text: '1UP', timer: 1.6 });
        SFX.beeOneUp(); // 经典四音上行奖励旋律
    }
    // 破纪录：实时超越本局开局时的历史最高分（recordBase > 0 避免首局无历史时误触发）
    if (!recordBroken && recordBase > 0 && score > recordBase) {
        recordBroken = true;
        SFX.newRecord();
        FX.recordBurst(); // 金色烟花庆祝（自带 prefersReduced 降级）
    }
}

/* ===================== 帧更新 ===================== */

/**
 * 每帧逻辑更新（暂停时不调用）
 * @param {number} dt 距上帧的秒数
 */
function update(dt) {
    // 反杀顿帧：画面短暂凝滞（冻结一切逻辑推进）强化打击感
    // （统一走 FX.hitstop 体系，reduced-motion 用户自动跳过顿帧）
    if (FX.frozen()) return;

    // 浮动文字全状态通用：上浮并淡出
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        floatTexts[i].timer -= dt;
        if (floatTexts[i].timer <= 0) floatTexts.splice(i, 1);
    }

    // 水果计时：存活倒计时（play 状态之外由 resetPositions 清除，此处通用推进）
    if (fruit) {
        fruit.timer -= dt;
        if (fruit.timer <= 0) fruit = null; // 超时消失
    }

    // ---- 特效推进（全状态通用：粒子余韵在死亡/清版期间继续播完） ----
    powerFlash = Math.max(0, powerFlash - dt);
    // 画布震动与死亡白闪衰减
    shakeTime = Math.max(0, shakeTime - dt);
    deathFlashTime = Math.max(0, deathFlashTime - dt);
    // 粒子物理：重力 + 位移 + 寿命（池活跃区正向遍历，sweep 回收死粒零分配）
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        p.life -= dt;
        p.vy += PARTICLE_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    particlePool.sweep();
    // 眼睛拖尾点衰减
    for (let i = eyeTrails.length - 1; i >= 0; i--) {
        eyeTrails[i].t -= dt * 2.5;
        if (eyeTrails[i].t <= 0) eyeTrails.splice(i, 1);
    }
    // 吃豆人残影点衰减（与眼睛拖尾同速率）
    for (let i = pacTrails.length - 1; i >= 0; i--) {
        pacTrails[i].t -= dt * 2.5;
        if (pacTrails[i].t <= 0) pacTrails.splice(i, 1);
    }

    // ---- 就绪倒计时：结束后正式开局 ----
    if (state === 'ready') {
        readyTimer -= dt;
        if (readyTimer <= 0) state = 'play';
        return;
    }
    // ---- 死亡动画结束：扣命，仍有剩余则重置布阵重来，否则游戏结束 ----
    if (state === 'dying') {
        dyingTimer -= dt;
        if (dyingTimer <= 0) {
            lives--;
            if (lives > 0) {
                resetPositions();
                state = 'ready';
                readyTimer = READY_DURATION;
                SFX.bgm.start('pac'); // 重生 ready 复播 BGM
            } else {
                gameOver();
            }
        }
        return;
    }
    // ---- 清版庆祝结束：关卡 +1，重建迷宫（豆子复原）并重置位置进入下一关 ----
    if (state === 'clear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level++;
            trackRunStat('level', level); // 成就埋点：关卡推进上报（驱动 level3 进度判定）
            buildGrid();
            resetPositions();
            state = 'ready';
            readyTimer = READY_DURATION;
            SFX.bgm.start('pac'); // 下一关 ready 复播 BGM
        }
        return;
    }
    if (state !== 'play') return;

    // ---- 幽灵相位循环计时 ----
    phaseTimer += dt;
    if (phaseTimer >= PHASES[phaseIndex][1]) {
        phaseTimer = 0;
        phaseIndex = (phaseIndex + 1) % PHASES.length;
        // 自适应 BGM 分层：追击（chase）相位叠加危险鼓点层，散开（scatter）相位逐拍衰减脱离
        SFX.bgm.setIntensity(PHASES[phaseIndex][0] === 'chase');
    }

    // ---- 惊惧倒计时 ----
    if (frightTimer > 0) {
        frightTimer -= dt;
        // 能量临终警报：剩余时间跨入闪烁预警阈值的瞬间播低沉双哔（幽灵即将苏醒，仅穿越时触发一次）
        if (frightTimer <= FLICKER_DURATION && frightTimer + dt > FLICKER_DURATION) SFX.alarm(2);
        if (frightTimer <= 0) {
            frightTimer = 0;
            for (const g of ghosts) g.frightened = false;
        }
    }

    // ---- 吃豆人移动 ----
    const pacSpeed = Math.min(PAC_BASE_SPEED + (level - 1) * 5, PAC_MAX_SPEED);
    // 行进中允许随时掉头（经典手感）：队首为反方向时立即应用并出队
    if (!pac.stopped && pac.dirQueue[0] === OPPOSITE[pac.dir]) {
        pac.dir = pac.dirQueue.shift();
    }
    // 近格心预转向吸附：距"下一格心"不足 TURN_SNAP_DIST 时提前吸附过去，
    // 走与正常穿越完全相同的处理（吃豆 + 按队列转向），
    // 转向时机相比自然抵达格心最多提前 6px（约 0.04~0.06s），压缩长直道末端的按键转向迟滞
    // 仅在队列中确有"可生效且不同于当前方向"的转向意图时才吸附：
    // 无转向需求时保持匀速自然穿越，避免吸附白跳造成变相加速（街机 cornering 语义）
    let snappedDist = 0; // 本帧吸附前进的像素数，需从当帧移动距离中扣除以保持速度恒定
    if (!pac.stopped && pac.dirQueue.length) {
        const d = DIRS[pac.dir];
        // 下一格 = 当前所在格沿行进方向的邻格；pac 始终位于两格心之间，
        // 故到下一格心的距离恒为 (0, CELL] 开区间正值（与 stepEntity 的 ahead 算法同基准）
        const nc = { x: pac.cell.x + d.x, y: pac.cell.y + d.y };
        // 队列中存在任一"下一格心处可通行且会导致转向"的意图才值得吸附；
        // 与当前方向相同的意图无需吸附（自然穿越时 pacOnCenter 会消费它）
        let wantTurn = false;
        for (let i = 0; i < pac.dirQueue.length; i++) {
            const q = pac.dirQueue[i];
            if (q !== pac.dir && canPass(nc.x + DIRS[q].x, nc.y + DIRS[q].y)) {
                wantTurn = true;
                break;
            }
        }
        if (wantTurn) {
            const distToCenter = (centerX(nc.x) - pac.x) * d.x + (centerY(nc.y) - pac.y) * d.y;
            if (distToCenter > 0.001 && distToCenter <= TURN_SNAP_DIST) {
                snappedDist = distToCenter;
                pac.x = centerX(nc.x); // 吸附到下一格心（吸附量 ≤ 6px，视觉不可察觉）
                pac.y = centerY(nc.y);
                pac.cell = nc;
                // 隧道环绕：与 stepEntity 同口径的取模折返，避免吸附跨界格心时漏出边界（保持隧道穿越一致）
                if (pac.cell.x < 0) {
                    pac.cell.x = COLS - 1;
                    pac.x += COLS * CELL;
                } else if (pac.cell.x >= COLS) {
                    pac.cell.x = 0;
                    pac.x -= COLS * CELL;
                }
                pacOnCenter(); // 与正常穿越格心同一路径：吃豆 + 转向 + 停止判定
                if (state !== 'play') return; // 吃到最后一颗豆触发清版时立即退出
            }
        }
    }
    if (pac.stopped) {
        // 停在格心时持续尝试按预输入队列恢复
        if (applyQueuedTurn()) {
            pac.stopped = false;
        }
    }
    if (!pac.stopped) {
        // 扣除吸附已前进的距离，保证任意帧总位移恒等于 pacSpeed * dt（吸附不加速）
        stepEntity(pac, Math.max(0, pacSpeed * dt - snappedDist), pacOnCenter);
        if (state !== 'play') return; // 吃到最后一颗豆触发清版时立即退出
    }

    // ---- 幽灵移动 ----
    for (const g of ghosts) {
        if (g.mode === 'house') {
            // 屋内等待：计满各自出屋延迟后转为 exit 模式、朝门上行出屋
            g.releaseTimer += dt;
            if (g.releaseTimer >= g.releaseDelay) {
                g.mode = 'exit';
                g.dir = 'up';
            }
            continue;
        }
        stepEntity(g, ghostSpeed(g) * dt, ghostOnCenter);
    }
    // eyes 回巢拖尾：限频采样轨迹点（所有眼睛共享池，总量上限 32 点），营造飞速归巢的运动轨迹
    trailPushTimer -= dt;
    if (trailPushTimer <= 0) {
        trailPushTimer = 0.03;
        for (const g of ghosts) {
            if (g.mode === 'eyes') {
                eyeTrails.push({ x: g.x, y: g.y, t: 1 });
                if (eyeTrails.length > 32) eyeTrails.shift();
            }
        }
        // 吃豆人残影采样：仅行进中采样，停止时不堆积光点
        if (!pac.stopped) {
            pacTrails.push({ x: pac.x, y: pac.y, t: 1 });
            if (pacTrails.length > 32) pacTrails.shift();
        }
    }

    // ---- 碰撞检测 ----
    checkCollisions();
}

/**
 * 吃豆人与幽灵碰撞：惊惧则反杀得分，否则死亡（无敌模式下非惊惧态幽灵无伤害，互相穿过）；
 * 另含水果拾取判定
 */
function checkCollisions() {
    const r2 = HIT_RADIUS * HIT_RADIUS;
    for (const g of ghosts) {
        if (g.mode === 'eyes' || g.mode === 'house') continue;
        const dx = g.x - pac.x;
        const dy = g.y - pac.y;
        if (dx * dx + dy * dy < r2) {
            if (g.frightened) {
                // 连击计分：200 -> 400 -> 800 -> 1600
                const pts = 200 * (2 ** ghostCombo);
                // 自增前连击为 3 说明这是本次能量期吃到的第 4 只幽灵
                const isFourth = ghostCombo === 3;
                // 连吃音效随反杀序号升调：comboUp(n-1)，n 为本次能量期已吃幽灵序号（1→4 播 0→3）
                SFX.comboUp(ghostCombo);
                ghostCombo = Math.min(ghostCombo + 1, 3);
                addScore(pts);
                floatTexts.push({ x: g.x, y: g.y, text: String(pts), timer: 1 });
                spawnParticles(g.x, g.y, '#35e0ff', 12); // 青色迸溅强调反杀
                // 反杀分档反馈：命中顿帧（FX.hitstop 自带 reduced-motion 降级）+ 连击越高震动越久
                FX.hitstop(50);
                if (!FX.prefersReduced) shakeTime = 0.1 + ghostCombo * 0.05;
                g.mode = 'eyes';
                g.frightened = false;
                SFX.pacGhost();
                trackRunStat('ghostCombo', ghostCombo); // 成就埋点：能量期连击上报（驱动 ghost2 进度判定）
                if (isFourth) unlockAchievement('combo4'); // 单次能量期四连反杀成就（事件型直接解锁）
            } else if (invincibleMode) {
                // 无敌模式：跳过非惊惧态幽灵的伤害判定，玩家与幽灵互相穿过
                // （不掉命、不重置位置、不播放死亡动画）；惊惧态反杀得分不受影响
            } else {
                startDying();
                return;
            }
        }
    }
    // 水果拾取：吃豆人触到水果（幽灵屋正下方格）即得分
    if (fruit) {
        const fx = centerX(FRUIT_POS.x);
        const fy = centerY(FRUIT_POS.y);
        const fdx = fx - pac.x;
        const fdy = fy - pac.y;
        if (fdx * fdx + fdy * fdy < r2) {
            fruit = null;
            // 得分 = 100 × 关卡数，封顶 1000
            const pts = Math.min(FRUIT_BASE_SCORE * level, FRUIT_MAX_SCORE);
            addScore(pts);
            floatTexts.push({ x: fx, y: fy - CELL, text: String(pts), timer: 1.4 });
            spawnParticles(fx, fy, '#ff3b3b', 10); // 红色果汁迸溅
            SFX.pacPower(); // 复用既有奖励得分音
        }
    }
}

/* ===================== 绘制 ===================== */

/**
 * 将静态迷宫层（墙体 + 幽灵门）渲染到离屏画布：
 * 离屏画布物理分辨率与主画布一致（1:1 物理像素映射），每帧仅需一次 drawImage
 * @param {boolean} flash 是否处于清版闪白相位
 */
function renderMazeLayer(flash) {
    const wallFill = flash ? '#f0f0ff' : '#101038';
    const wallEdge = flash ? '#ffffff' : '#3a5bff';

    // 离屏画布使用与主画布一致的物理分辨率 + DPR 变换，保证像素一一对应
    mazeCanvas.width = canvas.width;
    mazeCanvas.height = canvas.height;
    mazeCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    mazeCtx.clearRect(0, 0, view.w, view.h);

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const t = grid[r][c];
            const px = c * CELL;
            const py = r * CELL;
            if (t === T_WALL) {
                // 墙体底色
                mazeCtx.fillStyle = wallFill;
                mazeCtx.fillRect(px, py, CELL, CELL);
                // 朝开放侧描 2px 霓虹边线
                mazeCtx.fillStyle = wallEdge;
                const open = (cc, rr) => {
                    if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) return false;
                    return grid[rr][cc] !== T_WALL;
                };
                if (open(c, r - 1)) mazeCtx.fillRect(px, py, CELL, 2);
                if (open(c, r + 1)) mazeCtx.fillRect(px, py + CELL - 2, CELL, 2);
                if (open(c - 1, r)) mazeCtx.fillRect(px, py, 2, CELL);
                if (open(c + 1, r)) mazeCtx.fillRect(px + CELL - 2, py, 2, CELL);
            } else if (t === T_DOOR) {
                // 幽灵门：粉色横条
                mazeCtx.fillStyle = '#ff9fd6';
                mazeCtx.fillRect(px + 2, py + CELL / 2 - 2, CELL - 4, 4);
            }
        }
    }
    mazeLayerFlash = flash ? 1 : 0; // 记录当前相位，相位未变时跳过重建
}

/**
 * 绘制动态层：先按需重建离屏静态迷宫层并整幅贴回，
 * 再逐格绘制豆子与能量豆（随吃豆实时变化，必须每帧绘制）
 * @param {number} now 当前时间戳（毫秒，用于能量豆脉冲与清版闪白）
 */
function drawMaze(now) {
    // 清版庆祝时墙体闪白（间隔常量化：reduced-motion 下降频）
    const flash = state === 'clear' && Math.floor(now / FLICKER_MS) % 2 === 0;
    const phase = flash ? 1 : 0;
    // 仅闪白相位变化时重建离屏层（常态渲染一次后每帧只贴图）
    if (mazeLayerFlash !== phase) renderMazeLayer(flash);
    // 离屏层整幅贴回：目标为逻辑尺寸（自动经 DPR 变换映射回物理像素，
    // 源物理尺寸与目标物理尺寸一致故为 1:1 采样，且保留外层震动偏移）
    ctx.drawImage(mazeCanvas, 0, 0, view.w, view.h);

    // ---- 豆子与能量豆（动态，逐帧绘制） ----
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const t = grid[r][c];
            const px = c * CELL;
            const py = r * CELL;
            if (t === T_DOT) {
                // 普通豆子：小方块
                ctx.fillStyle = '#ffd7a8';
                ctx.fillRect(px + CELL / 2 - 2, py + CELL / 2 - 2, 4, 4);
            } else if (t === T_POWER) {
                // 能量豆：脉冲圆
                const pulse = 4 + Math.sin(now / 180) * 1.5;
                ctx.fillStyle = '#ffe9b0';
                ctx.beginPath();
                ctx.arc(px + CELL / 2, py + CELL / 2, pulse, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

/**
 * 绘制水果（樱桃造型）：茎 + 果身双圆 + 高光；
 * 存活最后 FRUIT_BLINK_DURATION 秒按 FLICKER_MS 间隔闪烁预告消失
 * @param {number} now 当前时间戳（毫秒）
 */
function drawFruit(now) {
    if (!fruit) return;
    // 最后 2 秒闪烁（reduced-motion 下闪烁降频，保留消失预告）
    if (fruit.timer < FRUIT_BLINK_DURATION && Math.floor(now / FLICKER_MS) % 2 === 0) return;
    const x = centerX(FRUIT_POS.x);
    const y = centerY(FRUIT_POS.y);
    // 果身：两颗相交的红圆
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.arc(x - 3.5, y + 3, 5, 0, Math.PI * 2);
    ctx.arc(x + 4, y + 1.5, 5, 0, Math.PI * 2);
    ctx.fill();
    // 果茎：绿色两叉
    ctx.strokeStyle = '#39ff6a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, y + 1);
    ctx.quadraticCurveTo(x - 1, y - 7, x + 5, y - 8);
    ctx.moveTo(x + 4, y - 0.5);
    ctx.quadraticCurveTo(x + 5, y - 6, x + 5, y - 8);
    ctx.stroke();
    // 高光：白色小点
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath();
    ctx.arc(x - 5, y + 1.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
}

/**
 * 绘制吃豆人（死亡动画时嘴张至整圆消失）
 * @param {number} now 当前时间戳（毫秒）
 */
function drawPac(now) {
    const R = CELL * 0.48;
    const d = DIRS[pac.dir];
    const base = Math.atan2(d.y, d.x);
    let mouth;
    if (state === 'dying') {
        // 死亡：嘴随进度张到 PI（整圆消失）
        const p = 1 - dyingTimer / DEATH_DURATION;
        mouth = 0.25 + p * (Math.PI - 0.25);
    } else {
        mouth = pac.stopped ? 0.25 : 0.12 + 0.23 * Math.abs(Math.sin(now / 70));
    }
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(pac.x, pac.y);
    ctx.arc(pac.x, pac.y, R, base + mouth, base + Math.PI * 2 - mouth);
    ctx.closePath();
    ctx.fill();
    // 能量豆倒计时环：惊惧期间围绕吃豆人显示剩余反杀时间
    // （剩余弧自顶部顺时针延展、随消耗回缩，最后 FLICKER_DURATION 秒与幽灵白闪同步转红加粗）
    if (frightTimer > 0) {
        const k = frightTimer / frightDur; // 剩余时间比例
        const urgent = frightTimer < FLICKER_DURATION;
        ctx.beginPath();
        ctx.arc(pac.x, pac.y, R + 4, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.strokeStyle = urgent ? '#ff5a5a' : '#35e0ff';
        ctx.lineWidth = urgent ? 3.5 : 2.5;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

/**
 * 绘制单只幽灵（身体 + 锯齿裙边 + 顺方向偏移的眼睛）
 * @param {object} g 幽灵实体
 * @param {number} now 当前时间戳（毫秒）
 * @param {number} index 幽灵序号（屋内震荡相位错开用）
 */
function drawGhost(g, now, index) {
    const R = CELL * 0.44;
    let x = g.x;
    let y = g.y;
    // 屋内等待时上下震荡（仅视觉，不影响逻辑坐标）
    if (g.mode === 'house') {
        y += Math.sin(now / 150 + index * 1.6) * 3;
    }
    if (g.mode !== 'eyes') {
        // 身体颜色：正常 / 惊惧蓝 / 惊惧末段闪烁白
        let body = g.color;
        if (g.frightened) {
            body = (frightTimer < FLICKER_DURATION && Math.floor(now / FLICKER_MS) % 2 === 0)
                ? '#f0f0ff' : '#2121ff';
        }
        ctx.fillStyle = body;
        const bottom = y + R - 2;
        ctx.beginPath();
        ctx.arc(x, y - 2, R, Math.PI, 0);       // 顶部半圆
        ctx.lineTo(x + R, bottom);              // 右侧竖边
        // 锯齿裙边：4 齿，波谷与波峰交替
        const feet = 4;
        const fw = (R * 2) / feet;
        for (let i = 0; i < feet; i++) {
            ctx.lineTo(x + R - fw * (i + 0.5), y + R);          // 谷
            ctx.lineTo(x + R - fw * (i + 1), bottom);           // 峰
        }
        ctx.closePath();
        ctx.fill();
    }
    // 眼睛：惊惧时画惊恐脸，其余画白眼球 + 顺方向瞳孔
    if (g.frightened && g.mode !== 'eyes') {
        const flash = frightTimer < FLICKER_DURATION && Math.floor(now / FLICKER_MS) % 2 === 0;
        ctx.fillStyle = flash ? '#ff3b3b' : '#f0f0ff';
        // 两点眼
        ctx.fillRect(x - 5, y - 4, 3, 3);
        ctx.fillRect(x + 2, y - 4, 3, 3);
        // 波浪嘴
        ctx.strokeStyle = flash ? '#ff3b3b' : '#f0f0ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
            const mx = x - 6 + i * 2;
            const my = y + 3 + (i % 2 === 0 ? -1.5 : 1.5);
            if (i === 0) ctx.moveTo(mx, my);
            else ctx.lineTo(mx, my);
        }
        ctx.stroke();
    } else {
        const dx = DIRS[g.dir].x * 2.5;
        const dy = DIRS[g.dir].y * 2.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - 4.5, y - 3, 3.2, 0, Math.PI * 2);
        ctx.arc(x + 4.5, y - 3, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b1bd0';
        ctx.beginPath();
        ctx.arc(x - 4.5 + dx, y - 3 + dy, 1.8, 0, Math.PI * 2);
        ctx.arc(x + 4.5 + dx, y - 3 + dy, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 绘制吃豆粒子（透明度随寿命衰减的小方块）
 */
function drawParticles() {
    for (let i = 0; i < particlePool.n; i++) { // 池活跃区遍历
        const p = particlePool.items[i];
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制幽灵眼睛回巢拖尾（渐隐光点，画在幽灵层之下）
 */
function drawEyeTrails() {
    for (const p of eyeTrails) {
        ctx.globalAlpha = p.t * 0.35;
        ctx.fillStyle = '#9db8ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 + 4 * p.t, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制吃豆人移动残影（渐隐黄色光点，画在幽灵与本体之下）：
 * 高速移动时留下短暂轨迹，强化速度感
 */
function drawPacTrails() {
    for (const p of pacTrails) {
        ctx.globalAlpha = p.t * 0.28;
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + 5 * p.t, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制吃幽灵得分浮动文字（出生时大字号弹跳缩小，随后上浮淡出）
 */
function drawFloatTexts() {
    ctx.textAlign = 'center';
    for (const f of floatTexts) {
        const age = 1 - f.timer; // 0 → 1 生命进度
        // 前 0.25 秒弹跳：字号从 1.8 倍缩至 1 倍，强调得分瞬间
        const scale = age < 0.25 ? 1.8 - (age / 0.25) * 0.8 : 1;
        ctx.globalAlpha = Math.max(f.timer, 0);
        ctx.fillStyle = '#7dffa4';
        ctx.font = `${Math.round(10 * scale)}px "Press Start 2P", monospace`;
        ctx.fillText(f.text, f.x, f.y - age * 18);
    }
    ctx.globalAlpha = 1;
}

/**
 * 在画布中央绘制状态提示文字（READY! / LEVEL UP!）
 */
function drawStateText() {
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    if (state === 'ready') {
        ctx.fillStyle = '#ffd23e';
        ctx.fillText('READY!', view.w / 2, centerY(11) + 6);
    } else if (state === 'clear') {
        ctx.fillStyle = '#7dffa4';
        ctx.fillText('LEVEL UP!', view.w / 2, centerY(11) + 6);
    }
}

/** 上次写入 HUD 的分数（-1 为初始哨兵，保证首帧必写入） */
let hudScore = -1;
/** 上次写入 HUD 的关卡 */
let hudLevel = -1;
/** 上次写入 HUD 的最高分 */
let hudHigh = -1;
/** 上次绘制的生命数（-1 为初始哨兵；livesCanvas 尺寸固定，数量不变即无需重绘） */
let drawnLives = -1;

/**
 * 绘制侧栏剩余生命图标（朝右的小吃豆人）；
 * 生命数与上次一致时直接跳过（每帧调用的清空+重绘仅在实际变化时执行）
 */
function drawLives() {
    if (lives === drawnLives) return; // 生命数未变化，跳过重绘
    drawnLives = lives;
    livesCtx.clearRect(0, 0, livesCanvas.width, livesCanvas.height);
    for (let i = 0; i < lives; i++) {
        const x = 16 + i * 28;
        const y = livesCanvas.height / 2;
        livesCtx.fillStyle = '#ffd23e';
        livesCtx.beginPath();
        livesCtx.moveTo(x, y);
        livesCtx.arc(x, y, 9, 0.35, Math.PI * 2 - 0.35);
        livesCtx.closePath();
        livesCtx.fill();
    }
}

/**
 * 更新侧栏分数 / 关卡 / 最高分显示；
 * 逐项缓存上次写入值，数值变化才写 textContent（避免每帧无差别 DOM 写入），
 * 值变化点（开局/续命/扣命/得分/快照恢复等）均在下一帧 draw 中被缓存对比捕获
 */
function updateHUD() {
    if (score !== hudScore) {
        hudScore = score;
        FX.tweenNumber(scoreVal, score, 128); // 分数数字滚动过渡（128ms 快速插值到位）
    }
    if (level !== hudLevel) {
        hudLevel = level;
        levelVal.textContent = level;
    }
    if (highScore !== hudHigh) {
        hudHigh = highScore;
        highVal.textContent = highScore;
    }
}

/**
 * 总绘制入口：分层顺序为 背景 → 震动偏移变换 → 迷宫（离屏层 + 豆子） → 水果 → 粒子 →
 * 眼睛拖尾 → 吃豆人残影 → 得分飘字 → 幽灵 → 吃豆人 → 状态文字，restore 后再叠最上层的
 * 全屏蓝闪/白闪，最后刷新侧栏 HUD 与生命图标（成就墙为 DOM 覆盖层，不由画布绘制）
 * @param {number} now 当前时间戳（毫秒）
 */
function draw(now) {
    // 背景
    ctx.fillStyle = '#1a1a0f';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    // 反杀 / 死亡的画布震动（随剩余时间线性衰减；reduced-motion 用户跳过）
    if (shakeTime > 0 && !FX.prefersReduced) {
        const amp = Math.min(1, shakeTime / 0.3) * 5;
        ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
    }
    drawMaze(now);
    drawFruit(now);
    drawParticles();
    drawEyeTrails();
    drawPacTrails();
    drawFloatTexts();
    // 死亡动画期间幽灵隐藏
    if (state !== 'dying') {
        ghosts.forEach((g, i) => drawGhost(g, now, i));
    }
    if (state !== 'start') drawPac(now);
    drawStateText();
    ctx.restore();
    // 能量豆全屏蓝闪（最上层覆盖，快速衰减）
    if (powerFlash > 0) {
        ctx.fillStyle = `rgba(120,180,255,${(powerFlash / 0.3) * 0.28})`;
        ctx.fillRect(0, 0, view.w, view.h);
    }
    // 死亡白闪（最上层覆盖，快速衰减）
    if (deathFlashTime > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(deathFlashTime / 0.12) * 0.45})`;
        ctx.fillRect(0, 0, view.w, view.h);
    }
    // 成就墙与解锁 toast 为 body 直挂的 DOM 覆盖层（z-index 高于画布），不再由 canvas 绘制
    updateHUD();
    drawLives();
}

/* ===================== 显示初始化 ===================== */

/**
 * 初始化 / 重建显示层：按设备像素比设置主画布物理分辨率并锁定逻辑坐标系，
 * 同步重建迷宫静态层离屏画布（尺寸依赖主画布物理分辨率）；
 * 窗口尺寸或 DPR 变化（如拖入另一块屏）时整体重算
 */
function setupDisplay() {
    // FX.setupCanvas 返回 { ctx, w, h, dpr }：w/h 为 CSS 逻辑像素，绘制一律基于此坐标
    view = FX.setupCanvas(canvas, 2);
    // 重置离屏层相位为"未渲染"，强制下一帧 drawMaze 按新物理分辨率重建墙层
    mazeLayerFlash = -1;
}

/* ===================== 成就系统 v2（DOM 成就墙） ===================== */

/** 成就存档（v2）：{ unlocked:{id:时间戳ms}, best:{统计名:历史最大值} }，启动时读取并迁移旧档 */
let achStore = loadAchStore();
/** 成就墙根元素（全屏遮罩，点击空白处关闭） */
const achWall = document.getElementById('achWall');
/** 成就卡片网格容器 */
const achGrid = document.getElementById('achGrid');
/** 已解锁计数元素（FX.tweenNumber 数字滚动） */
const achCountEl = document.getElementById('achCount');
/** 成就总数元素 */
const achTotalEl = document.getElementById('achTotal');
/** 头部完成度进度条填充 */
const achBarFill = document.getElementById('achBarFill');
/** 右上角解锁 toast 堆叠容器 */
const achToastStack = document.getElementById('achToastStack');
/** 成就墙是否打开（打开时冻结逻辑 tick 与对局输入，渲染照常） */
let achPanelOpen = false;

/**
 * 读取成就存档并做 v1 → v2 格式迁移
 * v2 格式：{ unlocked:{id:时间戳ms}, best:{统计名:历史最大值} }
 * v1 旧格式：纯字符串数组（pac 老版存档）——旧 id 全部迁入新 unlocked（时间戳 0），
 * 老玩家成就绝不丢失；另将旧 pacDotsTotal 独立键并入 best.dotsTotal（取较大值），
 * 跨局累计吃豆进度无缝接续；解析失败或存储不可用按空档处理
 * @returns {{unlocked: Object.<string, number>, best: Object.<string, number>}} 归一化后的成就存档
 */
function loadAchStore() {
    let raw = null;
    try {
        raw = JSON.parse(localStorage.getItem(ACH_KEY_PAC) || 'null');
    } catch (e) {
        raw = null; // JSON 解析失败按无存档处理
    }
    // 归一化为 v2 结构：数组即旧档；对象逐键校验类型，字段缺失/类型不符一律补默认值
    const store = {
        unlocked: (raw && !Array.isArray(raw) && raw.unlocked && !Array.isArray(raw.unlocked) && typeof raw.unlocked === 'object') ? raw.unlocked : {},
        best: Object.assign({}, ACH_BEST_DEFAULTS, (raw && !Array.isArray(raw) && raw.best && !Array.isArray(raw.best) && typeof raw.best === 'object') ? raw.best : {}),
    };
    // v1 迁移：读到纯数组（或旧对象形态）时，把旧 id 全部并入新 unlocked（时间戳 0）
    const legacyIds = Array.isArray(raw) ? raw : (raw && raw.unlocked && Array.isArray(raw.unlocked) ? raw.unlocked : null);
    if (legacyIds) {
        for (const id of legacyIds) {
            if (typeof id === 'string' && !(id in store.unlocked)) store.unlocked[id] = 0;
        }
        saveAchStore(store); // 一次性迁移写盘（失败静默，内存态已生效）
    }
    // 旧累计吃豆键迁移：best.dotsTotal 低于旧键历史值时并入（旧档升级首次读取即接续原进度）
    try {
        const legacyDots = parseInt(localStorage.getItem(DOTS_TOTAL_KEY) || '0', 10) || 0;
        if (legacyDots > (store.best.dotsTotal || 0)) {
            store.best.dotsTotal = legacyDots;
            saveAchStore(store);
        }
    } catch (e) {
        /* 存储不可用：跳过迁移，累计从当前值起算 */
    }
    return store;
}

/**
 * 将成就存档持久化到 localStorage（隐私模式等写入受限场景静默跳过，不影响游戏）
 * @param {{unlocked: Object, best: Object}} store 成就存档
 * @returns {void}
 */
function saveAchStore(store) {
    try {
        localStorage.setItem(ACH_KEY_PAC, JSON.stringify(store));
    } catch (e) { /* 存储不可用时静默放弃 */ }
}

/**
 * 上报本局统计（max 语义）：仅破纪录时写盘并判定挂在该统计上的进度型成就
 * （score5000/score20000 ← score、level3 ← level、ghost2 ← ghostCombo）
 * @param {string} stat 统计名（ACH_BEST_DEFAULTS 中的键）
 * @param {number} value 本局当前值
 * @returns {void}
 */
function trackRunStat(stat, value) {
    if (!(stat in achStore.best) || value <= achStore.best[stat]) return; // 未破纪录：不写盘不判成就
    achStore.best[stat] = value;
    saveAchStore(achStore);
    // 新纪录落盘后逐条比对定义表，达标即解锁（unlockAchievement 幂等，重复触发自动忽略）
    for (const a of ACHIEVEMENTS_PAC) {
        if (a.stat === stat && value >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 累计型统计上报（add 语义，如跨局累计吃豆 dotsTotal）：增量累入 best 并判定对应成就
 * @param {string} stat 统计名（ACH_BEST_DEFAULTS 中的键）
 * @param {number} delta 本次增量（非正数忽略）
 * @returns {void}
 */
function trackCumulativeStat(stat, delta) {
    if (!(stat in achStore.best) || delta <= 0) return;
    achStore.best[stat] += delta;
    saveAchStore(achStore);
    // 累计刷新后逐条比对定义表，达标即解锁（dots500 / dots2000）
    for (const a of ACHIEVEMENTS_PAC) {
        if (a.stat === stat && achStore.best[stat] >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 解锁成就（幂等：已解锁直接返回）：持久化 → 右上角 DOM toast → 解锁音，
 * 史诗 / 传说追加金色烟花庆祝演出；成就墙开着时即时刷新卡片解锁态
 * @param {string} id 成就 id（见 ACHIEVEMENTS_PAC 定义表）
 * @returns {void}
 */
function unlockAchievement(id) {
    if (achStore.unlocked[id]) return;
    const meta = ACHIEVEMENTS_PAC.find(a => a.id === id);
    if (!meta) return;
    achStore.unlocked[id] = Date.now();
    saveAchStore(achStore);
    showAchToast(meta); // 右上角堆叠 toast（稀有度色边，自动消退）
    SFX.newRecord(); // 复用破纪录号角作为成就解锁音
    if (meta.rarity === 'epic' || meta.rarity === 'legendary') FX.recordBurst(); // 高稀有度追加金色烟花
    if (achPanelOpen) renderAchWall();
}

/**
 * 生成一张成就解锁 toast 挂入右上角堆叠容器
 * （CSS 动画自动滑入-停留-退场，animationend 播完自移除；堆叠上限 4 条）
 * @param {{id: string, name: string, icon: string, rarity: string}} meta 成就定义
 * @returns {void}
 */
function showAchToast(meta) {
    const el = document.createElement('div');
    el.className = 'ach-toast rarity-' + meta.rarity;
    el.innerHTML =
        '<div class="toast-icon">' + meta.icon + '</div>' +
        '<div class="toast-body"><span class="toast-cap">成就解锁 · ' + RARITY_LABEL[meta.rarity] + '</span>' +
        '<span class="toast-name">' + meta.name + '</span></div>';
    achToastStack.appendChild(el);
    el.addEventListener('animationend', () => el.remove()); // toastCycle 播完自动移除节点
    while (achToastStack.children.length > 4) achToastStack.firstChild.remove(); // 堆叠上限 4 条，超出移除最旧
}

/**
 * 重建成就墙卡片网格与头部完成度（开墙与墙内解锁时调用）
 * 卡片带 --i 序号驱动瀑布入场延迟；解锁卡带稀有度描边 + 流光扫过
 * @returns {void}
 */
function renderAchWall() {
    achGrid.innerHTML = ''; // 清空重建，保证与最新存档一致
    let count = 0;
    ACHIEVEMENTS_PAC.forEach((a, i) => {
        const ts = achStore.unlocked[a.id];
        const unlocked = !!ts;
        if (unlocked) count++;
        // 进度区：进度型成就展示 进度条+当前/目标；事件型成就展示 解锁日期或等待达成
        const progHtml = a.stat
            ? '<div class="ach-prog"><div class="ach-prog-fill" style="width:' + progPct(a) + '%"></div></div>' +
              '<div class="ach-prog-meta"><span>' + formatProg(a) + '</span><span>' + RARITY_LABEL[a.rarity] + '</span></div>'
            : '<div class="ach-prog-meta"><span>' + (unlocked ? '已于 ' + formatUnlockDate(ts) + ' 解锁' : '等待达成') + '</span><span>' + RARITY_LABEL[a.rarity] + '</span></div>';
        // 组装卡片：稀有度徽章 + 图标座（未解锁叠小锁）+ 名称/描述 + 进度区
        const card = document.createElement('div');
        card.className = 'ach-card ' + (unlocked ? 'unlocked ' : 'locked ') + 'rarity-' + a.rarity;
        card.style.setProperty('--i', i); // 瀑布入场序号（CSS 按 --i 递进延迟）
        card.innerHTML =
            '<div class="ach-rarity-chip rarity-' + a.rarity + '">' + RARITY_LABEL[a.rarity] + '</div>' +
            '<div class="ach-icon">' + a.icon + (unlocked ? '' : '<span class="ach-lock">🔒</span>') + '</div>' +
            '<div class="ach-info"><div class="ach-name">' + a.name + '</div>' +
            '<div class="ach-desc">' + a.desc + '</div>' + progHtml + '</div>';
        achGrid.appendChild(card);
    });
    // 头部：已解锁计数数字滚动补间 + 完成度进度条
    achTotalEl.textContent = ACHIEVEMENTS_PAC.length;
    FX.tweenNumber(achCountEl, count);
    achBarFill.style.width = Math.round((count / ACHIEVEMENTS_PAC.length) * 100) + '%';
}

/**
 * 计算进度型成就的进度百分比（0~100，事件型无 stat 返回 0）
 * @param {{stat?: string, target?: number}} a 成就定义
 * @returns {number} 进度百分比
 */
function progPct(a) {
    const cur = a.stat ? (achStore.best[a.stat] || 0) : 0;
    return Math.max(0, Math.min(100, Math.round((cur / a.target) * 100)));
}

/**
 * 进度文案：当前值 / 目标值
 * @param {{stat?: string, target?: number}} a 成就定义
 * @returns {string} 形如 "356 / 500" 的文案
 */
function formatProg(a) {
    return (achStore.best[a.stat] || 0) + ' / ' + a.target;
}

/**
 * 解锁时间戳 → 本地日期文案（v1 迁移的 0 时间戳显示"早已解锁"）
 * @param {number} ts 解锁时间戳（ms）
 * @returns {string} 日期文案
 */
function formatUnlockDate(ts) {
    if (!ts) return '早已解锁'; // v1 迁移成就无时间戳
    const d = new Date(ts);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

/**
 * 切换成就墙显隐（V/Esc/✕/点空白处触发；打开时冻结逻辑 tick 与对局输入）
 * @returns {void}
 */
function toggleAchPanel() {
    achPanelOpen = !achPanelOpen;
    if (achPanelOpen) {
        renderAchWall(); // 开墙：按最新存档重建卡片
        achWall.hidden = false;
    } else {
        achWall.hidden = true;
    }
    SFX.uiClick(); // 开合面板 UI 音
}

// 成就墙打开期间点击面板外空白处关闭（面板内点击冒泡到遮罩，需排除）
achWall.addEventListener('click', (e) => {
    if (e.target === achWall) toggleAchPanel();
});
// 头部 ✕ 关闭按钮
document.getElementById('achCloseBtn').addEventListener('click', toggleAchPanel);

/**
 * 检查水果出场条件：本关吃豆数达到 70 / 170 颗时在迷宫中央刷新水果
 * （fruitSpawned 记录已触发次数，每关在 resetPositions 中清零）
 */
function checkFruitSpawn() {
    if (fruitSpawned >= FRUIT_DOT_GOALS.length) return;
    if (pacDotsEaten >= FRUIT_DOT_GOALS[fruitSpawned]) {
        fruitSpawned++;
        fruit = { timer: FRUIT_LIFETIME };
        SFX.klNear(); // 水果登场：复用华容道临门轻快双哔（限时机会出现，速去拾取）
    }
}

/* ===================== CRT 全屏音 ===================== */

// CRT 开关机音：本页独立打开时监听全屏切换；嵌入模式（iframe）中
// fullscreenchange 不穿越文档边界，改由父页大厅广播 arcade:fs 消息驱动；
// arcade:exit 为子页请求关闭覆盖层的转发信号，同样以关机音收尾
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});
window.addEventListener('message', e => {
    const d = e.data;
    if (!d) return;
    if (d.type === 'arcade:fs') {
        if (d.fs) SFX.crtOn();
        else SFX.crtOff();
    } else if (d.type === 'arcade:exit') {
        SFX.crtOff();
    } else if (d.type === 'arcade:save') {
        saveSnapshot(); // 父页关闭覆盖层前下发：镜像当前局进度到 localStorage
    }
});

/* ===================== 进度快照触发点 ===================== */

// 左上角「← 游戏厅」返回链接：先镜像当前局进度再放行默认跳转（不调用 preventDefault）
const backLink = document.querySelector('.back-link');
if (backLink) backLink.addEventListener('click', () => { saveSnapshot(); });
// 页面隐藏/关闭（含父页移除 iframe、刷新、跳转）：进行中/暂停中镜像，未开始/已结束则清除残留快照
window.addEventListener('pagehide', () => { saveSnapshot(); });

/* ===================== 输入处理 ===================== */

/** 方向键映射表（方向键 + WASD） */
const KEY_DIR = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
};

/**
 * 全局键盘控制：方向键 / WASD 压入转向预输入队列（深度 2，快速连按不丢键，
 * 暂停或成就墙打开时方向键不入队，防止恢复瞬间残留方向立即生效）；
 * P 或空格在 play/ready 状态切换暂停；V/Esc 开合成就墙（全站统一开墙键：V）；
 * Enter 在开始/结束界面开局或重开
 * @param {KeyboardEvent} e 键盘事件
 */
window.addEventListener('keydown', e => {
    if (KEY_DIR[e.code]) {
        e.preventDefault();
        if (e.repeat) return; // 防御：按住方向的系统重复键不再入队（队列同向去重已兜底，此处显式拦截语义更清晰）
        // 暂停或成就墙打开时冻结转向预输入：主循环逻辑已停走，此时入队的方向
        // 会在恢复瞬间立即消费（队列仍未清空），导致"恢复后莫名移动"；
        // 仅拦截暂停态，未开始/结束态按键语义保持原样
        if (isPaused || achPanelOpen) return;
        if (pac) queueDirection(KEY_DIR[e.code]);
        return;
    }
    // 成就墙打开期间吞掉全部操作键：仅 Esc / V 可关墙（防长按连发），其余一律短路防误触
    if (achPanelOpen) {
        if (e.code === 'Space') e.preventDefault(); // 空格防页面滚动
        if ((e.code === 'Escape' || e.code === 'KeyV') && !e.repeat) toggleAchPanel();
        return;
    }
    if (e.code === 'KeyP' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && (state === 'play' || state === 'ready')) togglePause(); // 防长按连发
        return;
    }
    if (e.code === 'KeyV') {
        if (!e.repeat) toggleAchPanel(); // 防长按连发
        return;
    }
    if (e.code === 'Enter') {
        if (!e.repeat && (state === 'start' || state === 'over')) startGame(); // 防长按连发（首个 keydown 已离开始/结束态，显式防御保持一致）
    }
});

/* ---------- 触屏 / 鼠标滑动转向：画布手势通道（与键盘共用同一预输入队列） ---------- */

/** 滑动出招阈值（像素）：位移超过该值才判定方向，避免轻点误触（与 1024 同款契约） */
const SWIPE_THRESHOLD = 26;
/** 是否有进行中的画布滑动手势（pointerdown 起手，up/cancel/失焦收尾） */
let swipeActive = false;
/** 手势起点（客户端坐标，每次出招后重置为当前指针位置，支持一次触摸连续出招） */
let swipeX = 0, swipeY = 0;

/** 终止进行中的滑动手势：暂停/失焦时调用，防止残留手势在恢复后误出招 */
function endSwipe() {
    swipeActive = false;
}

// 画布按下起手：仅对局可操作态（play，或 ready 倒计时——与键盘预输入窗口一致）接受手势，
// 暂停/成就墙/未开始/结束/死亡与清版过场一律不起手；setPointerCapture 保证
// 按住后拖出画布仍持续跟踪至松手（鼠标左键 / 触屏 / 手写笔统一走本通道）
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 鼠标仅接受左键
    if (isPaused || achPanelOpen) return; // 与键盘通道相同的暂停守卫
    if (state !== 'play' && state !== 'ready') return; // 未开始/结束/过场动画不起手
    e.preventDefault(); // 阻止画布默认的拖选行为
    canvas.setPointerCapture(e.pointerId);
    swipeActive = true;
    swipeX = e.clientX;
    swipeY = e.clientY;
});
// 指针划动：超阈值取主导轴判定四方向，调 queueDirection 入转向预输入队列
// （内部同向去重，180° 掉头由主循环行进中自动消费）；触发后起点重置为当前
// 指针位置，同一次触摸可连环出招；手势进行中遇暂停/成就墙立即终止
canvas.addEventListener('pointermove', e => {
    if (!swipeActive) return; // 未按下时的悬浮移动直接忽略
    if (isPaused || achPanelOpen) { endSwipe(); return; } // 暂停/成就墙：立即终止手势
    if (state !== 'play' && state !== 'ready') return; // 死亡/清版过场冻结出招
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    // 位移不足阈值视为尚未成招，继续等待指针划动
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    if (pac) queueDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipeX = e.clientX; // 重置起点为当前指针位置，一次拖动可连续触发多步
    swipeY = e.clientY;
});
canvas.addEventListener('pointerup', endSwipe); // 松手结束手势（capture 保证必送达画布）
canvas.addEventListener('pointercancel', endSwipe); // 系统接管指针（如来电/系统手势）时兜底终止
window.addEventListener('blur', endSwipe); // 切窗后系统不会补发 pointerup，防止残留手势恢复后误出招

// 暂停遮罩点击恢复：面板悬浮于画布之上会拦截 pointerdown（不再落到画布滑动手势监听），
// 点击面板空白处即恢复（空格/失焦自动暂停弹出的遮罩共用同一 DOM，同样适用）；
// 点在遮罩内按钮/链接上（如返回大厅）只操作 UI 不恢复——与 bee.js 先例一致，
// 防止暂停中点链接先误恢复运行、快照存成运行态再退出
pauseScreen.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a')) return; // 按钮/链接交给自身逻辑，不作为恢复输入
    togglePause(); // 恢复并撤下遮罩（BGM 续播、恢复音、提示行清理均走 togglePause 分支）
});

// 失焦自动暂停，避免切窗口后回来暴毙
window.addEventListener('blur', () => {
    if ((state === 'play' || state === 'ready') && !isPaused) togglePause();
});

/* ===================== 主循环 ===================== */

/** 上一帧时间戳，首帧用当前时间防止 delta 跳变 */
let lastTime = performance.now();

/**
 * 请求动画帧主循环：累计 delta 驱动逻辑，逐帧重绘
 * @param {number} now 当前时间戳（毫秒）
 */
function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // 单帧步长上限 50ms：卡顿/断点后防止单帧位移过大（< 半格，保证格心判定稳定）
    lastTime = now;
    // 暂停或成就墙打开时冻结逻辑 tick（水果倒计时 / 幽灵等全部停走），仅保留渲染
    if (!isPaused && !achPanelOpen) update(dt);
    // 成就墙与解锁 toast 为 body 直挂的 DOM 覆盖层，浏览器自行推进其 CSS 动画，无需本循环参与
    draw(now);
    requestAnimationFrame(loop);
}

/* ===================== 初始化 ===================== */

// 难度恢复：页面加载时保持与上一次选择一致（按钮序号：0 无敌 / 1 简单 / 2 中等 / 3 困难，
// 默认中等即序号 2；加载时 AudioContext 尚未激活，selectDifficulty 中的 uiClick 无声，无害）
let savedDifficultyIndex = NaN; // 存储不可用（隐私模式/禁用站点数据）时兜底 NaN，按默认难度处理
try {
    savedDifficultyIndex = parseInt(localStorage.getItem(DIFFICULTY_KEY), 10);
} catch (e) { /* 存储不可用：静默保持兜底，不中断初始化 */ }
if (!Number.isNaN(savedDifficultyIndex) && savedDifficultyIndex !== 2) {
    const savedDifficultyBtn = document.querySelectorAll('.difficulty-btn')[savedDifficultyIndex];
    if (savedDifficultyBtn) selectDifficulty(savedDifficultyBtn);
}

buildGrid();
resetPositions();
try {
    highScore = parseInt(localStorage.getItem('pacHighScore') || '0', 10); // 存储不可用时静默保持默认 0
} catch (e) { /* 存储不可用（隐私模式/禁用站点数据）：不中断初始化 */ }
// 进度镜像恢复：核心状态已创建、默认新局逻辑之前尝试续玩；
// 成功则停在暂停遮罩等待玩家按 P 继续，失败/无快照则保持原开始界面新开局
restoreSnapshot();
// 初始 DPR 适配 + 窗口尺寸变化时重算（iframe 嵌入与独立打开均生效）
setupDisplay();
window.addEventListener('resize', setupDisplay);
requestAnimationFrame(loop);

// 游玩时长统计上报（返回大厅/关页时结算）+ 键帽实时高亮（按住时点亮说明面板键帽）
FX.playtime.init('pac');
FX.KeyLight.init();
