'use strict';
/* ==================================================================
 * 1024! 数字合并游戏逻辑
 *
 * 玩法：
 *   可选难度的棋盘（简单 5×5 / 普通 4×4 / 困难 3×3）上滑动全部方块，相同数字相撞合并翻倍；
 *   每次有效滑动后随机补充一个新块（90% 为 2 / 10% 为 4）；
 *   合并出 1024 即获胜（可继续挑战更高分），棋盘填满且无可合并时失败；
 *   连续滑动均有合并则连击递增，×2 起按合并值的 10%×(连击-1) 追加奖励分；
 *   每局限次撤销（简单 5 / 普通 3 / 困难 1），误滑或死局可回退上一步；
 *   本局首次合并出 128 / 256 / 512 / 2048 / 4096 时触发强化爆发反馈（双冲击波 + 全屏闪光 + 微震，≥2048 追加烟花秀）；
 *   一步多重合并触发 DOUBLE!/TRIPLE!/QUAD! 等中央大字演出，连击 ×5 棋盘金色炽燃泛光；
 *   空格告急时棋盘红色脉冲预警并播警报音，死局瞬间全盘"熄灭"渐暗演出再结算；
 *   超越历史最高的瞬间金色闪光庆祝 + 全屏烟花彩带，撤销带青色回溯闪光；
 *   ≥64 的合并触发瞬时卡帧（hitstop），无效滑动棋盘摇头提示；
 *   内置精致 DOM 成就墙（8 条成就四档稀有度，V/Esc 开合，历史最佳驱动进度条），
 *   结算面板统计本局步数 / 合并次数 / 最大方块 / 用时。
 *
 * 动画：
 *   - 滑动：方块逻辑位置瞬间更新，绘制坐标逐帧指数趋近目标格（lerp），
 *     滑动途中沿途留下一串渐隐底色拖尾；
 *   - 合并：两个源块转为"幽灵残影"滑向目标格并渐隐，合并结果块延迟
 *     一个滑动时长后以 easeOutBack 回弹放大登场；
 *   - 合并瞬间在目标格爆发像素粒子、扩散冲击波圆环并飘出得分文字，
 *     大合并（≥128）按数值档位引发全屏微震；
 *   - 1024 及以上的方块带金色呼吸辉光，达成 1024 触发三波全屏烟花秀；
 *   - 高值方块（≥128）滑动时沿途洒落同色发光微粒，强化"重块"的存在感；
 *   - 棋盘背景常驻缓慢漂移的星尘微光，营造氛围。
 *
 * 架构：
 *   tiles Map（id → 方块对象）为唯一方块实体表，grid[r][c] 存其引用；
 *   ghosts / floatTexts 为纯表现层数组，particles 为 FX.Pool 对象池，到时自动清理；
 *   单一 requestAnimationFrame 循环驱动 update + draw，回合制无需逻辑 tick。
 * ================================================================== */

/* ---------- 常量 ---------- */

/** 单元格间距（px） */
const GAP = 12;
/** 棋盘内边距（px）；PAD + (SIZE-1)×(CELL+GAP) + CELL + PAD = 500，与画布同宽 */
const PAD = 12;
/** 难度配置：棋盘边长（简单 5×5 空间宽松 / 普通 4×4 经典 / 困难 3×3 空间紧凑更易死局） */
const DIFFICULTIES = {
    easy: { size: 5 },
    normal: { size: 4 },
    hard: { size: 3 },
};
/** 默认难度键名 */
const DEFAULT_DIFFICULTY = 'normal';
/** 当前棋盘边长（格数），由所选难度决定 */
let SIZE = DIFFICULTIES[DEFAULT_DIFFICULTY].size;
/** 棋盘逻辑宽（px）：CSS 显示尺寸锁定 500px，DPR 适配后仅物理分辨率随 devicePixelRatio 放大 */
let BOARD_W = 500;
/** 棋盘逻辑高（px） */
let BOARD_H = 500;
/** 单元格边长（px），随棋盘尺寸动态缩放，保持棋盘总尺寸恒为 BOARD_W×BOARD_H（500×500） */
let CELL = (BOARD_W - PAD * 2 - GAP * (SIZE - 1)) / SIZE;
/** 滑动动画时长（秒）：幽灵残影滑行时长，也是合并块登场前的延迟 */
const SLIDE_DUR = 0.12;
/** 新块弹出动画时长（秒） */
const POP_DUR = 0.15;
/** 获胜目标值：合并出 1024 即胜利 */
const WIN_VALUE = 1024;
/** 新块为 4 的概率，其余为 2 */
const SPAWN4_PROB = 0.1;
/** 飘字存活时长（秒） */
const FLOAT_DUR = 0.9;

/* ---------- 每日挑战：日期种子开局（同一天所有新开局生成完全一致的谜题） ---------- */

/**
 * 取当日日期（本地时区 YYYYMMDD）：动态求值，页面跨午夜驻留后
 * 种子与达成键自然切换到新一天，不再沿用启动时固化的旧日期
 * @returns {string} 当日日期串（如 20261119）
 */
function todayDailyDate() {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

/**
 * 每日挑战达成存档键：按日期动态拼接（街机厅统一前缀 arcade_daily_），缺省取当日
 * @param {string} [dateStr] 归属日期串（YYYYMMDD，缺省为当日）
 * @returns {string} 达成键（如 arcade_daily_1024_20261119）
 */
function dailyKey(dateStr) {
    return 'arcade_daily_1024_' + (dateStr || todayDailyDate());
}
/** localStorage 键名单点定义（收敛文件内散落的键名常量，值与既有键完全一致，仅集中维护） */
const KEYS = {
    /** 最高分键（新键，与全库 {game}HighScore 命名风格统一，如 pacHighScore / snakeHighScore） */
    best: '1024HighScore',
    /** 旧版最高分键（历史遗留）：新键缺失时回退读取并一次性迁移写入新键，保留老玩家最高分 */
    legacyBest: '1024BestScore',
    /** 难度选择存档键，页面加载时恢复上一次选择（对齐其他游戏难度记忆） */
    difficulty: '1024Difficulty',
    // 每日挑战达成键（arcade_daily_1024_YYYYMMDD）按当日动态拼接，见 dailyKey()：跨午夜驻留后自动指向新一天
    /** 对局进度镜像快照键（街机厅统一契约 arcade_save_1024，与 snake/tetris/pac/bee/pinball 同族）：
     *  收到 arcade:save 消息 / 页面卸载时保存，下次进入校验版本号与字段后恢复续玩；
     *  玩家主动重开、切换难度、达成胜利、棋盘死局结算时清除 */
    save: 'arcade_save_1024',
    /** 成就存档键（跨局持久化，与贪吃蛇的 arcade_ach_snake 同族） */
    ach: 'arcade_ach_1024',
};
/** 是否处于每日挑战模式：当日未达成的新开局置位；续玩快照恢复与普通局均为 false */
let dailyMode = false;
/** 每日挑战归属日期串（YYYYMMDD）：进入每日模式时缓存，达成落盘与快照开局日期均用缓存值（跨午夜通关不误标新一天） */
let dailyDateKey = '';
/** 每日挑战种子随机源（mulberry32 闭包）：dailyMode 下供 spawnTile 使用，保证同日开局方块序列一致 */
let dailyRng = null;

/**
 * 日期字符串 → 32 位种子（FNV-1a 多项式哈希）
 * @param {string} str 日期字符串（YYYYMMDD）
 * @returns {number} 32 位无符号种子
 */
function dateSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * mulberry32 伪随机数生成器：轻量可复现，返回 [0,1) 均匀分布
 * @param {number} seed 32 位种子
 * @returns {function(): number} 随机数生成函数
 */
function mulberry32(seed) {
    let a = seed;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 方块生成随机源：每日挑战模式走种子 RNG（同日同谜题），普通模式走 Math.random
 * @returns {number} [0,1) 区间随机数
 */
function dailyRand() {
    return dailyMode ? dailyRng() : Math.random();
}

/**
 * 进入每日挑战模式：当日尚未达成 1024 时调用——
 * 以日期种子初始化 RNG（同一开局重复调用可重置序列起点），
 * 已达成则保持普通模式；徽章可见性由 updateHud 统一刷新
 */
function setupDailyChallenge() {
    const done = !!Arcade.loadRaw(dailyKey()); // 存储不可用时视为未达成（键按当日动态取值）
    dailyMode = !done;
    if (dailyMode) {
        dailyDateKey = todayDailyDate(); // 进入时缓存归属日：达成落盘以开局日为准（跨午夜不漂移）
        dailyRng = mulberry32(dateSeed(dailyDateKey));
    }
}

/**
 * 每日挑战达成收尾（仅首次有效）：退出每日模式 + 落盘当日达成标记 + 金色飘字庆祝 + 达成号角
 */
function completeDailyChallenge() {
    if (!dailyMode) return;
    dailyMode = false; // 立即退出每日模式：胜利面板后续的继续挑战/重开走普通流程
    Arcade.saveRaw(dailyKey(dailyDateKey), '1'); // 落盘按开局缓存的归属日键：午夜后合成不误标新一天（存储不可用时静默跳过）
    addFloatText('每日挑战达成!', BOARD_W * 0.5, BOARD_H * 0.34, '#ffd23e', 22);
    SFX.n1024Milestone(); // 复用里程碑号角做达成音
}
/** 各方向的行列增量（dr：行偏移 / dc：列偏移） */
const VECTORS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
};
/**
 * 各数值方块的外观（bg：底色 / fg：数字色 / glow：是否呼吸辉光）。
 * 低值蓝灰 → 绿青蓝紫 → 粉红橙 → 金色高光，超出 2048 回退 max 档。
 */
const TILE_STYLE = {
    2: { bg: '#454f75', fg: '#c8d4f2' },
    4: { bg: '#4d5f9e', fg: '#e0e8ff' },
    8: { bg: '#39ff6a', fg: '#06220f' },
    16: { bg: '#35e0ff', fg: '#04222b' },
    32: { bg: '#4d79ff', fg: '#0a1230' },
    64: { bg: '#c17bff', fg: '#1d0730' },
    128: { bg: '#ff3ea5', fg: '#2b0619' },
    256: { bg: '#ff5540', fg: '#2b0a06' },
    512: { bg: '#ff9a3e', fg: '#2b1606' },
    1024: { bg: '#ffd23e', fg: '#2b2206', glow: true },
    2048: { bg: '#ffe97a', fg: '#2b2206', glow: true },
    max: { bg: '#fff6c8', fg: '#2b2206', glow: true },
};
/** 键盘按键 → 方向映射（方向键 + WASD）：以 e.code 物理键为键——方向键的 code 与 key 同名，WASD 为 KeyW/KeyS/KeyA/KeyD，不受 Shift/大写锁定改变键名影响 */
const KEY_DIRS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
};
/** 各难度每局可撤销步数（棋盘越宽松反悔机会越多） */
const UNDO_LIMITS = { easy: 5, normal: 3, hard: 1 };
/** 撤销快照栈上限（内存栈与存档镜像共用同一常量）：超限从队头丢弃最旧快照；
 *  撤销次数受 UNDO_LIMITS 限制（最多 5 次），远小于本上限，撤销行为不受影响，
 *  仅杜绝极端长局下内存栈无界增长 */
const HISTORY_MAX = 32;
/** 里程碑数值：本局首次合并出时触发强化反馈（≥2048 追加全屏烟花秀） */
const MILESTONE_VALUES = [128, 256, 512, 2048, 4096];
/** 滑动手势生效的最小位移（px），低于阈值不触发（触屏与鼠标拖拽共用） */
const SWIPE_THRESHOLD = 26;
/** 按住方向键后开始连滑的延迟（秒）：远短于系统按键重复约 0.5s 的初始延迟，长按更跟手 */
const REPEAT_DELAY = 0.16;
/** 连滑间隔（秒）：按住期间补发滑动的固定节奏，不随系统按键重复设置波动 */
const REPEAT_RATE = 0.09;
/** 方块滑动追踪速率（每秒指数趋近系数），越大方块越跟手 */
const LERP_RATE = 24;
/** 冲击波圆环存活时长（秒） */
const RING_DUR = 0.35;
/** 滑动拖尾存活时长（秒） */
const TRAIL_DUR = 0.18;
/** 背景星尘数量 */
const AMBIENT_COUNT = 36;
/** 烟花秀每波粒子颜色（橙金粉蓝绿循环） */
const FIREWORK_COLORS = ['#ff9a3e', '#ffd23e', '#ff3ea5', '#35e0ff', '#39ff6a'];
/** 死局熄灭演出时长（秒）：失败瞬间全盘渐暗遮罩的持续时间，播完再弹出结算面板 */
const DEATH_FADE_DUR = 0.75;
/** 无效滑动摇头时长（秒）：±3px 水平正弦抖动提示该方向不可行 */
const HEAD_SHAKE_DUR = 0.16;
/** 合并卡帧的起始数值：≥64 的合并才触发 hitstop，低值合并不打断滑动节奏 */
const HITSTOP_MIN_VALUE = 64;
/* ===================== 成就系统（共享库 ach-common.js 驱动，与全站游戏同一套实现） =====================
 * 存档格式 v2：{ unlocked:{id:时间戳ms}, best:{统计名:历史最大值} }，键 arcade_ach_1024 不变；
 * 旧格式（纯数组 id 列表）由共享库装载时全量迁移进新 unlocked（时间戳 0），老玩家成就绝不丢失。
 * 存档装载/迁移、解锁演出（toast 堆叠 + 解锁音 + 史诗/传说金色烟花）、成就墙渲染与
 * V/Esc/遮罩/✕ 开合接线全部下沉 ach-common.js，本文件仅保留定义表与本局统计上报 glue。
 * 面板为 body 直挂的全屏 DOM 覆盖层（#achWall），打开期间滑动/连滑/撤销等对局输入全部短路、
 * 用时统计冻结，渲染循环照常推进棋盘动画背景（成就墙 CSS 动画不受逻辑暂停影响）。
 */

/** 历史最佳统计默认值：best 里缺省的统计一律按 0 起算（新增统计向后兼容旧档） */
const ACH_BEST_DEFAULTS = { score: 0, maxTile: 0, merges: 0, mergesTotal: 0, moves: 0 };
/** 成就定义表（8 条，四档稀有度 普通3/稀有2/史诗2/传说1，顺序即成就墙展示顺序）：
 *  stat/target 驱动进度条（mergesTotal 为跨局累计值，以 best 持久化） */
const ACHIEVEMENTS_1024 = [
    { id: 'merge256',   name: '初窥门径',   icon: '🌱', rarity: 'common',    cat: '合成', desc: '合成出 256 方块',          stat: 'maxTile',     target: 256 },
    { id: 'max512',     name: '更上层楼',   icon: '🔢', rarity: 'rare',      cat: '合成', desc: '单局合成出 512 方块',      stat: 'maxTile',     target: 512 },
    { id: 'merge1024',  name: '巅峰达成',   icon: '👑', rarity: 'legendary', cat: '合成', desc: '合成出 1024 方块',         stat: 'maxTile',     target: 1024 },
    { id: 'score3000',  name: '小有所成',   icon: '🎯', rarity: 'common',    cat: '得分', desc: '单局得分达到 3000',        stat: 'score',       target: 3000 },
    { id: 'score10000', name: '万分俱乐部', icon: '🏆', rarity: 'epic',      cat: '得分', desc: '单局得分达到 10000',       stat: 'score',       target: 10000 },
    { id: 'merges100',  name: '百合并',     icon: '✨', rarity: 'rare',      cat: '合成', desc: '单局合并次数达到 100 次',  stat: 'merges',      target: 100 },
    { id: 'merges1000', name: '千锤百炼',   icon: '⚒️', rarity: 'epic',      cat: '合成', desc: '累计合并次数达到 1000 次', stat: 'mergesTotal', target: 1000 },
    { id: 'moves2000',  name: '步步为营',   icon: '👣', rarity: 'common',    cat: '技巧', desc: '单局滑动步数达到 2000 步', stat: 'moves',       target: 2000 },
];

/* ---------- 状态变量 ---------- */

/** 游戏主画布与 2D 绘图上下文 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
/** HUD 分数元素 */
const scoreEl = document.getElementById('score');
/** HUD 最高分元素 */
const bestEl = document.getElementById('best');
/** 「每日挑战」模式徽章（当日未达成时的新开局点亮，达成后隐藏） */
const dailyBadgeEl = document.getElementById('dailyBadge');
/** 开始遮罩 */
const startScreen = document.getElementById('startScreen');
/** 胜利遮罩 */
const winScreen = document.getElementById('winScreen');
/** 胜利面板当前分数元素 */
const winScoreEl = document.getElementById('winScore');
/** 结束遮罩 */
const gameOverScreen = document.getElementById('gameOverScreen');
/** 结束面板最终分数元素 */
const finalScoreEl = document.getElementById('finalScore');
/** 结束面板新纪录标记元素 */
const newRecordEl = document.getElementById('newRecord');
/** 暂停遮罩：对局暂停（手动或切窗自动）时覆盖棋盘，提示继续键位 */
const pauseScreen = document.getElementById('pauseScreen');
/** 连击 HUD 数值元素（常显，连击 ×2 起点亮粉色发光） */
const comboEl = document.getElementById('combo');
/** 撤销按钮（文字显示剩余次数，无快照或次数用尽时禁用） */
const undoBtn = document.getElementById('undoBtn');
/** 开始面板开始按钮 */
const startBtn = document.getElementById('startBtn');
/** 胜利面板继续挑战按钮 */
const continueBtn = document.getElementById('continueBtn');
/** 胜利面板重新开始按钮 */
const winRestartBtn = document.getElementById('winRestartBtn');
/** 结束面板重新开始按钮 */
const overRestartBtn = document.getElementById('overRestartBtn');
/* 控制按钮接线：原 HTML 内联 onclick 收编为 JS 监听，触发行为等价 */
startBtn.addEventListener('click', startGame);
continueBtn.addEventListener('click', continueGame);
winRestartBtn.addEventListener('click', startGame);
overRestartBtn.addEventListener('click', startGame);
undoBtn.addEventListener('click', doUndo);
/** 画布下方操作提示行内的"已恢复上次进度"标记（仅进度快照恢复成功时显示，本局重开后隐藏） */
const restoreNote = document.getElementById('restoreNote');
/** 1024 目标进度条填充元素（宽度随棋盘最大方块 log2 比例推进） */
const goalFillEl = document.getElementById('goalFill');
/** 1024 目标进度条文本元素（显示百分比，达成后显示 MAX 标记） */
const goalTextEl = document.getElementById('goalText');
/** 结算统计：本局步数元素 */
const statMovesEl = document.getElementById('statMoves');
/** 结算统计：本局合并次数元素 */
const statMergesEl = document.getElementById('statMerges');
/** 结算统计：本局最大方块元素 */
const statMaxTileEl = document.getElementById('statMaxTile');
/** 结算统计：本局用时元素 */
const statTimeEl = document.getElementById('statTime');
/** 方块实体表：id → { id, value, r, c, x, y, popDelay, pop } */
let tiles = new Map();
/** 合并幽灵残影：{ value, x, y, tx, ty, t }，滑向合并点后渐隐消失 */
let ghosts = [];
/** 合并爆裂像素粒子池 { x, y, vx, vy, life, maxLife, color, size }：预分配零分配复用，满员自动征用最旧粒子 */
const particlePool = new FX.Pool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2 }));
/** 得分飘字：{ x, y, text, t, color, size } */
let floatTexts = [];
/** 冲击波圆环：{ x, y, t, dur, color }，合并点向外扩散的描边圆（t<0 为延迟未启动） */
let rings = [];
/** 滑动拖尾：{ value, x, y, t }，方块滑行途中留下的渐隐底色残迹 */
let trails = [];
/** 屏幕震动强度（px），大合并/烟花时抬升，每帧线性衰减 */
let shake = 0;
/** 全屏闪光：{ t, dur, color }，里程碑/烟花时覆一层渐隐色（null 表示无闪光） */
let flash = null;
/** 背景星尘：{ x, y, vx, vy, size, phase, color }，常驻漂浮的装饰微光 */
let ambient = [];
/** 棋盘：grid[行][列] → 方块对象引用（空格为 null） */
let grid = [];
/** 方块自增 id（mergedIds 防二次合并依赖其唯一性） */
let nextId = 1;
/** 当前分数 */
let score = 0;
/** 历史最高分（localStorage 持久化） */
let best = 0;
/** 本局是否刷新过最高分（结算面板据此显示"新纪录"） */
let isNewRecord = false;
/** 是否已达成过 1024 胜利（胜利后继续挑战不再重复触发） */
let hasWon = false;
/** 是否处于可操作的对局中（输入与流程的门控） */
let playing = false;
/** 是否处于暂停（仅对局中可为 true：暂停时屏蔽滑动/撤销，遮罩提示继续键位） */
let isPaused = false;
/** 按住中的方向物理键（event.code，按按下顺序）：驱动自定义连滑（以物理键为键——Shift/大写锁定会改变 e.key 键名如 w→W，用 code 跟踪保证 keyup 必能清除） */
let heldKeys = [];
/** 连滑计时器（秒）：按下即刻出招后先等 REPEAT_DELAY，此后每 REPEAT_RATE 补发一步 */
let repeatTimer = 0;
/** 当前难度键名：easy / normal / hard */
let currentDifficulty = DEFAULT_DIFFICULTY;
/** 撤销快照栈：{ board: 值矩阵, score, combo }，每步有效滑动后入栈 */
let history = [];
/** 本局剩余撤销次数，开局时按难度取 UNDO_LIMITS 初始化 */
let undosLeft = 0;
/** 当前连击步数：连续有效滑动且发生合并则累加，某步无合并即清零 */
let combo = 0;
/** 本局已触发过反馈的里程碑数值集合 */
let milestones = new Set();
/** 死局熄灭演出：{ t, dur }，失败瞬间全盘渐暗遮罩的推进状态（null 表示未在演出中） */
let deathFade = null;
/** 胜利/失败面板及烟花演出的 setTimeout 句柄池：面板提前关闭时统一 clearTimeout，防止旧定时器到点操作已失效的面板 DOM */
let panelTimers = [];
/** 当前可见遮罩面板（startScreen / winScreen / gameOverScreen，null 为全部隐藏）：
 *  面板态的唯一状态源，由 showOverlay / hideOverlay 维护，键盘路由据此推导面板可见性，
 *  DOM style.display 仅作单向输出不再反向读取（与布尔状态双源并存时，改面板实现会静默破坏快捷键） */
let visiblePanel = null;
/** 本局是否已庆祝过刷新纪录（首次超越既有最高的瞬间只庆祝一次，重开时复位） */
let celebratedRecord = false;
/** 危险预警等级：0 安全 / 1 仅剩 2 空格 / 2 满盘或仅剩 1 空格（驱动红色脉冲边框与警报音） */
let dangerLevel = 0;
/** 累计时间（秒），驱动辉光呼吸等循环动画 */
let time = 0;
/** 上一帧时间戳（ms），用于计算帧间隔 dt */
let lastTime = performance.now();
/** 本局统计：有效滑动步数（结算面板展示，不持久化） */
let statMoves = 0;
/** 本局统计：合并总次数（结算面板展示，不持久化） */
let statMerges = 0;
/** 本局统计：已达成的最大方块值（开局铺块 / 合并 / 撤销后同步） */
let statMaxTile = 0;
/** 本局统计：累计用时（秒），仅可操作的对局态计时（暂停 / 成就墙 / 卡帧均冻结） */
let statTime = 0;
/** 无效滑动摇头剩余时长（秒），>0 时绘制层水平抖动棋盘 */
let headShake = 0;
/** 成就墙 DOM 覆盖层（#achWall，V/Esc 开合） */
const achWall = document.getElementById('achWall');
/** 成就卡片网格容器（#achGrid，每次开墙按最新存档重建） */
const achGrid = document.getElementById('achGrid');
/** 头部已解锁计数数字元素（#achCount，开墙时滚动补间到位） */
const achCountEl = document.getElementById('achCount');
/** 头部成就总数元素（#achTotal） */
const achTotalEl = document.getElementById('achTotal');
/** 头部完成度进度条填充元素（#achBarFill） */
const achBarFill = document.getElementById('achBarFill');
/** 右上角解锁 toast 堆叠容器（#achToastStack） */
const achToastStack = document.getElementById('achToastStack');

// 接入共享成就库：存档装载与 v1 迁移 / 解锁（toast + 号角音 + 史诗/传说烟花）/ 墙渲染 /
// V·Esc·遮罩点击·关闭按钮接线全部下沉 ach-common.js（本文件 keydown 的 V/Esc 分支随之移除）；
// canOpen 恒真对齐原分支语义：V 任意状态（含胜利/结束面板）均可开墙，快捷继续由 Enter 承担
Ach.init({
    defs: ACHIEVEMENTS_1024,
    storageKey: KEYS.ach,
    bestDefaults: ACH_BEST_DEFAULTS,
    mount: { wall: achWall, grid: achGrid, count: achCountEl, total: achTotalEl, barFill: achBarFill, toasts: achToastStack },
    canOpen: () => true
});

/* ---------- 工具函数 ---------- */

/** 计算指定列的方块左上角 X 坐标
 *  @param {number} c 列索引
 *  @returns {number} 像素 X 坐标 */
function cellX(c) { return PAD + c * (CELL + GAP); }

/** 计算指定行的方块左上角 Y 坐标
 *  @param {number} r 行索引
 *  @returns {number} 像素 Y 坐标 */
function cellY(r) { return PAD + r * (CELL + GAP); }

/** 手绘圆角矩形路径（兼容不支持原生 roundRect 的环境）
 *  @param {CanvasRenderingContext2D} c 绘图上下文
 *  @param {number} x 左上角 X
 *  @param {number} y 左上角 Y
 *  @param {number} w 宽
 *  @param {number} h 高
 *  @param {number} r 圆角半径 */
function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

/** easeOutBack 缓动：超过 1 后回落的弹出曲线，用于方块登场
 *  @param {number} t 进度 0~1
 *  @returns {number} 缓动后的缩放系数 */
function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** 获取指定数值的方块外观，超出预设表回退最高档
 *  @param {number} value 方块数值
 *  @returns {{bg: string, fg: string, glow?: boolean}} 外观配置 */
function getTileStyle(value) { return TILE_STYLE[value] || TILE_STYLE.max; }

/** 收集棋盘上所有空格坐标
 *  @returns {Array<{r: number, c: number}>} 空格数组 */
function emptyCells() {
    const cells = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (!grid[r][c]) cells.push({ r, c });
        }
    }
    return cells;
}

/** 判断棋盘是否未陷入死局：存在空格直接视为可继续（仅满盘后判定），满盘则检查相邻同值块
 *  @returns {boolean} true 表示棋盘仍有推进余地（有空格或存在可合并的相邻同值块） */
function canMergeAnywhere() {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const tile = grid[r][c];
            if (!tile) return true; // 有空格即可继续（仅在后判定时调用）
            // 右邻或下邻同值即存在合并机会
            if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === tile.value) return true;
            if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === tile.value) return true;
        }
    }
    return false;
}

/* ---------- DPR 适配与统计工具 ---------- */

/** 画布 DPR 适配（fx.js 统一入口）：物理分辨率 = CSS 尺寸 × devicePixelRatio（上限 2），
 *  逻辑坐标系维持 500×500 不变，既有按 CSS 像素的绘制代码零改动获得锐利渲染；
 *  窗口缩放 / 跨屏拖动时由 resize 监听重算
 *  @returns {void} */
function setupDisplay() {
    const dims = FX.setupCanvas(canvas, 2);
    BOARD_W = dims.w;
    BOARD_H = dims.h;
    slotLayerDirty = true; // 画布物理分辨率/DPR 已变：下一帧重建空槽静态层
}

/** 重算本局统计的最大方块值：扫描方块实体表取最大（开局铺块 / 撤销回溯后同步，
 *  合并路径走增量更新不经此处）
 *  @returns {void} */
function refreshMaxTile() {
    statMaxTile = 0;
    for (const t of tiles.values()) {
        if (t.value > statMaxTile) statMaxTile = t.value;
    }
}

/* ---------- 核心逻辑 ---------- */

/** 随机在空格生成一个新方块（90% 为 2 / 10% 为 4）
 *  @param {boolean} playSound 是否播放生成音效（开局铺底两块不播） */
function spawnTile(playSound) {
    const cells = emptyCells();
    if (!cells.length) return;
    const cell = cells[(dailyRand() * cells.length) | 0];
    const value = dailyRand() < SPAWN4_PROB ? 4 : 2;
    const tile = {
        id: nextId++,
        value,
        r: cell.r,
        c: cell.c,
        x: cellX(cell.c),          // 直接落在目标格，靠 pop 弹出表现登场
        y: cellY(cell.r),
        popDelay: 0,               // 无延迟立即弹出
        pop: 0,
    };
    grid[cell.r][cell.c] = tile;
    tiles.set(tile.id, tile);
    if (playSound) {
        // 稀有 4 块（10% 概率）用专属亮音，与普通 2 的轻点音区分
        if (value >= 4) SFX.n1024Spawn4();
        else SFX.n1024Spawn();
    }
}

/** 增加分数并实时刷新 HUD 与最高分
 *  @param {number} points 本次得分（合并结果值或连击奖励）
 *  @param {boolean} [refreshHud=true] 是否即时刷新分数 HUD：move 内的合并加分与
 *  连击加成传 false，由本步末尾统一刷新一次，避免单步重复数字滚动与强制回流 */
function addScore(points, refreshHud = true) {
    const prevBest = best; // 记录旧最高分，用于捕捉"首次超越"的庆祝时机
    score += points;
    // 实时写盘：即使中途关页也不丢新纪录
    if (score > best) {
        best = score;
        isNewRecord = true;
        Arcade.saveRaw(KEYS.best, String(best)); // 存储不可用时静默放弃，不影响本局计分与庆祝
        // 首次超越既有纪录的瞬间：金色闪光 + 中央大字庆祝（每局只庆祝一次；
        // 此前无纪录的新手局不庆祝，结算面板另有正式的新纪录播报）
        if (!celebratedRecord && prevBest > 0) {
            celebratedRecord = true;
            // 按棋盘比例居中定位（0.5/0.46 与原硬编码 250/230 在 500×500 棋盘下等价，三档难度通用）
            addFloatText('NEW RECORD!', BOARD_W * 0.5, BOARD_H * 0.46, '#ffd23e', 18);
            flash = { t: 0, dur: 0.5, color: '#ffd23e' };
            FX.recordBurst(); // 全屏金色烟花彩带庆祝（fx.js 自包含覆盖层，减弱动效时内部跳过）
            SFX.n1024Record();
        }
    }
    if (refreshHud) updateHud();
}

/** 执行一次方向滑动（本游戏的核心回合逻辑入口）
 *  编排四个内聚子步骤：落点探测 → 滑动/合并 → 撞墙反馈 → 步末结算；
 *  遍历顺序保证靠近方向一侧的块先移动/合并；每块沿方向滑至
 *  边界/异值块前，若前方为同值且未合并块则合二为一。
 *  @param {string} dir 方向：up / down / left / right
 *  @param {boolean} [announceBlock=true] 无效滑动是否播撞墙反馈（闷响 + 摇头）
 *  （连滑补发时传 false：长按撞墙期间不再闷响连击与摇头演出，只保留手动出招的反馈） */
function move(dir, announceBlock = true) {
    const v = VECTORS[dir];
    // 本步之前的完整快照（值矩阵 + 分数 + 连击），有效滑动后入栈供撤销
    const prevBoard = grid.map((row) => row.map((t) => (t ? t.value : 0)));
    const prevScore = score;
    const prevCombo = combo;
    const prevIsNewRecord = isNewRecord; // 新纪录标记随快照入栈：撤销时同步回退，防"救回死局仍播报新纪录"
    // 本步滑动过程的可变累计状态（探测/合并子步骤写入，步末结算子步骤消费）
    const step = {
        mergedIds: new Set(),  // 本次已参与合并的新块 id，防止一拖二二次合并
        moved: false,          // 是否发生任何位移/合并（决定是否补新块）
        mergeIndex: 0,         // 多重合并的音效错峰序号
        winTriggered: false,   // 本次合并是否达成 1024
        mergesThisMove: 0,     // 本步合并次数（>0 连击 +1，否则清零）
    };

    // 按方向构造遍历顺序：向下滑先处理最底行，向右滑先处理最右列
    const rows = Array.from({ length: SIZE }, (_, i) => i);
    const cols = Array.from({ length: SIZE }, (_, i) => i);
    if (v.dr > 0) rows.reverse();
    if (v.dc > 0) cols.reverse();

    for (const r of rows) {
        for (const c of cols) {
            const tile = grid[r][c];
            if (!tile) continue;
            const dest = probeTileDestination(tile, r, c, v, step.mergedIds);
            if (!dest) continue; // 原地不动
            if (dest.mergeTarget) mergeTiles(tile, dest.mergeTarget, r, c, dest.nr, dest.nc, step);
            else slideTile(tile, r, c, dest.nr, dest.nc);
            step.moved = true;
        }
    }

    if (!step.moved) {
        announceBlockedSlide(announceBlock); // 撞墙演出（摇头 + 闷响）：不补块、不判胜负
        return;
    }
    settleMove(dir, prevBoard, prevScore, prevCombo, prevIsNewRecord, step);
}

/** 沿方向逐格探测单个方块的落点：空格前进，同值未合并块标记为合并目标，异值停住
 *  @param {object} tile 待移动方块
 *  @param {number} r 方块当前行
 *  @param {number} c 方块当前列
 *  @param {{dr: number, dc: number}} v 方向行列增量
 *  @param {Set<number>} mergedIds 本次已参与合并的新块 id 表（一块一步只并一次）
 *  @returns {?{nr: number, nc: number, mergeTarget: ?object}} 落点（行/列/合并目标），原地不动返回 null */
function probeTileDestination(tile, r, c, v, mergedIds) {
    let nr = r, nc = c;
    let mergeTarget = null;
    for (;;) {
        const tr = nr + v.dr;
        const tc = nc + v.dc;
        if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break; // 出界：就地停住
        const occupant = grid[tr][tc];
        if (!occupant) { nr = tr; nc = tc; continue; }           // 空格：继续前进
        if (occupant.value === tile.value && !mergedIds.has(occupant.id)) {
            mergeTarget = occupant;                              // 可合并：记下目标
            nr = tr; nc = tc;
        }
        break;                                                   // 异值或已合并：停住
    }
    if (nr === r && nc === c) return null;                       // 原地不动
    return { nr, nc, mergeTarget };
}

/** 执行合并：两源块转幽灵滑行，目标格生成双倍值新块延迟弹出；
 *  同步完成计分、连击加成、粒子/冲击波/微震/里程碑/卡帧/音效与胜负埋点
 *  @param {object} tile 滑动中的源块
 *  @param {object} mergeTarget 被合并的同值块
 *  @param {number} r 源块当前行
 *  @param {number} c 源块当前列
 *  @param {number} nr 合并落点行
 *  @param {number} nc 合并落点列
 *  @param {object} step 本步累计状态（写入 mergedIds/mergeIndex/mergesThisMove/winTriggered） */
function mergeTiles(tile, mergeTarget, r, c, nr, nc, step) {
    grid[r][c] = null;
    grid[nr][nc] = null;
    tiles.delete(tile.id);
    tiles.delete(mergeTarget.id);
    const newValue = tile.value * 2;
    const newTile = {
        id: nextId++,
        value: newValue,
        r: nr,
        c: nc,
        x: cellX(nc),
        y: cellY(nr),
        popDelay: SLIDE_DUR,   // 等源块滑到位后再弹出
        pop: 0,
    };
    grid[nr][nc] = newTile;
    tiles.set(newTile.id, newTile);
    step.mergedIds.add(newTile.id);
    // 两个幽灵残影从各自当前位置滑向合并点
    const tx = cellX(nc), ty = cellY(nr);
    ghosts.push({ value: tile.value, x: tile.x, y: tile.y, tx, ty, t: 0 });
    ghosts.push({ value: mergeTarget.value, x: mergeTarget.x, y: mergeTarget.y, tx, ty, t: 0 });
    // 得分 = 合并结果值，飘字与粒子落在目标格中心（HUD 延后到步末统一刷新一次）
    addScore(newValue, false);
    const style = getTileStyle(newValue);
    const cx = tx + CELL / 2;
    const cy = ty + CELL / 2;
    addFloatText('+' + newValue, cx, cy);
    step.mergesThisMove++;
    // 本局统计：合并次数推进 + 最大方块增量同步
    statMerges++;
    if (newValue > statMaxTile) statMaxTile = newValue;
    // 成就埋点：最大方块增量先记入 statMaxTile，统一由本步末尾 checkRunAchievements 上报判定
    // （merge256 / max512 / merge1024 三条成就均由 best.maxTile 历史最佳驱动）
    // 连击加成：本步连击将达 comboNext，×2 起按 10%×(comboNext-1) 追加奖励分
    const comboNext = combo + 1;
    if (comboNext >= 2) {
        const bonus = Math.round(newValue * 0.1 * (comboNext - 1));
        if (bonus > 0) {
            addScore(bonus, false); // 连击加成同样延后刷新，避免单步两次强制回流重播跳动
            addFloatText('+' + bonus, cx, cy - 18, '#ff3ea5', 10); // 粉色小字标于主飘字上方
        }
    }
    spawnBurst(cx, cy, style.bg, 10, 150);
    spawnRing(cx, cy, style.bg); // 冲击波圆环随合并同步扩散
    // 大合并微震：≥128 起按数值档位抬升震动强度（128:2 / 256:3.5 / 512:5 / 1024:6.5）
    if (newValue >= 128) shake = Math.max(shake, 2 + (Math.log2(newValue) - 7) * 1.5);
    // 里程碑：本局首次合并出 128/256/512/2048/4096 给更大爆发 + 双冲击波 + 闪光 + 专属音效
    if (!milestones.has(newValue) && MILESTONE_VALUES.indexOf(newValue) !== -1) {
        milestones.add(newValue);
        spawnBurst(cx, cy, style.bg, 24, 230);
        spawnRing(cx, cy, style.bg, 0.08); // 第二道冲击波延迟错峰
        addFloatText(newValue + '!', cx, cy - CELL / 2 - 12, style.bg, 16);
        flash = { t: 0, dur: 0.4, color: style.bg }; // 全屏闪光强化仪式感
        shake = Math.max(shake, 5);
        SFX.n1024Milestone();
        // 超级里程碑（≥2048）：追加三波全屏烟花秀，仪式感拉满
        if (newValue >= 2048) spawnFireworks();
    }
    // 大合并卡帧：≥64 的合并按数值档位瞬时定格（hitstop），强化打击感
    if (newValue >= HITSTOP_MIN_VALUE) FX.hitstop(20 + Math.min(40, Math.log2(newValue) * 4));
    // 音高随合并值档位递升，多重合并按 60ms 错峰
    SFX.n1024Merge(newValue, step.mergeIndex * 0.06);
    step.mergeIndex++;
    // 首次达成目标值即触发胜利
    if (!hasWon && newValue >= WIN_VALUE) step.winTriggered = true;
}

/** 执行纯滑动（无合并）：逻辑位置立即更新，绘制坐标交由渲染层 lerp 追赶
 *  @param {object} tile 滑动方块
 *  @param {number} r 方块当前行
 *  @param {number} c 方块当前列
 *  @param {number} nr 落点行
 *  @param {number} nc 落点列 */
function slideTile(tile, r, c, nr, nc) {
    grid[r][c] = null;
    grid[nr][nc] = tile;
    tile.r = nr;
    tile.c = nc;
}

/** 无效滑动撞墙演出（摇头 + 闷响）仅手动出招触发：连滑补发撞墙静默，防长按期间演出连击
 *  @param {boolean} announceBlock 是否播演出 */
function announceBlockedSlide(announceBlock) {
    if (!announceBlock) return;
    // 摇头提示：±3px 水平抖动强化"此路不通"（减弱动效时跳过）
    if (!FX.prefersReduced) headShake = HEAD_SHAKE_DUR;
    SFX.n1024Block(); // 无效滑动：低频闷响，撞墙反馈
}

/** 有效滑动的步末结算：HUD 收口 → 连击推进 → 统计/成就上报 → 多重合并演出 →
 *  撤销快照入栈 → 滑动音/补新块 → 胜负判定 → 常规续玩存档
 *  @param {string} dir 本次滑动方向（立体声按方向分配声道）
 *  @param {number[][]} prevBoard 本步之前的值矩阵快照
 *  @param {number} prevScore 本步之前的分数
 *  @param {number} prevCombo 本步之前的连击数
 *  @param {boolean} prevIsNewRecord 本步之前的新纪录标记
 *  @param {object} step 本步滑动累计状态（读取 mergesThisMove/winTriggered） */
function settleMove(dir, prevBoard, prevScore, prevCombo, prevIsNewRecord, step) {
    // 分数 HUD 收口：本步的合并加分与连击加成合并为一次 updateHud（一次数字滚动 + 一次跳动重播回流）
    if (step.mergesThisMove > 0) updateHud();

    // 连击推进：本步有合并连击 +1，无合并连击清零，并刷新 HUD
    if (step.mergesThisMove > 0) combo++;
    else combo = 0;
    if (combo >= 2) SFX.n1024Combo(combo); // 连击音：音高随档位递升
    updateComboHud();
    statMoves++; // 本局统计：有效滑动步数推进（须先于 checkRunAchievements 上报，否则步数成就少记一步）
    // 成就埋点：统一上报本局统计（分数/最大方块/合并次数/步数），刷新历史最佳并判定解锁；
    // 必须置于下方胜负结算 return 分支之前——胜利合成 1024 的路径同样能触发判定
    checkRunAchievements();
    // 成就埋点：跨局累计合并数累加（merges1000 以 best.mergesTotal 持久化累计值）
    trackCumulativeStat(step.mergesThisMove);
    // 一步多重合并演出：中央大字喝彩 + 强化震闪 + 华彩琶音（合并次数越多字样逐级升级）
    if (step.mergesThisMove >= 2) {
        const labels = ['DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'MEGA!'];
        // 喝彩大字落点按画布逻辑尺寸比例定位：水平 0.5（居中）、垂直 0.49，
        // 乘回 500×500 逻辑画布即旧硬编码 (250, 245)，像素完全一致视觉不变；
        // 后续画布尺寸若随 DPR/布局调整，比例定位仍保持居中与纵向位置稳定
        addFloatText(labels[Math.min(step.mergesThisMove - 2, labels.length - 1)],
            BOARD_W * 0.5, BOARD_H * 0.49, '#35e0ff', 20);
        shake = Math.max(shake, 3 + step.mergesThisMove);
        flash = { t: 0, dur: 0.35, color: '#35e0ff' };
        SFX.n1024Multi(step.mergesThisMove);
    }
    // 撤销快照入栈（保存本步之前的状态）并刷新撤销按钮可用态；附带三份统计镜像
    // （本步上方累加后的统计回推本步之前的值），撤销经 restoreBoard 精确回退本局
    // 步数/合并数与跨局累计合并数，杜绝「滑动→撤销→再滑」循环净增虚刷合并/步数成就
    history.push({
        board: prevBoard,
        score: prevScore,
        combo: prevCombo,
        isNewRecord: prevIsNewRecord,
        statMoves: statMoves - 1, // settleMove 开头已先行 statMoves++，此处回推一步
        statMerges: statMerges - step.mergesThisMove,
        mergesTotal: (Ach.getStore().best.mergesTotal || 0) - step.mergesThisMove, // trackCumulativeStat 已先行累加，回推本步增量
    });
    if (history.length > HISTORY_MAX) history.shift(); // 超限从队头丢弃最旧快照：内存栈与存档镜像共用同一上限，长局内存不再无界累积
    updateUndoHud();
    updateGoalHud(); // 合并可能抬升最大方块，同步推进目标进度条

    // 立体声定位：按滑动方向分配声道（左滑左响 / 右滑右响 / 上下居中）
    SFX.pan(dir === 'left' ? -0.4 : dir === 'right' ? 0.4 : 0);
    SFX.n1024Move();
    spawnTile(true);

    if (step.winTriggered) {
        finishWin();
        return;
    }
    updateDanger(); // 危险预警：空格告急时升档播警报音，驱动棋盘红色脉冲边框
    // 失败判定：棋盘填满且任意方向均无可合并
    if (!emptyCells().length && !canMergeAnywhere()) {
        finishGameOver();
        return;
    }
    saveSnapshot(); // 常规有效滑动：镜像当前局面到存档，随时退出页面都能续玩
}

/** 胜利收尾：短暂停顿展示局面后弹出胜利面板（本局首次合成 1024 触发） */
function finishWin() {
    hasWon = true;
    completeDailyChallenge(); // 每日挑战：首次达成 1024 时落盘当日标记并庆祝
    playing = false;
    // 胜利面板待决：对局节点已完成，清除进行中存档（契约规定仅对局进行中落盘；
    // 玩家「继续挑战」后的首次有效滑动会重新落盘，「重新开始」亦由 startGame 清档兜底）
    clearProgress();
    SFX.bgm.stop(); // 胜利演出期间静音 BGM，突出烟花与胜利号角（继续挑战时重新响起）
    SFX.n1024Win();
    spawnFireworks(); // 全屏三波烟花秀
    panelTimers.push(setTimeout(() => {
        winScoreEl.textContent = score;
        showOverlay(winScreen);
    }, 600)); // 拉长到 600ms，给烟花秀留足演出时间
}

/** 失败收尾：全盘熄灭渐暗演出，遮罩播完再弹结算面板（死局结算，撤销可救回） */
function finishGameOver() {
    playing = false;
    clearProgress(); // 死局终局：对局已完结，清除自动存档（下次进入从新局开始）
    SFX.bgm.stop(); // 终局静音 BGM，突出熄灭演出（结算面板下撤销救回时重新响起）
    SFX.n1024Fade(); // 熄灭演出伴奏：长下滑音（灯火渐暗的坠落感）
    deathFade = { t: 0, dur: DEATH_FADE_DUR }; // 全盘渐暗遮罩启动
    panelTimers.push(setTimeout(() => {
        SFX.n1024Over(); // 面板弹出时接失败琶音，与熄灭音错峰两段式
        showGameOver();
    }, 750)); // 等熄灭遮罩播完再出面板（熄灭音 0.7s 略短于遮罩 0.75s，收尾近似同步）
}

/* ---------- 成就系统 glue（存档/解锁/渲染/开合由共享库 ach-common.js 承担） ---------- */

/** 每步有效滑动后的本局统计上报：分数 / 最大方块 / 合并次数 / 步数一次跑完
 *  （Ach.trackRunStat 为 max 语义，只增不减、超越即落盘并连带解锁挂靠成就；
 *  置于 move 胜负结算分支之前调用，保证胜利路径同样触发）
 *  @returns {void} */
function checkRunAchievements() {
    Ach.trackRunStat('score', score);
    Ach.trackRunStat('maxTile', statMaxTile);
    Ach.trackRunStat('merges', statMerges);
    Ach.trackRunStat('moves', statMoves);
}

/** 累计型统计上报（跨局合并总数，merges1000 以 best.mergesTotal 持久化累计值）：
 *  共享库 trackRunStat 只认 max 语义，先读存档当前累计值叠加本局增量后上报，等效原 add 语义
 *  @param {number} delta 本次增量（非正数忽略）
 *  @returns {void} */
function trackCumulativeStat(delta) {
    if (delta <= 0) return;
    Ach.trackRunStat('mergesTotal', (Ach.getStore().best.mergesTotal || 0) + delta);
}

/* ---------- 特效系统 ---------- */

/** 在指定点爆发一圈像素粒子
 *  @param {number} px 爆点中心 X
 *  @param {number} py 爆点中心 Y
 *  @param {string} color 粒子颜色
 *  @param {number} count 粒子数量
 *  @param {number} speed 初始速度基准 */
function spawnBurst(px, py, color, count, speed) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const vel = speed * (0.4 + Math.random() * 0.8);
        const p = particlePool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = px;
        p.y = py;
        p.vx = Math.cos(angle) * vel;
        p.vy = Math.sin(angle) * vel;
        p.life = 0.5 + Math.random() * 0.3;
        p.maxLife = 0.8;
        p.color = color;
        p.size = 2 + Math.random() * 3;
    }
}

/** 添加一条向上飘散的文字（得分 / 连击奖励 / 里程碑共用）
 *  @param {string} text 文字内容（如 "+8" / "+3" / "128!"）
 *  @param {number} x 起点 X
 *  @param {number} y 起点 Y
 *  @param {string} [color] 文字颜色，默认金色
 *  @param {number} [size] 字号 px，默认 12 */
function addFloatText(text, x, y, color = '#ffd23e', size = 12) {
    floatTexts.push({ x, y, text, t: 0, color, size });
}

/** 在指定点生成一道向外扩散的冲击波圆环
 *  @param {number} px 圆环圆心 X
 *  @param {number} py 圆环圆心 Y
 *  @param {string} color 圆环颜色
 *  @param {number} [delay] 启动延迟（秒），用于双环错峰 */
function spawnRing(px, py, color, delay = 0) {
    rings.push({ x: px, y: py, t: -delay, dur: RING_DUR, color });
}

/** 全屏烟花秀：三波错峰绽放，每波随机位置爆发粒子 + 双冲击波 + 白闪 + 微震（达成 1024 胜利与里程碑 ≥2048 共用） */
function spawnFireworks() {
    const waves = [0, 240, 480];
    for (let w = 0; w < waves.length; w++) {
        panelTimers.push(setTimeout(() => {
            const x = 80 + Math.random() * 340; // 烟花中心随机散布在棋盘内
            const y = 70 + Math.random() * 275;
            const color = FIREWORK_COLORS[w % FIREWORK_COLORS.length];
            spawnBurst(x, y, color, 30, 280);
            spawnRing(x, y, color);
            spawnRing(x, y, color, 0.12);       // 第二道冲击波延迟错峰
            flash = { t: 0, dur: 0.3, color: '#ffffff' };
            shake = Math.max(shake, 3);
            SFX.n1024Firework();
        }, waves[w]));
    }
}

/** 初始化背景星尘：随机铺 AMBIENT_COUNT 颗缓慢漂移的装饰微光（纯表现层，不参与逻辑） */
function initAmbient() {
    for (let i = 0; i < AMBIENT_COUNT; i++) {
        ambient.push({
            x: Math.random() * 500,
            y: Math.random() * 500,
            vx: (Math.random() - 0.5) * 6,              // 水平漂移 ±3 px/s
            vy: (Math.random() - 0.5) * 6,              // 垂直漂移 ±3 px/s
            size: 1 + Math.random() * 2,                // 1~3 px 方形微粒
            phase: Math.random() * Math.PI * 2,         // 呼吸相位错峰
            color: Math.random() < 0.7 ? '#8fb2ff' : '#ffd9a0', // 70% 冷蓝 30% 暖金
        });
    }
}

/** 推进全部特效：幽灵滑行 / 粒子物理 / 飘字上浮 / 冲击波与拖尾寿命 / 星尘漂移 / 震动衰减 / 闪光推进
 *  @param {number} dt 帧间隔（秒） */
function updateEffects(dt) {
    // 幽灵残影：到滑动时长即移除
    for (let i = ghosts.length - 1; i >= 0; i--) {
        ghosts[i].t += dt;
        if (ghosts[i].t >= SLIDE_DUR) ghosts.splice(i, 1);
    }
    // 粒子：位移 + 摩擦减速（池活跃区正向遍历，sweep 回收死粒零分配）
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.life -= dt;
    }
    particlePool.sweep();
    // 飘字：匀速上浮，飘完移除
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const f = floatTexts[i];
        f.t += dt;
        f.y -= 40 * dt;
        if (f.t >= FLOAT_DUR) floatTexts.splice(i, 1);
    }
    // 冲击波圆环：推进寿命（t<0 为延迟未启动），超时移除
    for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].t += dt;
        if (rings[i].t >= rings[i].dur) rings.splice(i, 1);
    }
    // 滑动拖尾：推进寿命，超时移除
    for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].t += dt;
        if (trails[i].t >= TRAIL_DUR) trails.splice(i, 1);
    }
    // 背景星尘：缓慢漂移，越界从对侧回绕（±4 缓冲覆盖微粒自身尺寸）
    for (const a of ambient) {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        if (a.x < -4) a.x = 504; else if (a.x > 504) a.x = -4;
        if (a.y < -4) a.y = 504; else if (a.y > 504) a.y = -4;
    }
    // 屏幕震动线性衰减
    if (shake > 0) shake = Math.max(0, shake - 24 * dt);
    // 无效滑动摇头衰减
    if (headShake > 0) headShake = Math.max(0, headShake - dt);
    // 全屏闪光推进，播完清空
    if (flash) {
        flash.t += dt;
        if (flash.t >= flash.dur) flash = null;
    }
    // 死局熄灭遮罩推进：播完停在末帧保持全暗（面板覆盖前维持熄灭氛围，撤销/重开时复位）
    if (deathFade) {
        deathFade.t = Math.min(deathFade.dur, deathFade.t + dt);
    }
}

/* ---------- 渲染 ---------- */

/** 绘制单个方块本体（供实体块与幽灵残影复用）
 *  @param {number} value 方块数值
 *  @param {number} x 左上角 X
 *  @param {number} y 左上角 Y
 *  @param {number} scale 以中心为基准的缩放（pop 动画）
 *  @param {number} alpha 透明度（幽灵渐隐用） */
function drawTileBody(value, x, y, scale, alpha) {
    const style = getTileStyle(value);
    ctx.save();
    ctx.globalAlpha = alpha;
    // 平移到方块中心，便于按中心缩放
    ctx.translate(x + CELL / 2, y + CELL / 2);
    ctx.scale(scale, scale);
    // 高阶方块金色呼吸辉光
    if (style.glow) {
        ctx.shadowColor = style.bg;
        ctx.shadowBlur = 14 + Math.sin(time * 4) * 6;
    }
    ctx.fillStyle = style.bg;
    roundRect(ctx, -CELL / 2, -CELL / 2, CELL, CELL, 12);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 顶部高光条：模拟上方打光，让方块呈现浮起的立体感
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    roundRect(ctx, -CELL / 2 + CELL * 0.06, -CELL / 2 + CELL * 0.06, CELL * 0.88, CELL * 0.12, CELL * 0.06);
    ctx.fill();
    // 底部暗边：加深下缘，与高光形成厚度对比
    ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
    roundRect(ctx, -CELL / 2 + CELL * 0.06, CELL / 2 - CELL * 0.16, CELL * 0.88, CELL * 0.10, CELL * 0.05);
    ctx.fill();
    // 内描边：细腻亮边勾出轮廓
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, -CELL / 2 + 1.5, -CELL / 2 + 1.5, CELL - 3, CELL - 3, 10.5);
    ctx.stroke();

    // 数字按位数自适应字号，并随棋盘尺寸等比缩放（110 为 4×4 标准单元格边长）
    const text = String(value);
    const fs = CELL / 110;
    const fontSize = (text.length <= 2 ? 40 : (text.length === 3 ? 30 : 22)) * fs;
    ctx.font = fontSize + "px 'Press Start 2P', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 先画深色下沉阴影再画本体，制造数字浮雕感（偏移随棋盘尺寸等比）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillText(text, 0, 4 + Math.max(2, CELL * 0.025));
    ctx.fillStyle = style.fg;
    ctx.fillText(text, 0, 4);
    ctx.restore();
}

/* ---------- 空槽静态层离屏缓存：SIZE×SIZE 个空槽仅在脏标记置位时重绘一次 ---------- */

/** 空槽静态层离屏画布（物理分辨率与主画布保持一致） */
const slotLayerCanvas = document.createElement('canvas');
/** 空槽静态层绘制上下文 */
const slotLayerCtx = slotLayerCanvas.getContext('2d');
/** 空槽静态层脏标记：true 时下一帧重建（DPR 适配 / 难度切换改变 SIZE 与 CELL 时置位） */
let slotLayerDirty = true;

/**
 * 将全部空槽渲染到离屏层：深底色 + 凹陷内描边的圆角槽位。
 * 背景星尘（动态呼吸）位于空槽之下，保留每帧绘制；空槽几何纯静态，
 * 原先每帧 SIZE×SIZE 次 roundRect+fill+stroke，现每帧只剩 1 次 drawImage 贴回
 */
function renderSlotLayer() {
    const view = FX.dims(canvas); // 读主画布 dpr：离屏层与主画布共用同一逻辑坐标系
    slotLayerCanvas.width = canvas.width; // 物理分辨率与主画布对齐（1:1 贴回不缩放）
    slotLayerCanvas.height = canvas.height;
    slotLayerCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // 锁 CSS 逻辑坐标，绘制代码零换算
    slotLayerCtx.clearRect(0, 0, BOARD_W, BOARD_H);
    slotLayerCtx.fillStyle = '#161f36';
    slotLayerCtx.strokeStyle = 'rgba(90, 130, 210, 0.15)';
    slotLayerCtx.lineWidth = 1.5;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            roundRect(slotLayerCtx, cellX(c), cellY(r), CELL, CELL, 12);
            slotLayerCtx.fill();
            slotLayerCtx.stroke();
        }
    }
}

/** 整帧绘制：震动包裹 → 星尘 → 空槽（静态层贴回） → 拖尾 → 幽灵 → 实体 → 粒子 → 冲击波 → 飘字 → 闪光 → 危险红框 → 死局熄灭遮罩 */
function draw() {
    ctx.save();
    // 屏幕微震：整体随机偏移（画布 CSS 底色与棋盘底色一致，震动露边不可见）
    if (shake > 0.2) {
        ctx.translate((Math.random() - 0.5) * 2 * shake, (Math.random() - 0.5) * 2 * shake);
    }
    // 无效滑动摇头：±3px 水平正弦抖动，幅度随剩余时长衰减（"此路不通"的物理反馈）
    if (headShake > 0) {
        const p = headShake / HEAD_SHAKE_DUR;
        ctx.translate(Math.sin(p * Math.PI * 5) * 3 * p, 0);
    }

    // 画布底色
    ctx.fillStyle = '#1a140f';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // 背景星尘：最底层呼吸闪烁的漂浮微光
    for (const a of ambient) {
        ctx.globalAlpha = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(time * 1.6 + a.phase));
        ctx.fillStyle = a.color;
        ctx.fillRect(a.x, a.y, a.size, a.size);
    }
    ctx.globalAlpha = 1;

    // 空槽网格：脏标记置位时重建一次，之后每帧仅一次 drawImage 贴回
    if (slotLayerDirty) {
        renderSlotLayer();
        slotLayerDirty = false;
    }
    ctx.drawImage(slotLayerCanvas, 0, 0, BOARD_W, BOARD_H);

    // 滑动拖尾：仅画渐隐底色圆角矩形（无数字），垫在幽灵与实体之下
    for (const tr of trails) {
        ctx.globalAlpha = (1 - tr.t / TRAIL_DUR) * 0.35;
        ctx.fillStyle = getTileStyle(tr.value).bg;
        roundRect(ctx, tr.x, tr.y, CELL, CELL, 12);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 幽灵残影：线性插值滑向合并点并渐隐（画在实体块下层）
    for (const g of ghosts) {
        const p = Math.min(1, g.t / SLIDE_DUR);
        const gx = g.x + (g.tx - g.x) * p;
        const gy = g.y + (g.ty - g.y) * p;
        drawTileBody(g.value, gx, gy, 1, 0.8 - p * 0.55);
    }

    // 实体方块：坐标按时间校正的指数趋近逻辑格（不同刷新率下滑速一致），pop 期间按缓动缩放
    const k = 1 - Math.exp(-LERP_RATE * lastDt);
    for (const tile of tiles.values()) {
        const tx = cellX(tile.c), ty = cellY(tile.r);
        // 滑动途中沿途留下一串渐隐拖尾（静止时位移趋零不会触发）
        if (Math.abs(tx - tile.x) + Math.abs(ty - tile.y) > 4) {
            trails.push({ value: tile.value, x: tile.x, y: tile.y, t: 0 });
            // 高值方块（≥128）滑动时沿途洒落同色发光微粒，强化"重块"的存在感
            if (tile.value >= 128) {
                const p = particlePool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
                p.x = tile.x + Math.random() * CELL;
                p.y = tile.y + Math.random() * CELL;
                p.vx = (Math.random() - 0.5) * 30;
                p.vy = (Math.random() - 0.5) * 30;
                p.life = p.maxLife = 0.35;
                p.color = getTileStyle(tile.value).bg;
                p.size = 2;
            }
        }
        tile.x += (tx - tile.x) * k;
        tile.y += (ty - tile.y) * k;
        let scale = 1;
        if (tile.popDelay > 0) {
            tile.popDelay -= lastDt;   // 延迟期内不显示，等幽灵滑到位
            scale = 0;
        } else if (tile.pop < POP_DUR) {
            tile.pop = Math.min(POP_DUR, tile.pop + lastDt);
            scale = easeOutBack(tile.pop / POP_DUR);
        }
        if (scale > 0) drawTileBody(tile.value, tile.x, tile.y, scale, 1);
    }

    // 像素粒子（池活跃区遍历）
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // 冲击波圆环：easeOutCubic 扩散描边圆，渐隐收尾
    for (const ring of rings) {
        if (ring.t < 0) continue; // 延迟环未启动
        const p = Math.min(1, ring.t / ring.dur);
        const e = 1 - Math.pow(1 - p, 3);
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 3 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, CELL * 0.85 * e + 6, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 得分飘字（字号随类型不同：得分 12 / 连击奖励 10 / 里程碑 16 / 纪录庆祝 18 / 多重合并演出 20）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floatTexts) {
        ctx.globalAlpha = Math.max(0, 1 - f.t / FLOAT_DUR);
        ctx.font = f.size + "px 'Press Start 2P', monospace";
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // 全屏闪光：覆盖一层渐隐色块（其上还有危险红框与熄灭遮罩两层）
    if (flash) {
        ctx.globalAlpha = (1 - flash.t / flash.dur) * 0.22;
        ctx.fillStyle = flash.color;
        ctx.fillRect(0, 0, BOARD_W, BOARD_H);
        ctx.globalAlpha = 1;
    }

    // 危险预警：空格告急时棋盘边缘红色脉冲描边（危急级脉冲更急促醒目）
    if (dangerLevel > 0) {
        const crit = dangerLevel >= 2;
        const pulse = 0.5 + 0.5 * Math.sin(time * (crit ? 9 : 5));
        ctx.globalAlpha = (crit ? 0.55 : 0.3) * (0.35 + 0.65 * pulse);
        ctx.strokeStyle = '#ff4040';
        ctx.lineWidth = 6;
        roundRect(ctx, 3, 3, BOARD_W - 6, BOARD_H - 6, 14);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // 死局熄灭：最顶层全盘渐暗遮罩（失败演出：灯火缓缓熄灭后再弹出结算面板）
    if (deathFade) {
        const p = Math.min(1, deathFade.t / deathFade.dur);
        ctx.globalAlpha = p * 0.78;
        ctx.fillStyle = '#05070d';
        ctx.fillRect(0, 0, BOARD_W, BOARD_H);
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

/* ---------- 交互与流程 ---------- */

/** 刷新 HUD 分数与最高分显示，并让分数触发一次跳动动画 */
function updateHud() {
    FX.tweenNumber(scoreEl, score, 128); // 分数数字滚动过渡（128ms 快速插值）
    bestEl.textContent = best;
    // 「每日挑战」徽章可见性跟随模式：每日局点亮，普通局/续玩局隐藏
    if (dailyBadgeEl) dailyBadgeEl.hidden = !dailyMode;
    // 强制回流后重挂动画类，保证连续得分时跳动也能逐次重播
    scoreEl.classList.remove('score-pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('score-pop');
}

/** 刷新连击 HUD：连击常显，×2 起点亮粉色发光，×3 起画布边框泛光 */
function updateComboHud() {
    comboEl.textContent = '×' + combo;
    comboEl.classList.toggle('combo-lit', combo >= 2);
    // 连击 ≥3：切换画布边框粉色泛光 CSS 类（连击断掉自动回落）
    canvas.classList.toggle('combo-fire', combo >= 3);
    // 连击 ≥5：升级金色炽燃泛光（优先级高于粉色，呈现白热化连击）
    canvas.classList.toggle('combo-blaze', combo >= 5);
}

/** 刷新撤销按钮：显示剩余次数与快捷键标注，无快照或次数用尽时禁用 */
function updateUndoHud() {
    undoBtn.textContent = 'UNDO ×' + undosLeft + ' (Z)';
    undoBtn.disabled = undosLeft <= 0 || !history.length;
}

/** 刷新 1024 目标进度条：以当前棋盘最大方块按 log2 比例填充，达成目标后显示 MAX 标记 */
function updateGoalHud() {
    let maxVal = 0;
    for (const t of tiles.values()) {
        if (t.value > maxVal) maxVal = t.value; // 扫描当前棋盘最大方块
    }
    if (maxVal < 2) maxVal = 2; // 起步方块 2 对应 0% 进度
    // log2 进度曲线：2→0%、1024→100%，与合并难度增长节奏一致
    const pct = Math.min(100, (Math.log2(maxVal) - 1) / (Math.log2(WIN_VALUE) - 1) * 100);
    goalFillEl.style.width = pct + '%';
    goalFillEl.classList.toggle('goal-done', maxVal >= WIN_VALUE);
    goalTextEl.textContent = maxVal >= WIN_VALUE ? 'MAX ' + maxVal + ' ★' : Math.floor(pct) + '%';
}

/** 刷新危险预警等级：按空格余量分档（满盘或仅剩 1 格为危急），升档瞬间播警报音。
 *  降档（撤销/回溯）静默处理，不打扰回溯节奏
 *  @param {boolean} [silent] 静默模式：只同步等级不播音（撤销重建/读档恢复时用） */
function updateDanger(silent) {
    const emptyCount = emptyCells().length;
    // 分档：≤1 格或满盘 → 危急；仅剩 2 格 → 预警；其余安全
    const level = emptyCount <= 1 ? 2 : (emptyCount === 2 ? 1 : 0);
    if (!silent && level > dangerLevel) SFX.n1024Danger(level); // 危机加深才报警
    dangerLevel = level;
}

/** 统一口径判断当前是否可执行玩家动作：非暂停且成就墙关闭；
 *  对局态（playing）与动作特有前置条件由各调用点按自身语义自行叠加 */
function canAct() {
    return !isPaused && !Ach.isOpen();
}

/** 执行一次撤销：弹出最近快照重建棋盘；结束/胜利面板下也可救回 */
function doUndo() {
    // 暂停 / 成就墙打开时禁止撤销（对齐其他游戏暂停锁操作）；无快照 / 次数用尽时忽略
    // （开局前 history 必为空，天然屏蔽未开始状态）
    if (!canAct() || !history.length || undosLeft <= 0) return;
    const snap = history.pop();
    undosLeft--;
    restoreBoard(snap);
    clearPanelTimers(); // 面板下撤销救回：清掉尚未到点的面板定时器，防止救回后旧定时器到点把面板再弹出来
    // 若正处于胜利/结束面板，撤回后关闭面板继续对局
    hideOverlay(winScreen);
    hideOverlay(gameOverScreen);
    playing = true;
    SFX.bgm.start('n1024'); // 面板下撤销救回：终局演出时 BGM 已停，重新响起（同名幂等）
    saveSnapshot(); // 撤销同样落盘：存档与棋面/撤销余量始终保持一致
    flash = { t: 0, dur: 0.3, color: '#35e0ff' }; // 青色回溯闪光：时间倒流的视觉脉冲
    SFX.n1024Undo(); // 两段下滑回溯音，时光倒流质感
}

/** 依据快照重建棋盘（撤销/存档恢复共用）：按值矩阵重建方块并恢复分数、连击与新纪录标记；
 *  撤销快照附带的统计镜像字段存在时一并回退本局步数/合并数与跨局累计合并数，
 *  存档恢复路径缺省跳过（其统计由 apply1024Snapshot 按存档字段另行恢复）
 *  @param {{board: number[][], score: number, combo: number, isNewRecord?: boolean,
 *           statMoves?: number, statMerges?: number, mergesTotal?: number}} snap 撤销快照 */
function restoreBoard(snap) {
    tiles.clear();
    ghosts.length = 0;
    particlePool.clear(); // 归还全部粒子（池对象保留复用）
    floatTexts.length = 0;
    rings.length = 0;   // 清空冲击波
    trails.length = 0;  // 清空拖尾
    shake = 0;          // 复位震动
    flash = null;       // 复位闪光
    deathFade = null;   // 复位熄灭演出（死局面板下撤销可救回点亮棋盘）
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const value = snap.board[r][c];
            if (!value) continue;
            const tile = {
                id: nextId++,
                value,
                r,
                c,
                x: cellX(c),   // 瞬间落位，靠 pop 弹出表现回溯登场
                y: cellY(r),
                popDelay: 0,
                pop: 0,
            };
            grid[r][c] = tile;
            tiles.set(tile.id, tile);
        }
    }
    score = snap.score;
    combo = snap.combo;
    isNewRecord = snap.isNewRecord === true; // 新纪录标记随回退同步：旧格式快照缺字段时按 false 保守处理
    // 统计镜像回退（仅撤销快照附带字段时）：存档恢复路径构造的快照无这些字段，
    // 保持当前值不动（其统计由 apply1024Snapshot 按存档字段另行恢复）；累计合并数
    // 差额经共享库 adjustBest 回写 best（钳制不低于 0，防抖落盘与正向推进同一通道）
    if (Number.isInteger(snap.statMoves)) statMoves = Math.max(0, snap.statMoves);
    if (Number.isInteger(snap.statMerges)) statMerges = Math.max(0, snap.statMerges);
    if (Number.isInteger(snap.mergesTotal)) {
        Ach.adjustBest('mergesTotal', snap.mergesTotal - (Ach.getStore().best.mergesTotal || 0));
    }
    updateHud();
    updateComboHud();
    updateUndoHud();
    updateGoalHud();
    updateDanger(true); // 同步危险等级（撤销回溯只会降档，静默不播音）
    refreshMaxTile(); // 同步本局最大方块统计（快照重建后重扫棋面）
}

/** 校验值矩阵结构（存档恢复专用）：SIZE×SIZE 且每格为 0 或 ≥2 的 2 的幂整数
 *  @param {*} board 待校验矩阵
 *  @returns {boolean} 是否为合法棋面矩阵 */
function isValidBoard(board) {
    if (!Array.isArray(board) || board.length !== SIZE) return false;
    for (let r = 0; r < SIZE; r++) {
        const row = board[r];
        if (!Array.isArray(row) || row.length !== SIZE) return false;
        for (let c = 0; c < SIZE; c++) {
            const v = row[c];
            if (v === 0) continue; // 空格合法
            // 非零值必须是 2 的幂整数（(v & (v-1)) === 0 为幂判据），挡住篡改/损坏数据
            if (!Number.isInteger(v) || v < 2 || (v & (v - 1)) !== 0) return false;
        }
    }
    return true;
}

/**
 * 将当前对局进度组装为纯数据快照对象（快照字段说明见 saveSnapshot 注释）：
 * 仅含数值 / 字符串 / 嵌套数组，不含任何函数与 DOM 引用，可安全 JSON 序列化；
 * v 必须是对象首个字段（JSON.stringify 按插入顺序输出，恢复端据此先校验版本）
 * @returns {object} 纯数据进度快照
 */
function build1024Snapshot() {
    return {
        v: 1,                                                        // 结构版本号（契约固定首字段）
        diff: currentDifficulty,                                     // 存档与难度绑定（棋盘尺寸不同）
        board: grid.map((row) => row.map((t) => (t ? t.value : 0))), // 棋面值矩阵（0 或 2 的幂）
        score,                                                       // 当前分数
        combo,                                                       // 当前连击步数
        undosLeft,                                                   // 剩余撤销次数
        hasWon,                                                      // 是否已达成过 1024
        isNewRecord,                                                 // 本局是否刷新过最高分
        milestones: Array.from(milestones),                          // 已触发里程碑集合（Set 序列化为数组）
        daily: dailyMode,                                            // 本局是否每日挑战（续玩时按日期校验，见 apply1024Snapshot）
        dailyDate: dailyMode ? dailyDateKey : null,                  // 每日挑战开局归属日期（进入每日模式时缓存，非每日局为 null）
        statMoves,                                                   // 本局有效滑动步数（宽容缺省按 0，旧格式兼容）
        statMerges,                                                  // 本局合并次数（宽容缺省按 0，旧格式兼容）
        statTime,                                                    // 本局累计游玩秒数（宽容缺省按 0，旧格式兼容）
        // 撤销栈镜像：只保留最近 HISTORY_MAX 步（slice 负索引从尾部截取），与内存栈及恢复端上限一致
        // 镜像项同步携带统计回退字段（statMoves/statMerges/mergesTotal，settleMove push 时附带）：
        // 序列化丢弃会让续玩后首次撤销弹出无镜像快照，跨会话「存档→刷新→撤销→再滑」仍可虚刷
        // 累计统计；旧格式快照缺这三字段时恢复端按宽容缺省跳过回退（Number.isInteger 守卫）
        history: history.slice(-HISTORY_MAX).map((h) => ({
            board: h.board, score: h.score, combo: h.combo, isNewRecord: h.isNewRecord === true,
            statMoves: h.statMoves, statMerges: h.statMerges, mergesTotal: h.mergesTotal
        })),
    };
}

// 存取管线由共享库 snap-common.js 驱动：游戏进行中（含暂停中）写入镜像，
// 处于开始界面 / 胜利面板 / 死局结算等非进行中状态时转为清除快照（快照只服务于未打完的局）；
// 组装意外与存储不可用（隐私模式 / 配额满）由管线整体 try/catch 静默，不影响游戏本体
const snapPipe = Snap.create({
    key: KEYS.save,
    canSave: () => playing,
    build: build1024Snapshot,
    validate: validate1024Snapshot,
    apply: apply1024Snapshot
});

/**
 * 将当前对局进度镜像为纯数据快照写入 localStorage（键 arcade_save_1024，街机厅统一契约）：
 * 仅在「对局进行中（含暂停中）」时写入；开始界面 / 胜利面板 / 死局结算等非进行中状态
 * 一律转为清除存档（快照只服务于未打完的局）。整体 try/catch 静默处理，
 * 存储不可用（隐私模式 / 配额满）等异常不影响游戏本体。
 * 触发时机：每步有效滑动 / 撤销后（局内主动落盘），以及父页 arcade:save 消息、
 * pagehide 页面卸载两处兜底（接线见文件尾部 Snap.bindAutoSave）。
 * 快照字段（首字段固定结构版本号 v，恢复时不匹配立即视为无效）：
 *   v           快照格式版本，恒为 1
 *   diff        难度键名（easy / normal / hard，棋盘尺寸与存档绑定）
 *   board       SIZE×SIZE 值矩阵（每格为 0 或 2 的幂）
 *   score       当前分数
 *   combo       当前连击步数
 *   undosLeft   剩余撤销次数
 *   hasWon      是否已达成过 1024（恢复后不再重复触发胜利演出）
 *   isNewRecord 本局是否刷新过最高分（结算面板「新纪录」标记用）
 *   milestones  已触发里程碑档位数组
 *   statMoves / statMerges / statTime  本局统计（步数 / 合并次数 / 累计秒数，旧格式缺省按 0）
 *   history     撤销栈镜像（仅保留最近 HISTORY_MAX 步，防止极端长局存档膨胀）
 * @returns {void}
 */
function saveSnapshot() {
    snapPipe.save();
}

/**
 * 清除对局进度快照存档：玩家重开新局 / 切换难度放弃旧档 / 胜利面板待决 /
 * 棋盘死局终局时调用，避免下次打开页面误续玩一局已被废弃的对局
 * @returns {void}
 */
function clearProgress() {
    snapPipe.clear(); // 存储受限时同样静默跳过
}

/**
 * 校验进度快照结构合法性（供共享库 Snap.restore 管线调用）：逐字段检查
 * 结构版本号（v !== 1 立即视为无效）、难度归属、棋面矩阵（SIZE×SIZE 且
 * 每格为 0 或 2 的幂）、分数/连击为非负整数、剩余撤销次数范围、
 * hasWon/isNewRecord 布尔类型、棋面至少一个方块、撤销栈逐条结构
 * （超长截断至最近 HISTORY_MAX 步）。里程碑为纯表现层标记，宽容处理不参与失效判定；
 * 本局统计字段（statMoves/statMerges/statTime）同样宽容缺省，存在时须为非负值。
 * @param {*} snap 待校验快照对象
 * @returns {boolean} 快照合法返回 true；任一校验失败返回 false（存档由管线统一清除）
 */
function validate1024Snapshot(snap) {
    if (!snap || typeof snap !== 'object' || snap.v !== 1) return false; // 结构版本号不匹配（损坏 / 被篡改 / 未来格式）
    if (snap.diff !== currentDifficulty) return false; // 属于其他难度的对局
    if (!isValidBoard(snap.board)) return false;       // 棋面矩阵非法（尺寸 / 非幂值）
    if (!Number.isInteger(snap.score) || snap.score < 0) return false;   // 分数须为非负整数
    if (!Number.isInteger(snap.combo) || snap.combo < 0) return false;   // 连击须为非负整数
    if (!Number.isInteger(snap.undosLeft) || snap.undosLeft < 0 || snap.undosLeft > UNDO_LIMITS[currentDifficulty]) return false;
    if (typeof snap.hasWon !== 'boolean' || typeof snap.isNewRecord !== 'boolean') return false;
    // 每日挑战标记宽容校验（旧格式快照可缺省）：存在时 daily 须为布尔、dailyDate 须为 8 位日期串或 null
    if (snap.daily !== undefined && typeof snap.daily !== 'boolean') return false;
    if (snap.dailyDate !== undefined && snap.dailyDate !== null && !/^\d{8}$/.test(snap.dailyDate)) return false;
    // 本局统计宽容缺省（旧格式快照可缺省）：存在时须为非负数（步数/合并次数为整数，累计秒数可为小数）
    if (snap.statMoves !== undefined && (!Number.isInteger(snap.statMoves) || snap.statMoves < 0)) return false;
    if (snap.statMerges !== undefined && (!Number.isInteger(snap.statMerges) || snap.statMerges < 0)) return false;
    if (snap.statTime !== undefined && (!Number.isFinite(snap.statTime) || snap.statTime < 0)) return false;
    // 棋面上至少要有一个方块（空棋面必为损坏数据）
    let tileCount = 0;
    for (const row of snap.board) for (const v of row) if (v) tileCount++;
    if (!tileCount) return false;
    // 撤销栈校验：超长镜像先截断至最近 HISTORY_MAX 步（与保存端上限一致），再逐条检查结构与取值
    const historySaved = Array.isArray(snap.history) ? snap.history.slice(-HISTORY_MAX) : [];
    for (const h of historySaved) {
        if (!h || typeof h !== 'object' || !isValidBoard(h.board)) return false;
        if (!Number.isInteger(h.score) || h.score < 0) return false;
        if (!Number.isInteger(h.combo) || h.combo < 0) return false;
        if (h.isNewRecord !== undefined && typeof h.isNewRecord !== 'boolean') return false; // 新纪录标记宽容缺省（旧格式）
    }
    return true;
}

/**
 * 将合法快照应用为续玩状态（供共享库 Snap.restore 管线调用）：按快照重建
 * 棋面 / 分数 / 连击 / 撤销栈 / 本局统计并收起开始面板直接续玩（恢复后直接可操作，
 * 无需等待确认），并在操作提示行展示「已恢复上次进度」标记。
 * @param {object} snap 已通过 validate1024Snapshot 校验的快照对象
 * @returns {boolean} 应用成功返回 true
 */
function apply1024Snapshot(snap) {
    // 撤销栈镜像截断至最近 HISTORY_MAX 步（与保存端 / 校验端 / 内存栈上限一致）
    const historySaved = Array.isArray(snap.history) ? snap.history.slice(-HISTORY_MAX) : [];
    // 里程碑仅保留合法档位值（纯表现层标记，宽容处理不判存档失效）
    const milestoneSaved = Array.isArray(snap.milestones)
        ? snap.milestones.filter((m) => MILESTONE_VALUES.indexOf(m) !== -1)
        : [];
    // 每日挑战续玩校验（置于 restoreBoard 前：其内部 updateHud 按 dailyMode 刷新徽章）：
    // 仅当日开局的每日挑战继续每日身份（且当日未达成时），昨日及更早的每日存档降级为
    // 普通局续玩——完成不再计入当日达成（每日挑战当日有效，次日重新开局）
    const dailySameDay = snap.daily === true && snap.dailyDate === todayDailyDate();
    dailyMode = dailySameDay && !Arcade.loadRaw(dailyKey()); // 存储不可用时视为未达成
    if (dailyMode) {
        dailyDateKey = snap.dailyDate; // 同步归属日缓存：达成落盘与续存快照保持开局日口径
        // 种子重建但不回放历史已消耗的次数：续玩局的后续新块序列与同日不间断新开局
        // 不同，属预期——确定性承诺仅覆盖「同一天的新开局彼此一致」，续玩局不保证
        dailyRng = mulberry32(dateSeed(snap.dailyDate));
    }
    // 复用撤销重建逻辑应用棋面/分数/连击/新纪录标记，再补齐存档专属状态
    restoreBoard({ board: snap.board, score: snap.score, combo: snap.combo, isNewRecord: snap.isNewRecord });
    history.length = 0;
    // 镜像项原样回拷（含统计回退字段；旧格式快照缺省为 undefined，restoreBoard 的宽容守卫会跳过）
    for (const h of historySaved) history.push({
        board: h.board, score: h.score, combo: h.combo, isNewRecord: h.isNewRecord === true,
        statMoves: h.statMoves, statMerges: h.statMerges, mergesTotal: h.mergesTotal
    });
    undosLeft = snap.undosLeft;
    hasWon = snap.hasWon;
    milestones = new Set(milestoneSaved);
    statMoves = Number.isInteger(snap.statMoves) && snap.statMoves >= 0 ? snap.statMoves : 0; // 旧格式缺省按 0
    statMerges = Number.isInteger(snap.statMerges) && snap.statMerges >= 0 ? snap.statMerges : 0;
    statTime = Number.isFinite(snap.statTime) && snap.statTime >= 0 ? snap.statTime : 0;
    updateUndoHud(); // restoreBoard 执行时 undosLeft 尚未恢复，此处补刷撤销按钮态
    playing = true;
    SFX.bgm.start('n1024'); // 续玩存档：BGM 跟随恢复（AudioContext 未激活时挂起等待，首次手势后自动补启）
    hideOverlay(startScreen); // 有进度可续：直接收起开始面板进入对局
    // 恢复成功提示：画布下方操作提示行追加「已恢复上次进度」小字（重开后由 startGame 撤下）
    if (restoreNote) restoreNote.style.display = 'inline';
    return true;
}

/**
 * 从 localStorage 读取进度快照并恢复续玩状态（键 arcade_save_1024，街机厅统一契约）。
 * 骨架（读取 / 校验 / 应用 / 任一环节失败清档 / 异常兜底）由共享库 snap-common.js
 * 统一收口，校验与应用细节见 validate1024Snapshot / apply1024Snapshot；
 * 无存档或快照非法时调用方回退默认新开局流程。
 * @returns {boolean} 快照合法并已恢复返回 true；无快照或快照非法返回 false
 */
function restoreSnapshot() {
    return snapPipe.restore();
}

/** 显示指定遮罩面板：同步维护面板状态源，DOM 显示为单向输出
 *  @param {HTMLElement} el 遮罩元素 */
function showOverlay(el) {
    visiblePanel = el;
    el.style.display = 'block';
}

/** 隐藏指定遮罩面板：状态源正指向该面板时复位，其余面板不受影响
 *  @param {HTMLElement} el 遮罩元素 */
function hideOverlay(el) {
    if (visiblePanel === el) visiblePanel = null;
    el.style.display = 'none';
}

/** 将本局用时秒数格式化为 mm:ss 文本
 *  @param {number} seconds 用时秒数
 *  @returns {string} mm:ss 格式字符串（不足两位补零） */
function formatRunTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** 填充结算面板统计区：步数 / 合并次数 / 最大方块 / 用时（仅本局数据，不持久化）
 *  @returns {void} */
function fillRunStats() {
    statMovesEl.textContent = String(statMoves);
    statMergesEl.textContent = String(statMerges);
    statMaxTileEl.textContent = String(statMaxTile);
    statTimeEl.textContent = formatRunTime(statTime);
}

/** 显示结算面板：填充最终分数、新纪录标记与本局统计 */
function showGameOver() {
    finalScoreEl.textContent = score;
    newRecordEl.style.display = isNewRecord ? 'block' : 'none';
    if (isNewRecord) {
        FX.recordBurst(); // 破纪录结算：全屏金色烟花彩带（fx.js 自包含覆盖层，减弱动效时内部跳过）
        SFX.n1024Record();
    }
    fillRunStats(); // 填充本局统计四项
    showOverlay(gameOverScreen);
}

/** 重置棋盘与状态，铺两块初始方块（不播生成音） */
function resetBoard() {
    tiles.clear();
    ghosts.length = 0;
    particlePool.clear(); // 归还全部粒子（池对象保留复用）
    floatTexts.length = 0;
    rings.length = 0;   // 清空冲击波
    trails.length = 0;  // 清空拖尾
    shake = 0;          // 复位震动
    flash = null;       // 复位闪光
    deathFade = null;   // 复位熄灭演出
    grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    nextId = 1;
    score = 0;
    hasWon = false;
    isNewRecord = false;
    history.length = 0;                          // 清空撤销栈
    undosLeft = UNDO_LIMITS[currentDifficulty];  // 撤销次数随难度重置
    combo = 0;                                   // 连击清零
    milestones.clear();                          // 里程碑每局重新计数
    dangerLevel = 0;                             // 危险预警清零
    celebratedRecord = false;                    // 纪录庆祝每局只此一次
    statMoves = 0;                               // 本局统计清零：步数
    statMerges = 0;                              // 本局统计清零：合并次数
    statTime = 0;                                // 本局统计清零：用时
    headShake = 0;                               // 复位无效滑动摇头
    Ach.close();                                 // 新局不保留旧成就墙态（共享库内幂等，含 hidden 还原）
    spawnTile(false);
    spawnTile(false);
    refreshMaxTile();                            // 同步本局最大方块统计（起步两块为 2 或 4）
    updateHud();
    updateComboHud();
    updateUndoHud();
    updateGoalHud();
}

/** 清除胜利/失败面板及烟花演出相关延迟定时器：面板提前关闭（重开/撤销救回）时调用，防止旧定时器到点操作已失效的面板 DOM
 *  @returns {void} */
function clearPanelTimers() {
    for (const t of panelTimers) clearTimeout(t);
    panelTimers = [];
}

/** 开始新一局：隐藏全部遮罩并重开棋盘 */
function startGame() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // 移除按钮焦点，防止空格/回车误触按钮
    clearPanelTimers(); // 重开新局：清掉上一局尚未到点的面板/烟花定时器，防止旧定时器到点操作已失效的面板 DOM
    hideOverlay(startScreen);
    hideOverlay(winScreen);
    hideOverlay(gameOverScreen);
    hideOverlay(pauseScreen);
    isPaused = false; // 对局中 R 重开可能处于暂停态，新局必须复位
    setupDailyChallenge(); // 每日挑战：当日未达成则本局以日期种子固定方块序列（同日同谜题）
    resetBoard();
    clearProgress(); // 新局开始（玩家主动重开 / 结算面板重开）：旧对局存档废弃，首步滑动后重新落盘
    if (restoreNote) restoreNote.style.display = 'none'; // 撤下「已恢复上次进度」提示（新局不再展示）
    playing = true;
    SFX.start(); // 开局号角
    SFX.bgm.start('n1024'); // 开局背景音乐（同名幂等，重复调用不重启）
}

/** 胜利后继续挑战：关闭胜利面板，沿用当前局面继续玩 */
function continueGame() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    hideOverlay(winScreen);
    playing = true;
    SFX.bgm.start('n1024'); // 胜利演出期间 BGM 已停，继续挑战重新响起
}

/* 暂停引擎（共享库 pause-common.js）：守卫准入 → 写标志 → 遮罩显隐 → BGM 挂起/接续
 * → 暂停/恢复音效的公共序列下沉，本文件只注入差异件——对局中准入、拖拽中暂停的
 * 手势终止与 1024 专属暂停/恢复音效（n1024Pause/n1024Resume） */
const pausePipe = Pause.create({
    isPaused: () => isPaused,
    canToggle: () => playing, // 面板态直接忽略（胜利/结束时 playing 已为 false）
    setPaused: (paused) => {
        isPaused = paused;
        if (paused) endMouseDrag(); // 拖拽中暂停：立即终止鼠标拖拽手势，防止遮罩下残留拖拽在恢复时误出招
    },
    overlay: pauseScreen,
    pauseSfx: () => SFX.n1024Pause(),
    resumeSfx: () => SFX.n1024Resume(),
});

/** 切换暂停：委托共享暂停引擎（遮罩/BGM/音效公共序列），仅对局中生效；
 *  切窗失焦也会自动调用，与其他游戏失焦即暂停的行为保持一致 */
function togglePause() {
    pausePipe.toggle();
}

/* 难度按钮组点击时序收口共享库 bindDifficultyButtons（data-diff 模式：存档写键名）：
 * blur 防空格误触 → 高亮 → saveRaw → SFX 点击音 → onChange 全序列在库内 click 监听完成；
 * 经 canPick 复刻原"未知键名或重复选择直接忽略"守卫（拒绝时整体不 blur/不发声/不存档/
 * 不回调），onChange 内只保留游戏侧的尺寸重算与旧档清理 */
const difficultyCtl = Arcade.bindDifficultyButtons({
    bar: document.querySelector('.difficulty-select'),
    storageKey: KEYS.difficulty,
    persist: 'data-diff',
    canPick: (btn, idx, key) => !!DIFFICULTIES[key] && key !== currentDifficulty,
    lockedDuringPlay: () => playing, // 对局进行中禁切难度（局中守卫统一收口）
    onChange: (btn, idx, key) => {
        // 清掉上一局尚未到点的面板定时器：死亡渐暗(750ms)/胜利烟花(600ms)窗口内 playing 已置 false
        // 可切难度，旧定时器若不清会在新局棋盘上弹出过期的"得分 0"结算面板
        const hadPendingPanels = panelTimers.length > 0; // 延迟窗口标记：清前确有未到点的面板/烟花定时器
        clearPanelTimers();
        // 延迟窗口孤悬态兜底：窗口内对局已终结而面板尚未弹出，清掉定时器后 R/Enter/撤销救回全部失效
        // （撤销栈亦被下方 resetBoard 清空），补弹开始面板作为唯一出口，防止无入口软锁
        if (hadPendingPanels && !playing && !visiblePanel) showOverlay(startScreen);
        currentDifficulty = key;
        SIZE = DIFFICULTIES[key].size;
        // 重算单元格边长，保证棋盘总尺寸仍为 BOARD_W×BOARD_H（CSS 锁定 500×500）
        CELL = (BOARD_W - PAD * 2 - GAP * (SIZE - 1)) / SIZE;
        slotLayerDirty = true; // 槽位几何（SIZE/CELL）已变：下一帧重建空槽静态层
        resetBoard(); // 以新尺寸重铺预览棋盘，开始面板背后即时可见
        // 切换难度：若存档属于被放弃的旧难度则清除；初始化恢复难度时存档与新难度一致，不受影响
        // （存储不可用时读取返回 null，跳过旧档清理，不中断难度切换）
        const stale = Arcade.loadRaw(KEYS.save); // 存储不可用时静默跳过
        if (stale) {
            try {
                if (JSON.parse(stale).diff !== key) clearProgress();
            } catch (e) { /* 存档损坏交由 restoreSnapshot 校验丢弃，不在此清除 */ }
        }
    }
});

/** 推进自定义连滑：按住方向键期间，先等 REPEAT_DELAY 再以 REPEAT_RATE 节奏补发滑动。
 *  替代系统按键重复（初始延迟约 0.5s 且节奏随机），长按连滑更跟手；
 *  非对局态（面板/暂停）冻结计时，不补发；补发撞墙时静默防闷响与摇头连击
 *  @param {number} dt 帧间隔（秒） */
function updateRepeat(dt) {
    // 无按住方向，或不在可操作对局态：不推进计时（暂停 / 成就墙关闭后从原节奏点继续）
    if (!heldKeys.length || !playing || !canAct()) return;
    repeatTimer -= dt;
    if (repeatTimer > 0) return;
    move(KEY_DIRS[heldKeys[heldKeys.length - 1]], false); // 取最后按下的物理键映射的方向补发
    repeatTimer = REPEAT_RATE;
}

/* ---------- 输入事件 ---------- */

// 键盘：方向键 / WASD 滑动；Z/U 撤销；R 对局中/结算面板重开；P/Space 暂停；Enter/Space 面板确认；V/Esc 成就墙开关（✕ 或点空白处亦可关闭）
document.addEventListener('keydown', (event) => {
    const dir = KEY_DIRS[event.code];
    if (dir) {
        event.preventDefault(); // 方向键始终拦截，避免面板状态下按键滚动页面打断操作节奏
        if (event.repeat) return; // 系统按键重复一律忽略：连滑由自定义计时器驱动（延迟更短、节奏更稳）
        if (!playing || !canAct()) return; // 暂停 / 成就墙中屏蔽滑动，对齐其他游戏暂停锁操作
        move(dir); // 按下即刻出招
        if (heldKeys.indexOf(event.code) === -1) heldKeys.push(event.code); // 记录按住物理键（code 稳定，keyup 恒能对上）
        repeatTimer = REPEAT_DELAY; // 重置连滑计时：快节奏轮按时每次按下都即刻响应
        return;
    }
    if (event.repeat) return; // 撤销/重开/确认键屏蔽长按连发，防止误触连击
    // 成就墙打开期间吞掉全部操作键：撤销/重开/暂停/确认等一律短路防误触
    // （Esc / V 关墙由 ach-common.js 的 window 级监听处理，本分支提前返回不再代管开关）
    if (Ach.isOpen()) {
        if (event.key === ' ') {
            event.preventDefault(); // 空格吞掉：防页面滚动或误触聚焦按钮
        }
        return;
    }
    switch (event.key) {
        case 'z': case 'Z': case 'u': case 'U': // 撤销上一步
            doUndo();
            break;
        case 'r': case 'R': // 对局中立即重开（暂停态重开由 startGame 复位暂停）；结算面板下 R 与按钮/Enter 同效
            if (playing || visiblePanel === gameOverScreen) startGame();
            break;
        case 'p': case 'P': // 暂停/恢复（键位与 tetris/pinball 的 P 一致）
            if (playing) {
                event.preventDefault();
                togglePause();
            }
            break;
        case 'Enter': case ' ': // 面板确认：胜利面板继续 / 结束与开始面板开局；对局中空格兼作暂停
            if (playing) {
                // 对局中仅空格生效：切换暂停（键位与 snake/pac 的空格一致）
                if (event.key === ' ') {
                    event.preventDefault();
                    togglePause();
                }
                break;
            }
            if (visiblePanel === winScreen) {
                event.preventDefault();
                continueGame();
            } else if (visiblePanel === gameOverScreen) {
                event.preventDefault();
                startGame();
            } else if (!playing && !history.length) {
                // 开始面板（开局前 history 必为空）
                event.preventDefault();
                startGame();
            }
            break;
    }
});

// 松开方向键：移除按住记录，全部松开后连滑自然停止
document.addEventListener('keyup', (event) => {
    const i = heldKeys.indexOf(event.code);
    if (i !== -1) heldKeys.splice(i, 1);
});

/**
 * 失焦/切后台兜底：自动暂停 + 清空按住记录与拖拽手势
 * blur 与 visibilitychange 双通道共用本函数（visibilitychange 兜底移动端切应用
 * 不触发 blur 的场景；双触发经 isPaused 守卫天然幂等）
 */
function handleFocusLoss() {
    if (playing && !isPaused) togglePause();
    heldKeys.length = 0; // 清空按住记录：切窗后系统不会补发 keyup，防止回来后莫名连滑
    endMouseDrag(); // 清理进行中的鼠标拖拽手势：切窗后不会补发 pointerup，残留拖拽恢复后会误出招
}
Snap.bindFocusLoss(handleFocusLoss); // blur + visibilitychange 双通道接线收口共享库（幂等性说明见上）

// 触屏：按下记录起点，手指划过阈值即刻出招（无需抬手），
// 且每次触发后把起点重置为当前位置，一次连续拖动即可连环滑动
let touchX = 0, touchY = 0;
document.addEventListener('touchstart', (event) => {
    if (!playing || !canAct() || event.touches.length !== 1) return;
    touchX = event.touches[0].clientX;
    touchY = event.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchmove', (event) => {
    if (!playing || !canAct()) return;
    event.preventDefault(); // 对局中禁用页面滚动，保证滑动手势专属
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = t.clientX - touchX;
    const dy = t.clientY - touchY;
    // 位移不足阈值视为尚未成招，继续等待手指划动
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    touchX = t.clientX; // 重置起点为当前触点，同一次拖动可连续触发多步
    touchY = t.clientY;
}, { passive: false });
// 双指按下抬走一指后重锚起点：touchstart 只在恰好单指时锚定，双指期间起点已过期，
// 抬走一指若不重锚，touchmove 会以陈旧起点折算位移造成误出招（touchcancel 同因兜底）
function reanchorTouchStart(event) {
    if (event.touches.length === 1) {
        touchX = event.touches[0].clientX;
        touchY = event.touches[0].clientY;
    }
}
document.addEventListener('touchend', reanchorTouchStart, { passive: true });
document.addEventListener('touchcancel', reanchorTouchStart, { passive: true });

// 桌面鼠标拖动滑动：与触屏完全同款的手势契约（左键按下起手 · 划过阈值出招 ·
// 起点重置连滑）。仅接受主键（左键）在画布上发起，pointer capture 保证按住后
// 拖出画布仍持续跟踪；触屏设备继续走上方 touch 通道（pointerType 区分，互不干扰）
let mouseDragging = false; // 是否有进行中的鼠标拖拽手势（悬浮移动未按下时不触发）
let dragX = 0, dragY = 0; // 拖拽起点（客户端坐标，每次出招后重置为当前指针位置）
/** 终止进行中的鼠标拖拽手势：暂停 / 失焦时调用，防止残留手势在恢复后误出招 */
function endMouseDrag() {
    mouseDragging = false;
}
canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return; // 非鼠标或非左键不接管
    if (!playing || !canAct()) return; // 与触屏通道相同的可操作态守卫
    event.preventDefault(); // 阻止画布默认的拖选行为
    Arcade.capturePointer(canvas, event.pointerId); // 按住后拖出画布仍持续跟踪至松手（守卫见 arcade-common.js）
    mouseDragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
});
canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || !mouseDragging) return; // 未按下时的悬浮移动直接忽略
    if (!playing || !canAct()) return; // 暂停 / 成就墙期间冻结手势
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    // 位移不足阈值视为尚未成招，继续等待指针划动
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    dragX = event.clientX; // 重置起点为当前指针位置，同一次拖动可连续触发多步（与触屏一致）
    dragY = event.clientY;
});
canvas.addEventListener('pointerup', endMouseDrag); // 松手结束手势（capture 保证必送达画布）
canvas.addEventListener('pointercancel', endMouseDrag); // 系统接管指针（如触控切换）时兜底终止

// 鼠标悬停游戏布局区内按钮（遮罩按钮 + 画布下方撤销按钮）：轻量 UI 提示音
for (const btn of document.querySelectorAll('.layout button')) {
    btn.addEventListener('mouseenter', () => SFX.uiHover());
}

// 全屏切换 CRT 音效：全屏状态真实翻转时进全屏播开机音、退出播关机音，本地
// fullscreenchange 与 iframe 嵌入模式 arcade:fs 广播两路径已收口共享库 fullscreen.js
// （含首条广播静默校准）；嵌入模式此前无 CRT 音，统一后与 tetris/snake 对齐
FS.onCrtAudio({ on: () => SFX.crtOn(), off: () => SFX.crtOff() });

/* ---------- 主循环 ---------- */

/** 最近一帧时长（秒），供渲染层 lerp 与 pop 动画使用 */
let lastDt = 0;

/** 主循环：推进特效并整帧重绘（持续运行，遮罩下棋盘作为背景展示）；
 *  下一帧排程前置于帧逻辑（先排程后执行：配合帧级 try/catch 守护，单帧异常只跳过该帧，
 *  渲染链永不中断）。
 *  大合并卡帧期间（FX.frozen()）完全跳过推进与重绘，画布保留末帧实现真定格，
 *  恢复后 tile 滑动 / 弹出动画自原状态无缝接续；成就墙打开时逻辑冻结但渲染循环照常推进棋盘动画
 *  @param {number} now performance.now() 时间戳（ms） */
function loop(now) {
    requestAnimationFrame(loop); // 前置排程：先预约下一帧，再执行本帧逻辑（单帧异常不再中断渲染循环）
    try {
        lastDt = Math.min(0.05, (now - lastTime) / 1000); // 帧间隔封顶 50ms：切后台回来不产生巨帧跳变
        lastTime = now;
        if (!FX.frozen()) {
            time += lastDt;
            updateEffects(lastDt);
            updateRepeat(lastDt); // 自定义连滑：按住方向键期间按固定节奏补发滑动
            // 本局用时统计：仅可操作的对局态计时（暂停 / 成就墙打开时冻结）
            if (playing && !isPaused && !Ach.isOpen()) statTime += lastDt;
            draw();
        }
    } catch (err) {
        // 帧级守护：单帧异常仅记录并跳过本帧，渲染循环照常运转（防一次意外抛错冻结画面）
        console.error('[1024] 渲染帧异常（已跳过本帧，循环继续）:', err);
    }
    // 成就墙与解锁 toast 均为 DOM 覆盖层，浏览器自行推进其 CSS 动画，无需 canvas 参与
}

/* ---------- 初始化：DPR 适配 → 铺星尘背景 → 读取最高分 → 恢复难度选择 → 铺初始棋盘 → 尝试续玩存档 → 启动主循环 ---------- */
setupDisplay(); // DPR 适配：按 devicePixelRatio 设置画布物理分辨率（逻辑坐标恒为 BOARD_W×BOARD_H）
window.addEventListener('resize', setupDisplay); // 窗口尺寸变化时重新适配 DPR
initAmbient(); // 常驻星尘（重开一局不重铺，保持连续漂浮）
// 最高分读取：新键优先；隐私模式 / 禁用站点数据等读取异常按 0 处理；
// 新键缺失而旧键存在时一次性迁移老玩家最高分到新键（保留老玩家纪录，此后读写均用新键）
try {
    const storedBest = Arcade.loadRaw(KEYS.best);
    if (storedBest !== null) {
        best = parseInt(storedBest, 10) || 0;
    } else {
        const legacyBest = Arcade.loadRaw(KEYS.legacyBest);
        if (legacyBest !== null) {
            best = parseInt(legacyBest, 10) || 0;
            Arcade.saveRaw(KEYS.best, String(best)); // 迁移写入失败静默，本局照常使用旧值
        }
    }
} catch (e) { /* 存储不可用时最高分按 0 处理 */ }
// 难度恢复：与上一次选择一致（对齐其他游戏难度记忆；必须先于 restoreSnapshot，否则存档 diff 校验失败）；
// sync 为程序化恢复路径（高亮+onChange，不存档不发声），外层守卫保持"未知键名/默认难度跳过"原状
const savedDifficulty = Arcade.loadRaw(KEYS.difficulty); // 存储不可用时保持 null，走默认难度
if (DIFFICULTIES[savedDifficulty] && savedDifficulty !== DEFAULT_DIFFICULTY) {
    try {
        difficultyCtl.sync(savedDifficulty);
    } catch (e) {
        // 难度恢复兜底：此时尚未启动渲染循环，一旦抛错将中断初始化链（铺棋盘/续玩/循环启动全部跳过）
        console.warn('[1024] 难度恢复异常（已回退默认难度）:', e);
    }
}
resetBoard(); // 铺初始棋盘（两块起步方块在开始面板背后可见）
restoreSnapshot(); // 自动续玩：存在合法快照时恢复上局局面/分数/撤销栈并直接进入对局，否则保持新局流程
requestAnimationFrame(loop);

// 游玩时长统计上报（返回大厅/关页时结算）+ 键帽实时高亮（按住时点亮说明面板键帽）
FX.playtime.init('1024');
FX.KeyLight.init();

/* ---------- 进度镜像快照的两处保存触发点（街机厅统一契约，与 snake 等游戏一致） ----------
 * 触发点 a：父页游戏厅关闭 iframe 覆盖层前下发 arcade:save 消息 → 立即镜像当前局进度；
 * 触发点 b：页面卸载兜底（关闭标签页 / 刷新 / 父页移除 iframe 均触发）；
 * 进行中写入快照，非进行中状态由管线转为清除。两处接线收口共享库，
 * 消息来源守卫在 arcade-common.js（Arcade.onTrustedMessage）：仅同源 + file:// 豁免 */
Snap.bindAutoSave(snapPipe);

/* ===================== 行为冒烟测试钩子（URL 带 ?behavior=1 才激活，tests/behavior.html 汇总） ===================== */
// 用例直调本文件内部函数：先布置全局再断言，finally 恢复原值避免用例间污染；
// 失败以抛错表达，由 FX.behavior 统一捕获汇总后 postMessage 上报父页

/** 按 (r+c) 奇偶交错生成 2/4 满盘矩阵（天然无任何相邻同值，可合并性为 false） */
function behaviorFullBoard() {
    const board = [];
    for (let r = 0; r < SIZE; r++) {
        const row = [];
        for (let c = 0; c < SIZE; c++) row.push((r + c) % 2 === 0 ? 2 : 4);
        board.push(row);
    }
    return board;
}

window.__ARCADE_TESTS__ = [
    // mulberry32 确定性：同种子两实例产出完全一致的伪随机序列
    { name: 'mulberry32 同种子同序列', fn: () => {
        const g1 = mulberry32(42);
        const g2 = mulberry32(42);
        for (let i = 0; i < 8; i++) {
            if (g1() !== g2()) throw new Error('第 ' + i + ' 次抽样两实例不一致');
        }
    } },
    // dateSeed 确定性与值域：同串同值、异串异值、结果为 uint32 非负整数
    { name: 'dateSeed 确定性/值域', fn: () => {
        const a = dateSeed('20261116');
        if (a !== dateSeed('20261116')) throw new Error('同串两次散列不一致');
        if (a === dateSeed('20261115')) throw new Error('异串散列意外同值');
        if (!Number.isInteger(a) || a < 0 || a > 4294967295) throw new Error('散列值越出 uint32 值域');
    } },
    // 棋盘合法性：全 2 的幂合法；3 / 1 等非法值拒绝；行列数不符拒绝
    { name: 'isValidBoard 值域/尺寸', fn: () => {
        if (isValidBoard(behaviorFullBoard()) !== true) throw new Error('全 2 的幂棋盘被误判非法');
        const badVal = behaviorFullBoard();
        badVal[0][0] = 3;
        if (isValidBoard(badVal) !== false) throw new Error('非法值 3 未被拒绝');
        const badOne = behaviorFullBoard();
        badOne[0][0] = 1;
        if (isValidBoard(badOne) !== false) throw new Error('非法值 1 未被拒绝');
        if (isValidBoard([[2]]) !== false) throw new Error('尺寸不符棋盘未被拒绝');
    } },
    // 可合并性：交错满盘无相邻同值 → false；改出相邻同值 → true
    { name: 'canMergeAnywhere 满/邻同值', fn: () => {
        const old = grid, oldScore = score, oldCombo = combo;
        restoreBoard({ board: behaviorFullBoard(), score: 0, combo: 0 });
        try {
            if (canMergeAnywhere() !== false) throw new Error('交错满盘被误判可合并');
            grid[0][1].value = 2;
            if (canMergeAnywhere() !== true) throw new Error('相邻同值未判可合并');
        } finally {
            grid = old; score = oldScore; combo = oldCombo;
        }
    } },
    // 快照恢复：数值矩阵逐格落到 tile.value，score/combo 精确还原
    { name: 'restoreBoard 快照还原', fn: () => {
        const old = grid, oldScore = score, oldCombo = combo;
        const snapBoard = [];
        for (let r = 0; r < SIZE; r++) {
            const row = [];
            for (let c = 0; c < SIZE; c++) row.push([2, 4, 8, 16][(r + c) % 4]);
            snapBoard.push(row);
        }
        restoreBoard({ board: snapBoard, score: 77, combo: 3 });
        try {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    if (!grid[r][c] || grid[r][c].value !== snapBoard[r][c]) {
                        throw new Error('格 (' + r + ',' + c + ') 未按快照还原');
                    }
                }
            }
            if (score !== 77) throw new Error('分数未还原: ' + score);
            if (combo !== 3) throw new Error('连击未还原: ' + combo);
            if (tiles.size !== SIZE * SIZE) throw new Error('tile 实体数不符: ' + tiles.size);
        } finally { grid = old; score = oldScore; combo = oldCombo; }
    } },
];
FX.behavior('1024', window.__ARCADE_TESTS__);
