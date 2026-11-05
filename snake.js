/* ======================================================================
 * 贪吃蛇 (SNAKE) —— 像素街机厅游戏逻辑
 * 500×500 画布 · 25px 网格（20×20 格）· 四档难度（移动速度 + 食物得分 + 无敌模式）
 * 核心机制：方向输入暂存到下一 tick 才应用，杜绝同一 tick 内连按两键
 *          导致 180° 掉头；最高分 localStorage 持久化；空格暂停；
 *          切出窗口自动暂停（防止回来时蛇已撞死）
 * 进度镜像：返回游戏厅 / 收到 arcade:save 消息 / 页面卸载时保存本局快照（arcade_save_snake），
 *          下次进入自动校验并恢复续玩（停在暂停遮罩等空格继续），游戏结束清除快照
 * 成长节奏：每吃 5 个食物移动间隔 ×0.93（下限 60ms），STATS 面板实时显示速度等级；
 *          连击窗口（3s）内连续进食按 基础分×(1+0.5×(连击-1)) 加成计分，连击递增有专属升调音
 * 视觉特效：暗色网格背景 / 食物呼吸脉冲光晕 + 出生缩放弹入 / 蛇身头亮尾暗渐变 + 朝向眼睛 /
 *          蛇头移动淡尾迹 / 吃食粒子爆裂（FX.Pool 零分配对象池）+ 得分飘字 + 蛇头闪白 +
 *          吃食 40ms 卡帧顿挫 / 限时金苹果（倒计时环 + 5 倍高分 + 即将消失闪烁）/
 *          连吃 COMBO 金色飘字 / 破纪录金色烟花（FX.recordBurst）/ 死亡演出（画面震动 +
 *          红色粒子迸溅 + 蛇身从尾到头逐节熄灭）后再弹结算面板
 * 成就系统：8 条成就（得分/成长/技巧/收集四类 × 普通/稀有/史诗/传说四档稀有度），
 *          localStorage 持久化（解锁时间戳 + 历史最佳进度，兼容 v1 旧数组存档迁移），
 *          V/Esc 开合 DOM 成就墙（卡片瀑布入场 · 流光扫过 · hover 反馈 · 进度条），
 *          解锁时右上角 DOM toast + 号角音，史诗/传说级追加金色烟花庆祝
 * 渲染架构：单一 requestAnimationFrame 驱动一切——逻辑 tick 由毫秒累加器（moveAcc）
 *          按 gameSpeed 节奏补帧推进移动/碰撞；渲染层按 moveAcc/gameSpeed 进度对
 *          蛇身逐节插值，格子间平滑滑动（穿墙环绕除外，瞬移不做插值）；
 *          特效计时同步推进（暂停/卡帧/成就墙打开时逻辑与插值一并冻结）；
 *          FX.setupCanvas DPR 高清适配，绘制坐标系恒为 CSS 逻辑像素
 * 依赖：audio.js 提供的全局音效库 SFX（含 BGM 'snake'）/ fx.js 提供的全局特效库 FX
 * ==================================================================== */

/* ===================== 游戏状态 ===================== */

/** 蛇身坐标数组（首元素为蛇头，坐标单位：格） */
let snake = [];
/** 食物坐标 { x, y }（单位：格） */
let food = { x: 0, y: 0 };
/** 蛇当前实际移动方向（up/down/left/right） */
let direction = 'right';
/** 转向预输入队列深度：快速连按拐双弯时两个意图分属两个 tick 依次生效，不互相覆盖 */
const DIR_QUEUE_MAX = 2;
/** 键盘转向预输入队列：每 tick 消费一个有效意图，防 180° 掉头且连按键不丢失 */
let dirQueue = [];
/** 游戏是否进行中（startGame 置 true，gameOver 置 false；暂停不改变此标志） */
let isRunning = false;
/** 逻辑 tick 毫秒累加器：rAF 每帧累加帧间隔，达到 gameSpeed 即推进一格蛇移动 */
let moveAcc = 0;
/** 上一逻辑 tick 的蛇身位置快照（与 snake 按索引一一对应，供渲染层逐节插值） */
let prevSnake = [];
/** 当前分数 */
let score = 0;
/** 单格边长（像素） */
let gridSize = 25;
/** 蛇移动间隔（毫秒），由难度基准速度随进食提速递进：无敌/简单 200 / 中等 150 / 困难 100 */
let gameSpeed = 150;
/** 当前难度的基准移动间隔（毫秒）：速度递进的起点，selectDifficulty 时记录 */
let baseSpeed = 150;
/** 每吃多少个食物提速一档 */
const SPEED_STEP = 5;
/** 每档提速的间隔缩放系数（×0.93） */
const SPEED_FACTOR = 0.93;
/** 移动间隔下限（毫秒），提速递进到此为止避免不可玩 */
const SPEED_MIN = 60;
/** 本局已吃食物总数（驱动速度递进与速度等级显示） */
let eatenCount = 0;
/** 每个食物的得分，由难度决定：无敌/简单 5 / 中等 10 / 困难 20 */
let foodPoints = 10;
/** 无敌模式开关（仅"无敌"难度开启）：撞墙不死亡改为环绕穿墙，撞自身直接穿过 */
let invincibleMode = false;
/** 难度选择存档键（localStorage），页面加载时恢复上一次选择 */
const DIFFICULTY_KEY = 'snakeDifficulty';
/** 进度镜像快照存档键（localStorage）：返回游戏厅/页面卸载时保存本局进度，下次进入校验恢复续玩 */
const SAVE_KEY = 'arcade_save_snake';
/** 是否处于暂停状态 */
let isPaused = false;
/** 本局是否刷新了历史最高分（结算面板据此显示"新纪录"提示） */
let isNewRecord = false;
/** 历史最高分（localStorage 持久化，键 snakeHighScore） */
let highScore = 0;
// 隐私模式 / 禁用站点数据时 localStorage 读取抛 SecurityError：try/catch 静默回退默认 0，不中断初始化
try {
    highScore = parseInt(localStorage.getItem('snakeHighScore') || '0', 10);
} catch (e) { /* 存储不可用时静默回退默认值 */ }

/* ===================== 特效状态 ===================== */

/** 死亡演出总时长（秒）：震动 + 红色迸溅 + 蛇身逐节熄灭 */
const DEATH_DURATION = 0.9;
/** 是否处于死亡演出中（演出结束才弹出结算面板） */
let isDying = false;
/** 死亡演出剩余时间（秒） */
let deathTimer = 0;
/** 蛇头吃到食物后的闪白剩余时间（秒） */
let headFlash = 0;
/** 粒子对象池（FX.Pool 零分配复用，容量 200）：承载吃食爆裂 / 死亡迸溅 / 蛇头移动淡尾迹；
 *  工厂不带重力默认值（PARTICLE_GRAVITY 声明于其后，避免引用触发 TDZ），生成时显式填充 */
const particlePool = new FX.Pool(200, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2, grav: 0, fade: 1 }));
/** 得分飘字数组 { x, y, text, t, color? }（t 为 0→1 的生命进度；color 缺省时用默认绿色） */
const floatTexts = [];
/** 食物出生计时（秒）：驱动新生食物约 200ms 的缩放弹入动画 */
let foodAge = 0;
/** 粒子重力加速度（像素/秒²），让迸溅的碎屑有下坠感 */
const PARTICLE_GRAVITY = 320;
/** 金苹果存在总时长（秒），倒计时结束自动消失 */
const GOLD_TIME = 5;
/** 金苹果得分倍率（相对当前难度的食物得分） */
const GOLD_MULT = 5;
/** 金苹果出现概率：每次吃掉普通食物后、场上无金苹果时判定一次 */
const GOLD_CHANCE = 0.22;
/** 连吃 COMBO 判定窗口（秒）：窗口内再次吃到食物连击数 +1，超时清零 */
const COMBO_WINDOW = 3;
/** 限时金苹果 { x, y, t }（格坐标 + 已存活秒数），null 表示当前场上没有 */
let goldApple = null;
/** 当前连击数（COMBO_WINDOW 内连续吃到食物的次数） */
let comboCount = 0;
/** 距上次吃到食物经过的秒数，超过 COMBO_WINDOW 连击清零 */
let comboTimer = 0;
/** 全屏闪色剩余时间（秒）：金苹果捕获金闪 / 死亡瞬间白闪，快速衰减 */
let flashTime = 0;
/** 全屏闪色 RGB 分量（"r,g,b" 字符串），配合 flashTime 合成 rgba 填充 */
let flashColor = '255,255,255';
/** 画布震动剩余时间（秒）：COMBO ≥ 4 等高强度时刻触发 */
let shakeTime = 0;

/* ===================== DOM 引用 ===================== */

/** 游戏画布 */
const canvas = document.getElementById('gameCanvas');
/** 2D 绘图上下文 */
const ctx = canvas.getContext('2d');
// 静态背景层三件套声明前置：下方顶层 setupDisplay() 会先置位脏标记，若声明晚于该调用将触发 TDZ 加载崩溃
/** 静态背景层离屏画布（物理分辨率与主画布保持一致） */
const gridLayerCanvas = document.createElement('canvas');
/** 静态背景层绘制上下文 */
const gridLayerCtx = gridLayerCanvas.getContext('2d');
/** 背景层脏标记：true 时下一帧重建（DPR 适配 / 画布尺寸变化时由 setupDisplay 置位） */
let gridLayerDirty = true;
/** 当前分数显示元素 */
const scoreElement = document.getElementById('score');
/** 最高分显示元素 */
const highScoreElement = document.getElementById('highScore');
/** 速度等级显示元素（每吃 5 个食物提一档） */
const speedLevelElement = document.getElementById('speedLevel');
/** 开始遮罩（含难度选择） */
const startScreen = document.getElementById('startScreen');
/** 游戏结束遮罩 */
const gameOverScreen = document.getElementById('gameOverScreen');
/** 暂停遮罩 */
const pauseScreen = document.getElementById('pauseScreen');
/** 暂停遮罩内"已恢复上次进度"提示（仅进度快照恢复续玩时由恢复流程显示） */
const pauseRestoredElement = document.getElementById('pauseRestored');
/** 结算面板最终分数元素 */
const finalScoreElement = document.getElementById('finalScore');
/** "新纪录"提示元素 */
const newRecordElement = document.getElementById('newRecord');

/** 方向反向映射，用于禁止 180° 掉头 */
const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };

/* ===================== 画布 DPR 适配 ===================== */

/** 画布 CSS 逻辑宽度（像素）：由 FX.setupCanvas 依据 devicePixelRatio 换算得出 */
let boardW = 500;
/** 画布 CSS 逻辑高度（像素） */
let boardH = 500;
/** 横向格数（boardW / gridSize），边界与食物生成计算统一使用 */
let boardCols = 20;
/** 纵向格数（boardH / gridSize） */
let boardRows = 20;

/**
 * 画布 DPR 高清适配：委托 FX.setupCanvas 按 devicePixelRatio 重设画布物理分辨率
 * （绘制坐标系保持 CSS 逻辑像素），并同步刷新棋盘派生尺寸
 */
function setupDisplay() {
    const dims = FX.setupCanvas(canvas, 2);
    boardW = dims.w;
    boardH = dims.h;
    boardCols = Math.round(boardW / gridSize);
    boardRows = Math.round(boardH / gridSize);
    gridLayerDirty = true; // 画布物理分辨率/DPR 已变：下一帧重建静态背景层
}

/**
 * 连击加成计分：连击数 ≥ 2 时按 基础分×(1+0.5×(连击-1)) 取整加成，否则原样返回
 * @param {number} base 基础得分（普通食物为难度分，金苹果为难度分×5）
 * @returns {number} 加成后的最终得分
 */
function comboScore(base) {
    if (comboCount < 2) return base;
    return Math.round(base * (1 + 0.5 * (comboCount - 1)));
}

/**
 * easeOutBack 缓动（0→1 输入，过冲后回落到 1）：驱动食物出生的缩放弹入动画
 * @param {number} t 生命进度 0→1
 * @returns {number} 缓动后的缩放系数（峰值约 1.1，回落后稳定为 1）
 */
function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * 破纪录统一入口（幂等：本局首次超越历史最高时触发一次）——
 * 播放破纪录号角 + 金色烟花庆祝（FX.recordBurst 自带 prefersReduced 降级）
 */
function registerRecord() {
    if (isNewRecord) return;
    isNewRecord = true;
    SFX.newRecord();
    FX.recordBurst();
}

// 页面加载即恢复上次最高分显示
highScoreElement.textContent = `HI ${highScore}`;
// 初始 DPR 适配 + 窗口尺寸变化时重算（iframe 嵌入与独立打开均生效）
setupDisplay();
window.addEventListener('resize', setupDisplay);
// 画布自身布局尺寸变化时重适配：iframe 嵌入时首帧布局可能晚于脚本执行（加载瞬间 clientWidth=0
// 走冻结分支），布局完成（0→实际宽）不会触发 window resize，靠 ResizeObserver 补上这一时机；
// 回调仅重设像素属性不改 CSS 布局盒，不会造成观察循环
if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(setupDisplay).observe(canvas);
}

/* ===================== 成就系统 ===================== */

/** 成就存档键（localStorage，跨局累计）：v2 格式 { unlocked: { id: 解锁时间戳 }, best: { 各项历史最佳 } } */
const ACHIEVEMENT_KEY = 'arcade_ach_snake';
/** 稀有度中文标签映射（成就卡片右上角徽章与 toast 配色文案共用） */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
/** 历史最佳初始值：length 初始 3 节对齐蛇身初始长度，避免新档进度出现"3 节以下"的怪异空态 */
const BEST_DEFAULTS = { score: 0, length: 3, combo: 0, gold: 0, eaten: 0 };
/**
 * 成就定义表（成就墙数据源）：
 * id 唯一标识 / name 显示名 / icon 图标 emoji / rarity 稀有度（common 普通 · rare 稀有 ·
 * epic 史诗 · legendary 传说，驱动卡片配色与解锁演出档位）/ cat 分类 / desc 达成条件说明 /
 * stat 进度统计项（对应 achStore.best 键）/ target 达成目标值
 */
const SNAKE_ACHIEVEMENTS = [
    { id: 'score100', name: '百分俱乐部', icon: '🏆', rarity: 'rare',      cat: '得分', desc: '单局得分达到 100',    stat: 'score',  target: 100 },
    { id: 'score250', name: '得分大师',   icon: '👑', rarity: 'epic',      cat: '得分', desc: '单局得分达到 250',    stat: 'score',  target: 250 },
    { id: 'length30', name: '长蛇盘踞',   icon: '🐍', rarity: 'common',    cat: '成长', desc: '蛇身长度达到 30 节',  stat: 'length', target: 30 },
    { id: 'length50', name: '巨蟒传说',   icon: '🐲', rarity: 'legendary', cat: '成长', desc: '蛇身长度达到 50 节',  stat: 'length', target: 50 },
    { id: 'combo5',   name: '连击好手',   icon: '⚡', rarity: 'common',    cat: '技巧', desc: '单局连击达到 ×5',    stat: 'combo',  target: 5 },
    { id: 'combo8',   name: '连击风暴',   icon: '🌟', rarity: 'rare',      cat: '技巧', desc: '单局连击达到 ×8',    stat: 'combo',  target: 8 },
    { id: 'gold5',    name: '淘金高手',   icon: '💰', rarity: 'rare',      cat: '收集', desc: '单局捕获 5 枚金苹果', stat: 'gold',   target: 5 },
    { id: 'eat100',   name: '大胃王',     icon: '🍎', rarity: 'epic',      cat: '成长', desc: '单局吃掉 100 个食物', stat: 'eaten',  target: 100 },
];
/** 成就存档（已解锁时间戳映射 + 历史最佳），页面加载时恢复（含 v1 旧格式迁移） */
let achStore = loadAchStore();
/** 成就墙 DOM 覆盖层（V/Esc 开合，打开期间逻辑 tick 冻结） */
const achWall = document.getElementById('achWall');
/** 成就卡片网格容器（内容每次开墙时按最新存档重建） */
const achGrid = document.getElementById('achGrid');
/** 头部已解锁计数数字元素（开墙时滚动补间到位） */
const achCountElement = document.getElementById('achCount');
/** 头部成就总数元素 */
const achTotalElement = document.getElementById('achTotal');
/** 头部总完成度进度条填充元素 */
const achBarFill = document.getElementById('achBarFill');
/** 右上角解锁 toast 堆叠容器 */
const achToastStack = document.getElementById('achToastStack');
/** 成就墙是否打开（打开时冻结逻辑 tick，仅保留渲染） */
let achPanelOpen = false;
/** 本局连击峰值（registerCombo 中刷新，驱动 best.combo 历史最佳追踪） */
let maxComboRun = 0;
/** 本局已捕获金苹果数（金苹果捕获分支中刷新，驱动 best.gold 历史最佳追踪） */
let goldCountRun = 0;

/**
 * 从 localStorage 读取成就存档并规范化形状：
 * - v2 对象格式 { unlocked, best }：逐键校验类型后采用
 * - v1 旧数组格式（纯 id 列表）：迁移为 unlocked 映射（时间戳缺失记 0，墙上显示"已达成"不带日期）
 * - 缺失 / 损坏 / 存储不可用：安全回退空档
 * @returns {{unlocked: Object<string, number>, best: {score: number, length: number, combo: number, gold: number, eaten: number}}} 规范化的成就存档
 */
function loadAchStore() {
    const store = { unlocked: {}, best: { ...BEST_DEFAULTS } };
    try {
        const raw = JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY) || 'null');
        if (Array.isArray(raw)) {
            // v1 → v2 迁移：旧存档只有解锁 id 列表，无解锁时间与历史最佳
            for (const id of raw) {
                if (typeof id === 'string') store.unlocked[id] = 0;
            }
            return store;
        }
        if (raw && typeof raw === 'object' && raw.unlocked && typeof raw.unlocked === 'object') {
            for (const id of Object.keys(raw.unlocked)) {
                const ts = raw.unlocked[id];
                if (typeof ts === 'number' && Number.isFinite(ts)) store.unlocked[id] = ts;
            }
            if (raw.best && typeof raw.best === 'object') {
                for (const key of Object.keys(BEST_DEFAULTS)) {
                    const v = raw.best[key];
                    if (typeof v === 'number' && Number.isFinite(v)) store.best[key] = v;
                }
            }
        }
    } catch (e) { /* 存档损坏或存储不可用时静默回退空档 */ }
    return store;
}

/**
 * 持久化成就存档（解锁时间戳映射 + 历史最佳）
 * @param {{unlocked: Object<string, number>, best: Object<string, number>}} store 成就存档
 */
function saveAchStore(store) {
    try {
        localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify(store));
    } catch (e) { /* 存储不可用时静默放弃，不影响游戏 */ }
}

/**
 * 追踪一项历史最佳（只增不减）：超越旧值时立即落盘，
 * 并连带检查挂靠在该统计项上的全部成就是否达成（如 score 同时驱动百分俱乐部/得分大师）
 * @param {string} stat 统计项键（score / length / combo / gold / eaten，见 BEST_DEFAULTS）
 * @param {number} value 本局当前值
 */
function trackRunStat(stat, value) {
    if (!(value > achStore.best[stat])) return;
    achStore.best[stat] = value;
    saveAchStore(achStore);
    // 最佳值更新后扫描定义表：目标达成的成就逐个解锁（unlockAchievement 幂等）
    for (const a of SNAKE_ACHIEVEMENTS) {
        if (a.stat === stat && value >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 解锁成就（幂等：已解锁直接返回）：持久化解锁时间戳 → 右上角弹出 DOM toast → 播放解锁音；
 * 史诗 / 传说级额外触发全屏金色烟花庆祝（FX.recordBurst 内部对减弱动效自动降级）
 * @param {string} id 成就 id（见 SNAKE_ACHIEVEMENTS 定义表）
 */
function unlockAchievement(id) {
    if (Object.prototype.hasOwnProperty.call(achStore.unlocked, id)) return;
    achStore.unlocked[id] = Date.now();
    saveAchStore(achStore);
    const meta = SNAKE_ACHIEVEMENTS.find(a => a.id === id);
    if (!meta) return;
    showAchToast(meta);
    SFX.newRecord(); // 复用破纪录号角作为成就解锁音
    if (meta.rarity === 'epic' || meta.rarity === 'legendary') FX.recordBurst();
}

/**
 * 弹出一条成就解锁 toast（DOM）：按稀有度着色的滑入卡片，播放完
 * 入场-停留-退场全周期动画（toastCycle 3.2s，animationend 命中自动移除节点）；
 * 另设 6s 兜底清理，防止动画事件丢失导致节点残留
 * @param {{name: string, icon: string, rarity: string}} meta 成就定义（取 name/icon/rarity 字段）
 */
function showAchToast(meta) {
    const el = document.createElement('div');
    el.className = `ach-toast rarity-${meta.rarity}`;
    el.innerHTML = `<span class="toast-icon">${meta.icon}</span>` +
        `<div class="toast-body"><span class="toast-cap">成就解锁</span>` +
        `<span class="toast-name">${meta.name}</span></div>`;
    achToastStack.appendChild(el);
    el.addEventListener('animationend', (ev) => {
        if (ev.animationName === 'toastCycle') el.remove();
    });
    setTimeout(() => { if (el.parentNode) el.remove(); }, 6000); // 兜底清理
}

/**
 * 渲染成就墙内容：按定义表 × 最新存档生成卡片网格
 * （已解锁按稀有度点亮并流光扫过 / 未解锁灰暗锁定态，进度条与达成日期齐备），
 * 头部完成度计数滚动补间、总进度条宽度过渡；卡片瀑布入场由 CSS 按 --i 序号延迟驱动
 */
function renderAchWall() {
    let html = '';
    let gotCount = 0;
    for (let i = 0; i < SNAKE_ACHIEVEMENTS.length; i++) {
        const a = SNAKE_ACHIEVEMENTS[i];
        const got = Object.prototype.hasOwnProperty.call(achStore.unlocked, a.id);
        if (got) gotCount++;
        const ts = got ? achStore.unlocked[a.id] : 0;
        // 历史最佳截断到目标值：进度条封顶 100%，数字显示 min(best, target)/target
        const best = Math.min(achStore.best[a.stat] || 0, a.target);
        const pct = Math.min(100, Math.round((best / a.target) * 100));
        // 达成日期：v1 迁移的旧解锁无时间戳（记 0），显示"已达成"兜底
        const dateText = got ? (ts ? `达成于 ${new Date(ts).toLocaleDateString('zh-CN')}` : '已达成') : `${a.cat} · 尚未达成`;
        html += `<div class="ach-card ${got ? `unlocked rarity-${a.rarity}` : 'locked'}" style="--i:${i}">` +
            `<span class="ach-rarity-chip rarity-${a.rarity}">${RARITY_LABEL[a.rarity]}</span>` +
            `<div class="ach-icon"><span class="ach-emoji">${a.icon}</span>${got ? '' : '<span class="ach-lock">🔒</span>'}</div>` +
            `<div class="ach-info">` +
            `<div class="ach-name">${a.name}</div>` +
            `<p class="ach-desc">${a.desc}</p>` +
            `<div class="ach-prog"><div class="ach-prog-fill" style="width:${pct}%"></div></div>` +
            `<div class="ach-prog-meta"><span>${best} / ${a.target}</span><span>${dateText}</span></div>` +
            `</div></div>`;
    }
    achGrid.innerHTML = html;
    // 头部完成度：已解锁计数滚动补间（reduced-motion 时 tweenNumber 自动降级为直写）
    FX.tweenNumber(achCountElement, gotCount, 320, v => String(Math.round(v)));
    achTotalElement.textContent = String(SNAKE_ACHIEVEMENTS.length);
    achBarFill.style.width = `${Math.round((gotCount / SNAKE_ACHIEVEMENTS.length) * 100)}%`;
}

/**
 * 开合成就墙（V / Esc / 关闭按钮 / 点击遮罩空白）：打开时先按最新存档重绘内容
 * （卡片瀑布入场与流光自动重播），墙打开期间逻辑 tick 冻结，仅保留渲染
 */
function toggleAchPanel() {
    achPanelOpen = !achPanelOpen;
    if (achPanelOpen) {
        renderAchWall();
        achWall.hidden = false;
    } else {
        achWall.hidden = true;
    }
    SFX.uiClick();
}

// 点击成就墙遮罩空白处关闭（面板区域内的点击不触发）
achWall.addEventListener('click', (event) => {
    if (event.target === achWall) toggleAchPanel();
});

/**
 * 逐帧追踪本局成就相关统计（得分 / 蛇长）：trackRunStat 内部只在超越历史最佳时落盘，
 * 并连带触发挂靠成就（百分俱乐部 / 得分大师 / 长蛇盘踞 / 巨蟒传说）；
 * 连击在 registerCombo、金苹果在捕获分支、进食数在吃食分支中各自追踪
 */
function checkRunAchievements() {
    trackRunStat('score', score);
    trackRunStat('length', snake.length);
}

/* ===================== CRT 全屏音 ===================== */

// 进入/退出全屏时播放 CRT 开关机音（与 fullscreen.js 的全屏按钮联动）
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});

/* ===================== 核心逻辑 ===================== */

/**
 * 初始化一局新游戏：重置蛇身（3 节，位于左上角朝右）、
 * 移动方向、分数、新纪录标志与全部特效状态，并随机放置食物
 */
function initGame() {
    snake = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 }
    ];
    // 快照同步：开局各节 prev=cur，首帧渲染不做插值（浅拷贝保持与 moveSnake 快照方式一致）
    prevSnake = snake.slice();
    direction = 'right';
    dirQueue.length = 0; // 清空转向预输入队列
    score = 0;
    isNewRecord = false;
    // 复位成长节奏：已吃计数清零、速度回退到难度基准、HUD 速度等级归一
    eatenCount = 0;
    gameSpeed = baseSpeed;
    speedLevelElement.textContent = 'LV 1';
    // 复位特效状态：清空粒子/飘字，退出死亡演出与蛇头闪白，清空金苹果与连击
    particlePool.clear();
    floatTexts.length = 0;
    achPanelOpen = false;
    achWall.hidden = true; // 成就墙若处于打开态（正常路径不可达，防御性复位）
    maxComboRun = 0; // 复位本局成就统计：连击峰值与金苹果计数归零
    goldCountRun = 0;
    isDying = false;
    headFlash = 0;
    goldApple = null;
    comboCount = 0;
    comboTimer = 0;
    FX.tweenNumber(scoreElement, score, 128, v => 'SCORE ' + v); // 分数滚动补间：重开时从旧分滚回 0（reduced-motion 自动降级直写）
    generateFood();
}

/**
 * 随机生成食物：枚举全部蛇身之外的空闲格子并随机取其一
 * （避免随机重试在蛇身极长时反复碰撞导致效率低下或递归栈溢出）
 * @returns {boolean} 是否成功放置；false 表示蛇已占满全场（无处可生成，通关）
 */
function generateFood() {
    const cols = boardCols;
    const rows = boardRows;

    // 收集所有蛇身之外的空闲格子，随机取其一（避免递归重试导致的栈溢出）
    const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
    const freeCells = [];
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            if (!occupied.has(`${x},${y}`)) {
                freeCells.push({ x, y });
            }
        }
    }

    if (freeCells.length === 0) return false;
    food = freeCells[Math.floor(Math.random() * freeCells.length)];
    foodAge = 0; // 重置食物出生计时，驱动缩放弹入动画
    return true;
}

/**
 * 随机生成限时金苹果：在蛇身与普通食物之外的空闲格随机取其一
 * @returns {boolean} 是否成功放置（棋盘几乎没有空格时可能失败，静默放弃即可）
 */
function generateGoldApple() {
    const cols = boardCols;
    const rows = boardRows;

    // 空闲格 = 蛇身 + 普通食物之外的全部格子
    const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
    occupied.add(`${food.x},${food.y}`);
    const freeCells = [];
    for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
            if (!occupied.has(`${x},${y}`)) {
                freeCells.push({ x, y });
            }
        }
    }

    if (freeCells.length === 0) return false;
    goldApple = { ...freeCells[Math.floor(Math.random() * freeCells.length)], t: 0 };
    SFX.n1024Spawn4(); // 金苹果登场：复用 1024 稀有块亮金双音（稀有物出场的专属提示）
    return true;
}

/**
 * 连吃计数：COMBO 窗口内每次吃到食物（普通或金苹果）调用一次，
 * 连击数 ≥ 2 时播放递增升调音并在吃点上方弹出金色 COMBO 飘字；
 * 连击峰值同步追踪历史最佳（trackRunStat 内按目标连带触发连击好手 ×5 / 连击风暴 ×8）
 * @param {number} cx 吃点像素 x（COMBO 飘字定位）
 * @param {number} cy 吃点像素 y
 */
function registerCombo(cx, cy) {
    comboCount++;
    comboTimer = COMBO_WINDOW; // 重置连击窗口
    maxComboRun = Math.max(maxComboRun, comboCount); // 本局峰值刷新
    trackRunStat('combo', maxComboRun); // 历史最佳连击追踪（达成 ×5/×8 成就在此连带触发）
    if (comboCount >= 2) {
        SFX.comboUp(comboCount - 1); // 连击递增升调音（内部 0~8 封顶）
        // 与 +得分 飘字错开：从吃点上方约一格处弹出
        floatTexts.push({ x: cx, y: cy - gridSize - 8, text: `COMBO ×${comboCount}`, t: 0, color: '#ffd23e' });
    }
    if (comboCount >= 4) {
        shakeTime = 0.18; // 高连击整屏轻震，强化连击爽感
    }
}

/**
 * 同步自适应 BGM 危险分层（v3.0）：蛇身达到危险长度（≥15 节，对齐每日目标区间下限）
 * 进入「长身」紧张态——BGM 逐拍叠加低音鼓点声部；吃食成长与续玩恢复后各调用一次
 */
function syncDangerLayer() {
    SFX.bgm.setIntensity(snake.length >= 15);
}

/* ===================== 特效系统 ===================== */

/**
 * 在指定像素点迸溅一簇粒子（吃食爆裂 / 死亡迸溅共用）
 * @param {number} px 爆点像素 x
 * @param {number} py 爆点像素 y
 * @param {string} color 粒子颜色（CSS 颜色字符串）
 * @param {number} count 粒子数量
 * @param {number} [speed=130] 初始散射速度上限（像素/秒）
 */
function spawnBurst(px, py, color, count, speed = 130) {
    if (FX.prefersReduced) return; // 减弱动效偏好：纯装饰性粒子整体跳过
    for (let i = 0; i < count; i++) {
        // 均匀随机方向 + 随机速率，形成圆周散射
        const ang = Math.random() * Math.PI * 2;
        const spd = speed * (0.4 + Math.random() * 0.6);
        const life = 0.35 + Math.random() * 0.3;
        const p = particlePool.obtain(); // 零分配复用，满员时征用最旧粒子
        p.x = px; p.y = py;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 40; // 轻微向上偏置，爆开更自然
        p.life = life; p.maxLife = life;
        p.color = color;
        p.size = 2 + Math.random() * 2.5;
        p.grav = PARTICLE_GRAVITY; // 迸溅碎屑带重力下坠
        p.fade = 1;
    }
}

/**
 * 蛇头淡尾迹：新蛇头中心生成一粒快速淡出的绿色微光方块，
 * 移动时留下一道渐隐光带（FX.prefersReduced 时跳过）
 * @param {number} px 新蛇头格左上角像素 x
 * @param {number} py 新蛇头格左上角像素 y
 */
function spawnHeadTrail(px, py) {
    if (FX.prefersReduced) return;
    const p = particlePool.obtain();
    p.x = px + gridSize / 2;
    p.y = py + gridSize / 2;
    p.vx = 0; p.vy = 0;
    p.life = 0.3; p.maxLife = 0.3;
    p.color = '#7dffa4';
    p.size = gridSize - 8;
    p.grav = 0;    // 尾迹不坠落，原地淡出
    p.fade = 0.45; // 上限透明度压低，保持"淡"感
}

/**
 * 推进全部特效计时器（rAF 每帧调用，暂停时不调用）：
 * 粒子物理 / 飘字上浮 / 蛇头闪白 / 金苹果与连吃窗口倒计时 / 死亡演出倒计时
 * @param {number} dt 距上帧的秒数
 */
function updateEffects(dt) {
    // 粒子（对象池遍历）：按各自重力下坠 + 寿命衰减，死亡粒子由 sweep 交换剔除
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
    }
    particlePool.sweep();
    // 食物出生计时推进：驱动新生食物的缩放弹入动画
    foodAge += dt;
    // 飘字：生命进度推进（0.8s 上浮渐隐）
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        floatTexts[i].t += dt / 0.8;
        if (floatTexts[i].t >= 1) floatTexts.splice(i, 1);
    }
    // 蛇头闪白计时
    if (headFlash > 0) headFlash -= dt;
    // 全屏闪色与画布震动衰减
    if (flashTime > 0) flashTime = Math.max(0, flashTime - dt);
    if (shakeTime > 0) shakeTime = Math.max(0, shakeTime - dt);
    // 金苹果倒计时：到时自动消失
    if (goldApple) {
        goldApple.t += dt;
        if (goldApple.t >= GOLD_TIME) {
            goldApple = null;
            SFX.tDrop(); // 金苹果到时溜走：复用硬降快速下滑音（"错失"的轻量反馈）
        }
    }
    // 连吃窗口倒计时：超时连击清零
    if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) comboCount = 0;
    }
    // 死亡演出倒计时：结束后才弹出结算面板（撞击音与结算音因此错开）
    if (isDying) {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            isDying = false;
            gameOver();
        }
    }
}

/* ---------- 静态背景层离屏缓存：网格底色仅在脏标记置位时重绘一次，每帧一次 drawImage 贴回 ---------- */

/**
 * 将暗色棋盘网格背景渲染到离屏层：不透明暗底填充 + 细网格线。
 * 替代旧版每帧全量重绘的 drawGridBg——原先每帧 1 次 fillRect + 约 40 段网格路径，
 * 现仅在尺寸/DPR 变化时重建一次，每帧只剩 1 次 drawImage 贴回
 */
function renderGridLayer() {
    // 读主画布 dpr：离屏层与主画布共用同一逻辑坐标系。
    // 防御：fx.js 版本引用未升导致浏览器持有旧缓存（缺 dims 能力）时按 dataset 回退——
    // 若直接调用缺失的 FX.dims 会让本函数每帧抛错、画布永不绘制（无格无蛇无食物白屏）
    const view = (typeof FX.dims === 'function')
        ? FX.dims(canvas)
        : { dpr: parseFloat(canvas.dataset.dpr) || 1 };
    gridLayerCanvas.width = canvas.width; // 物理分辨率与主画布对齐（1:1 贴回不缩放）
    gridLayerCanvas.height = canvas.height;
    gridLayerCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // 锁 CSS 逻辑坐标，绘制代码零换算
    gridLayerCtx.fillStyle = '#0f1a12';
    gridLayerCtx.fillRect(0, 0, boardW, boardH);
    gridLayerCtx.strokeStyle = 'rgba(57, 255, 106, 0.05)';
    gridLayerCtx.lineWidth = 1;
    gridLayerCtx.beginPath();
    for (let g = gridSize; g < boardW; g += gridSize) {
        gridLayerCtx.moveTo(g + 0.5, 0);
        gridLayerCtx.lineTo(g + 0.5, boardH);
        gridLayerCtx.moveTo(0, g + 0.5);
        gridLayerCtx.lineTo(boardW, g + 0.5);
    }
    gridLayerCtx.stroke();
}

/**
 * 绘制食物：粉色方块 + 呼吸光晕 + 反相收缩的外圈脉冲环；
 * 新食物出生后约 200ms 内带 easeOutBack 缩放弹入动画
 * @param {number} now 当前帧时间戳（毫秒），驱动脉冲相位
 */
function drawFood(now) {
    const fx = food.x * gridSize + gridSize / 2;
    const fy = food.y * gridSize + gridSize / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220); // 0→1→0 呼吸相位
    // 出生弹入：foodAge 前 0.2s 用 easeOutBack 从 0 过冲弹到 1（减弱动效偏好时恒为 1）；
    // 钳位非负——easeOutBack 起始段会下冲为负值，若直接作为 L628 脉冲环的半径缩放
    // 会传给 arc 负半径抛 IndexSizeError（首次打开偶发跳帧），下冲瞬间按 0 处理（环不可见）
    const pop = FX.prefersReduced ? 1 : Math.max(0, easeOutBack(Math.min(1, foodAge / 0.2)));
    // 本体：随呼吸微涨缩的粉色方块 + 霓虹光晕，整体乘弹入缩放
    const grow = (1 + pulse * 0.12) * pop;
    const size = (gridSize - 6) * grow;
    ctx.shadowColor = '#ff3ea5';
    ctx.shadowBlur = 6 + 10 * pulse;
    ctx.fillStyle = '#ff3ea5';
    ctx.fillRect(fx - size / 2, fy - size / 2, size, size);
    ctx.shadowBlur = 0;
    // 外圈脉冲环：半径与本体同相涨缩，透明度随之减弱（本体最大时环最淡），随弹入同步缩放
    ctx.strokeStyle = `rgba(255, 62, 165, ${(1 - pulse) * 0.5 * pop})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(fx, fy, (9 + 5 * pulse) * pop, 0, Math.PI * 2);
    ctx.stroke();
}

/**
 * 绘制限时金苹果：金色方块 + 强光晕 + 外圈剩余时间倒计时环
 * （最后 1.5 秒转红并闪烁，提醒玩家即将消失）
 * @param {number} now 当前帧时间戳（毫秒），驱动光晕呼吸与闪烁相位
 */
function drawGoldApple(now) {
    if (!goldApple) return;
    const gx = goldApple.x * gridSize + gridSize / 2;
    const gy = goldApple.y * gridSize + gridSize / 2;
    const remain = GOLD_TIME - goldApple.t;
    const urgent = remain < 1.5; // 最后 1.5 秒进入紧急状态
    // 紧急状态下 130ms 周期闪烁：熄灭相直接不画
    if (urgent && Math.floor(now / 130) % 2 === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 150);
    const size = (gridSize - 6) * (1 + pulse * 0.15);
    ctx.shadowColor = '#ffd23e';
    ctx.shadowBlur = 8 + 12 * pulse;
    ctx.fillStyle = '#ffd23e';
    ctx.fillRect(gx - size / 2, gy - size / 2, size, size);
    ctx.shadowBlur = 0;
    // 倒计时环：从顶部顺时针的剩余时间弧，紧急时转红
    ctx.strokeStyle = urgent ? '#ff5a5a' : '#ffd23e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(gx, gy, 12, -Math.PI / 2, -Math.PI / 2 + (remain / GOLD_TIME) * Math.PI * 2);
    ctx.stroke();
}

/**
 * 计算第 i 节蛇身的插值渲染坐标（格坐标，可为小数）：
 * 从上一逻辑 tick 的位置 prevSnake[i] 向当前位置 snake[i] 线性过渡，
 * 使蛇身在两个逻辑格之间平滑滑动而非整格跳变；
 * 穿墙环绕（相邻 tick 坐标差绝对值 > 1）时不插值，直接返回目标格（瞬移符合穿墙直觉）
 * @param {number} i 蛇身索引（0 为蛇头）
 * @param {number} t 插值进度 0→1（moveAcc / gameSpeed）
 * @returns {{x: number, y: number}} 插值后的格坐标
 */
function segRenderPos(i, t) {
    const seg = snake[i];
    const prev = prevSnake[i] || seg; // 成长新长的尾节无 prev，原地绘制不插值
    // 穿墙环绕检测：坐标差超过 1 格视为跨屏瞬移
    if (Math.abs(seg.x - prev.x) > 1 || Math.abs(seg.y - prev.y) > 1) {
        return seg;
    }
    return {
        x: prev.x + (seg.x - prev.x) * t,
        y: prev.y + (seg.y - prev.y) * t
    };
}

/**
 * 绘制蛇身：头亮尾暗的绿色渐变 + 直角方块（每节四周留 1px 缝隙）+ 蛇头朝向眼睛；
 * 每节按插值进度 t 在上一 tick 位置与当前位置间平滑滑动；
 * 死亡演出时从尾到头逐节熄灭（变暗灰），熄灭前沿的节短暂烧红
 * @param {number} t 插值进度 0→1（moveAcc / gameSpeed）
 */
function drawSnake(t) {
    const len = snake.length;
    // 死亡演出进度 0→1，换算为已熄灭的节数（尾部先灭，收尾时全部熄灭）
    const deathK = isDying ? 1 - deathTimer / DEATH_DURATION : 0;
    const extinguished = isDying ? Math.min(len, Math.floor(deathK * (len + 1))) : 0;

    for (let i = len - 1; i >= 0; i--) {
        // 逐节插值：从上一逻辑 tick 位置滑向当前位置（t ∈ [0,1]）
        const pos = segRenderPos(i, t);
        const px = pos.x * gridSize;
        const py = pos.y * gridSize;
        if (i >= len - extinguished) {
            // 已熄灭：暗灰残躯
            ctx.fillStyle = '#232b36';
        } else if (isDying && i === len - extinguished - 1) {
            // 熄灭前沿：正在被"烧掉"的节呈红热色
            ctx.fillStyle = '#ff5a5a';
        } else if (i === 0) {
            // 蛇头：吃到食物瞬间闪白，否则亮绿
            ctx.fillStyle = headFlash > 0 ? '#ffffff' : '#7dffa4';
        } else {
            // 身体：按节数从头到尾做 HSL 亮度渐变（74% → 42%）
            const light = 74 - 32 * (i / Math.max(1, len - 1));
            ctx.fillStyle = `hsl(143, 100%, ${light}%)`;
        }
        ctx.fillRect(px + 1, py + 1, gridSize - 2, gridSize - 2);
    }

    // 蛇头眼睛（死亡全部熄灭后不再绘制）
    if (snake.length > 0 && extinguished < len) {
        // 眼睛同样使用蛇头的插值坐标，与头部同步滑动
        const hp = segRenderPos(0, t);
        const cx = hp.x * gridSize + gridSize / 2;
        const cy = hp.y * gridSize + gridSize / 2;
        // 沿运动方向前推 + 垂直方向两侧分开，确定双眼位置
        const d = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[direction];
        const fx = d.x, fy = d.y;
        const sx = -fy, sy = fx; // 垂直方向
        for (const side of [-1, 1]) {
            const ex = cx + fx * 5 + sx * 5 * side;
            const ey = cy + fy * 5 + sy * 5 * side;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(ex - 2.5, ey - 2.5, 5, 5);
            // 瞳孔顺方向前移
            ctx.fillStyle = '#0a2a14';
            ctx.fillRect(ex - 1.5 + fx * 1.5, ey - 1.5 + fy * 1.5, 3, 3);
        }
    }
}

/**
 * 绘制粒子层（吃食碎屑 / 死亡迸溅 / 蛇头淡尾迹）：随寿命渐隐的小方块
 */
function drawParticles() {
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        ctx.globalAlpha = Math.max(p.life / p.maxLife, 0) * p.fade;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制得分飘字：上浮 + 渐隐的像素字（默认绿色，COMBO 与金苹果高分飘字为金色）
 */
function drawFloatTexts() {
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const f of floatTexts) {
        ctx.globalAlpha = Math.max(1 - f.t, 0);
        ctx.fillStyle = f.color || '#7dffa4'; // 未指定颜色时用默认绿色
        ctx.fillText(f.text, f.x, f.y - f.t * 22);
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制一帧完整画面：网格背景 → 震动偏移 → 食物/金苹果 → 蛇 → 粒子 → 飘字 → 全屏闪色
 * @param {number} now 当前帧时间戳（毫秒），驱动食物与金苹果的脉冲相位
 * @param {number} t 蛇身插值进度 0→1（moveAcc / gameSpeed），透传给 drawSnake
 */
function draw(now, t) {
    // 静态背景层：脏标记置位时重建一次，之后每帧仅一次 drawImage 贴回（绘制于震动层之下，与旧版一致）
    if (gridLayerDirty) {
        renderGridLayer();
        gridLayerDirty = false;
    }
    ctx.drawImage(gridLayerCanvas, 0, 0, boardW, boardH);

    ctx.save();
    // 死亡演出前 35% 时段画面随机震动，振幅线性衰减到 0
    if (isDying) {
        const dk = 1 - deathTimer / DEATH_DURATION;
        const amp = Math.max(0, 1 - dk / 0.35) * 5;
        if (amp > 0.1) {
            ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
        }
    }
    // 高连击等事件的画布震动（独立于死亡演出，随剩余时间线性衰减）
    if (shakeTime > 0) {
        const amp = Math.min(1, shakeTime / 0.18) * 4;
        ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
    }
    drawFood(now);
    drawGoldApple(now);
    drawSnake(t);
    drawParticles();
    drawFloatTexts();
    ctx.restore();
    // 全屏闪色覆盖（金苹果金闪 / 死亡白闪），画在最上层快速淡出
    if (flashTime > 0) {
        ctx.fillStyle = `rgba(${flashColor}, ${Math.min(0.35, flashTime * 1.6)})`;
        ctx.fillRect(-10, -10, boardW + 20, boardH + 20);
    }
}

/**
 * 蛇前进一步（每个逻辑 tick 调用一次，绘制已移交 rAF 渲染层）：
 * 1. 消费转向预输入队列（淘汰过期意图，180° 校验始终基于上一次实际移动方向）
 * 2. 按方向计算新蛇头坐标
 * 3. 命中限时金苹果（5 倍高分）或普通食物：加分 / 粒子爆裂 + 飘字 + 蛇头闪白 +
 *    连吃计数 / 刷新并持久化最高分；未命中：移除尾节（长度不变）
 * 4. 碰撞判定：撞墙或撞自己则进入死亡演出；无敌模式例外——撞墙环绕穿墙、
 *    撞自身直接穿过，均不触发死亡；判定通过后新蛇头入列
 */
function moveSnake() {
    // 记录移动前位置快照（浅拷贝数组，元素引用不变），供渲染层本 tick 做逐节插值
    // （必须浅拷贝：后续 unshift/pop 会原地变更 snake 数组，直接引用会导致 prev 与 cur 恒等、插值失效）
    prevSnake = snake.slice();
    // 消费转向预输入队列：淘汰过期意图（与当前同向或 180° 反向），应用首个有效意图；
    // 其后的意图保留到后续 tick，快速连按拐双弯不丢键
    while (dirQueue.length) {
        const dir = dirQueue.shift();
        if (dir !== direction && dir !== opposites[direction]) { direction = dir; break; }
    }
    const head = { ...snake[0] };

    switch(direction) {
        case 'up': head.y--; break;
        case 'down': head.y++; break;
        case 'left': head.x--; break;
        case 'right': head.x++; break;
    }

    // 无敌模式：撞墙不死亡，坐标取模环绕到对侧（此后按环绕后的真实位置参与吃食等判定）
    if (invincibleMode) {
        // 穿墙检测：取模前越界即为本 tick 发生了环绕（供穿越音效判定）
        const wrapped = head.x < 0 || head.x >= boardCols || head.y < 0 || head.y >= boardRows;
        head.x = (head.x + boardCols) % boardCols; // 越过左/右边界后从对侧出现
        head.y = (head.y + boardRows) % boardRows; // 越过上/下边界后从对侧出现
        if (wrapped) SFX.cardSnake(); // 穿墙瞬移：复用大厅卡片蛇形上滑音（"嗖"地钻进对侧的穿越感）
    }

    // 检查是否吃到限时金苹果（与普通食物位置互斥，独立判定）
    if (goldApple && head.x === goldApple.x && head.y === goldApple.y) {
        // 先计入连击（决定加成倍率），再计算金苹果 5 倍高分 × 连击加成
        registerCombo(goldApple.x * gridSize + gridSize / 2, goldApple.y * gridSize + gridSize / 2);
        const pts = comboScore(foodPoints * GOLD_MULT);
        score += pts;
        FX.tweenNumber(scoreElement, score, 128, v => 'SCORE ' + v); // 分数滚动补间：从当前显示值平滑滚到新值（reduced-motion 自动降级直写）
        SFX.beePowerup(); // 金苹果捕获：复用小蜜蜂拾取道具上行三连音（区别于普通吃食的"啵"，匹配 5 倍高分的高光感）

        // 金色迸溅 + 高分飘字 + 蛇头闪白 + 吃食卡帧
        const gx = goldApple.x * gridSize + gridSize / 2;
        const gy = goldApple.y * gridSize + gridSize / 2;
        spawnBurst(gx, gy, '#ffd23e', 20, 170);
        floatTexts.push({ x: gx, y: gy - 6, text: `+${pts}`, t: 0, color: '#ffd23e' });
        headFlash = 0.15;
        FX.hitstop(40); // 40ms 卡帧顿挫，强化进食手感（FX 内部对 prefersReduced 自动跳过）
        flashTime = 0.25;   // 金苹果捕获全屏金闪
        flashColor = '255,210,62';
        goldApple = null;
        goldCountRun++; // 本局金苹果计数刷新（淘金高手成就进度）
        trackRunStat('gold', goldCountRun);
        updateDailyGoal(); // 金苹果同样使蛇成长：同步刷新每日目标进度
        syncDangerLayer(); // 长身完成：同步 BGM 危险分层（≥15 节叠加鼓点层）

        // 分数超过历史最高时实时刷新最高分并持久化（首次触发破纪录庆祝）
        if (score > highScore) {
            highScore = score;
            registerRecord();
            try { localStorage.setItem('snakeHighScore', String(highScore)); } catch (e) { /* 存储不可用时静默放弃，不中断进食/结算流程 */ }
            highScoreElement.textContent = `HI ${highScore}`;
        }
    } else if (head.x === food.x && head.y === food.y) {
        // 吃到普通食物：先计入连击（决定加成倍率），再计算加成后的得分
        const fx = food.x * gridSize + gridSize / 2;
        const fy = food.y * gridSize + gridSize / 2;
        registerCombo(fx, fy);
        const pts = comboScore(foodPoints);
        score += pts;
        FX.tweenNumber(scoreElement, score, 128, v => 'SCORE ' + v); // 分数滚动补间：从当前显示值平滑滚到新值（reduced-motion 自动降级直写）
        SFX.snakeEat();

        // 在食物原位迸溅碎屑 + 弹出得分飘字 + 蛇头闪白 + 吃食卡帧（强化"吃到"的瞬间反馈）
        spawnBurst(fx, fy, '#ff3ea5', 14);
        // 连击加成生效（实际得分高于基础分）时飘字转金色提示
        floatTexts.push({ x: fx, y: fy - 6, text: `+${pts}`, t: 0, color: pts > foodPoints ? '#ffd23e' : undefined });
        headFlash = 0.15;
        FX.hitstop(40); // 40ms 卡帧顿挫，强化进食手感（FX 内部对 prefersReduced 自动跳过）

        // 成长节奏：每吃 SPEED_STEP 个提速一档（×0.93，下限 SPEED_MIN）
        // （rAF 累加器下一帧自动按新间隔补帧，无需重启任何定时器）
        eatenCount++;
        trackRunStat('eaten', eatenCount); // 本局进食数历史最佳追踪（大胃王成就进度）
        if (eatenCount % SPEED_STEP === 0 && gameSpeed > SPEED_MIN) {
            gameSpeed = Math.max(SPEED_MIN, Math.round(baseSpeed * Math.pow(SPEED_FACTOR, eatenCount / SPEED_STEP)));
            SFX.tLevelUp(); // 提速一档：复用俄罗斯方块升级六连琶音（速度里程碑达成）
        }
        speedLevelElement.textContent = `LV ${1 + Math.floor(eatenCount / SPEED_STEP)}`;
        updateDailyGoal(); // 普通食物使蛇成长：同步刷新每日目标进度（达成时在此触发演出与落盘）
        syncDangerLayer(); // 长身完成：同步 BGM 危险分层（≥15 节叠加鼓点层）

        // 分数超过历史最高时实时刷新最高分并持久化（首次触发破纪录庆祝）
        if (score > highScore) {
            highScore = score;
            registerRecord();
            try { localStorage.setItem('snakeHighScore', String(highScore)); } catch (e) { /* 存储不可用时静默放弃，不中断进食/结算流程 */ }
            highScoreElement.textContent = `HI ${highScore}`;
        }

        // 概率刷新一枚限时金苹果（场上没有时才判定），提供抢分目标
        if (!goldApple && Math.random() < GOLD_CHANCE) generateGoldApple();

        // 蛇占满全场时无法生成食物，直接结算（通关，无演出）
        if (!generateFood()) {
            gameOver();
            return;
        }
    } else {
        snake.pop();
    }

    // 检查碰撞（无敌模式跳过死亡判定：撞墙已被上方环绕逻辑化解，撞自身直接穿过）
    if (!invincibleMode && isCollision(head)) {
        startDeath(head);
        return;
    }

    snake.unshift(head);
    // 蛇头淡尾迹 + 本局成就检查（长蛇盘踞：蛇长 ≥ 30）
    spawnHeadTrail(head.x * gridSize, head.y * gridSize);
    checkRunAchievements();
}

/**
 * 进入死亡演出：启动逐节熄灭倒计时 → 在撞击点迸溅红色粒子 →
 * 播放撞击哀鸣，演出结束后由渲染层触发结算
 * （逻辑 tick 由 updateLogic 检测 isDying 自动停摆，无需清理定时器）
 * @param {object} head 撞击时的蛇头坐标 { x, y }（单位：格，粒子爆点定位）
 */
function startDeath(head) {
    isDying = true;
    deathTimer = DEATH_DURATION;
    // 撞击点红色迸溅：360° 均匀散射，飞出场外的粒子被画布边缘自然裁剪
    spawnBurst(head.x * gridSize + gridSize / 2, head.y * gridSize + gridSize / 2, '#ff5a5a', 16, 170);
    flashTime = 0.12; // 死亡瞬间全屏白闪
    flashColor = '255,255,255';
    SFX.snakeDie();
}

/**
 * 碰撞检测：新蛇头是否越界（撞墙）或与蛇身任一节重合（撞自己）
 * @param {object} head 新蛇头坐标 { x, y }（单位：格）
 * @returns {boolean} 发生碰撞返回 true
 */
function isCollision(head) {
    // 检查是否撞墙
    if (head.x < 0 || head.x >= boardCols ||
        head.y < 0 || head.y >= boardRows) {
        return true;
    }

    // 检查是否撞到自己
    for (let i = 0; i < snake.length; i++) {
        if (snake[i].x === head.x && snake[i].y === head.y) {
            return true;
        }
    }

    return false;
}

/* ===================== 交互与流程控制 ===================== */

/**
 * 选择难度：切换按钮高亮，并从按钮 data 属性读取移动速度、食物得分与无敌模式标记
 * @param {HTMLButtonElement} btn 被点击的难度按钮（data-speed / data-points / data-invincible）
 */
function selectDifficulty(btn) {
    document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    gameSpeed = parseInt(btn.dataset.speed, 10);
    baseSpeed = gameSpeed; // 记录难度基准速度，作为进食提速递进的起点
    foodPoints = parseInt(btn.dataset.points, 10);
    // 仅"无敌"难度（data-invincible="1"）开启无敌模式：撞墙环绕、撞自身穿过；其余难度一律关闭
    invincibleMode = btn.dataset.invincible === '1';
    // 持久化所选难度（按钮组中的序号），供下次加载时恢复
    try { localStorage.setItem(DIFFICULTY_KEY, String([...document.querySelectorAll('.difficulty-btn')].indexOf(btn))); } catch (e) { /* 存储不可用时静默跳过 */ } // 持久化失败不影响难度切换
    SFX.uiClick();
}

/**
 * 切换暂停：暂停时冻结逻辑累加器（渲染同步定格）并显示遮罩，恢复时继续推进。
 * 仅在游戏进行中生效（开始前、结束后或死亡演出中调用无效）
 */
function togglePause() {
    // 仅在游戏进行中生效（开始前 isRunning=false，死亡演出中 isDying=true，成就墙打开时冻结不接管）
    if (!isRunning || isDying || achPanelOpen) return;

    isPaused = !isPaused;
    if (isPaused) {
        pauseScreen.style.display = 'block';
        SFX.bgm.pause(); // 背景音乐挂起，与暂停遮罩同步
        SFX.uiPause();
    } else {
        pauseScreen.style.display = 'none';
        pauseRestoredElement.style.display = 'none'; // 快照恢复提示只在首次续玩前展示，续玩后隐藏
        // 快照续玩局此前从未起播 BGM（恢复流程不经 startGame）：start 同名幂等，
        // 未播时补起播、已在播时不受影响；随后 resume 接续手动暂停保留的进度
        SFX.bgm.start('snake');
        SFX.bgm.resume(); // 恢复背景音乐
        SFX.uiResume();
    }
}

/**
 * 开始游戏：移除按钮焦点（防止随后按空格暂停时误触发按钮）→
 * 隐藏全部遮罩 → 重置游戏状态 → 置运行标志并清零累加器（逻辑 tick
 * 由 rAF 渲染循环内的 updateLogic 统一推进，无需单独启动定时器）→ 播放开场音
 */
function startGame() {
    // 移除按钮焦点，避免随后按空格暂停时误触发按钮点击
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    startScreen.style.display = 'none';
    gameOverScreen.style.display = 'none';
    pauseScreen.style.display = 'none';
    pauseRestoredElement.style.display = 'none'; // 新开局不残留快照恢复提示
    initGame();
    updateDailyGoal(); // 开局即显示今日目标与当前长度
    isPaused = false;
    isRunning = true;
    moveAcc = 0; // 累加器清零：开局先等满一个完整 gameSpeed 再迈第一步
    SFX.start();
    SFX.bgm.start('snake'); // 贪吃蛇专属背景音乐（start 同名幂等，可安全重复调用）
}

/**
 * 游戏结束：填充最终分数与"新纪录"提示 → 显示结束遮罩 → 播放结算音
 * （死亡撞击音在演出开始时已播过，此处自然错开约 0.9 秒）
 */
function gameOver() {
    isRunning = false; // 停摆逻辑 tick（updateLogic 检测后不再累加）
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 存储不可用时静默 */ } // 本局已结束：清除进行中的进度快照（快照仅服务于未打完的局；清除失败不中断结算流程）
    finalScoreElement.textContent = score;
    newRecordElement.style.display = isNewRecord ? 'block' : 'none';
    gameOverScreen.style.display = 'block';
    SFX.bgm.stop(); // 结算时停止背景音乐
    SFX.gameOver();
}

/* ===================== 进度镜像快照 ===================== */

/**
 * 将当前局进度镜像为纯数据快照写入 localStorage（键 arcade_save_snake）：
 * 仅在"游戏进行中（含暂停中）且非死亡演出"时保存；处于开始界面 / 游戏结束界面 /
 * 死亡演出时转为清除快照（快照只服务于未打完的局）。整体 try/catch 静默，
 * 存储不可用（隐私模式 / 配额满）等异常不影响游戏本体。
 * 快照字段（首字段固定版本号 v，恢复时校验）：
 *   v             快照格式版本，当前写入 1；更早的无 dirQueue 字段旧档，恢复时回退单字段 nextDir
 *   diff          难度档序号（0 无敌 / 1 简单 / 2 中等 / 3 困难）
 *   cols / rows   棋盘规格（横向 / 纵向格数，恢复时与当前棋盘比对）
 *   snake         蛇身坐标数组 [{ x, y }...]（首元素为蛇头，单位：格）
 *   dir           蛇当前实际移动方向（up/down/left/right）
 *   dirQueue      转向预输入队列（字符串数组；更早版本快照无此字段，恢复时回退单字段 nextDir）
 *   food          普通食物坐标 { x, y }
 *   score         当前分数
 *   eaten         本局已吃食物总数（恢复时据此重新推导移动速度节奏）
 *   maxCombo      本局连击峰值（成就"连击好手/连击风暴"进度；更早版本快照无此字段，恢复时回退 0）
 *   gold          本局已捕获金苹果数（成就"淘金高手"进度；更早版本快照无此字段，恢复时回退 0）
 */
function saveSnapshot() {
    // 进行中（空格暂停亦算，isRunning 不因暂停改变）且未进入死亡演出 → 保存；否则清除
    if (isRunning && !isDying) {
        // 由当前高亮的难度按钮反推难度档序号（找不到高亮按钮视为状态异常，走清除分支）
        const diffIndex = [...document.querySelectorAll('.difficulty-btn')]
            .indexOf(document.querySelector('.difficulty-btn.active'));
        if (diffIndex < 0) {
            try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 静默 */ }
            return;
        }
        // 组装纯数据快照：仅含数组 / 数值 / 字符串，不含任何函数与 DOM 引用，可安全 JSON 序列化
        const snap = {
            v: 1,
            diff: diffIndex,
            cols: boardCols,
            rows: boardRows,
            snake: snake.map(s => ({ x: s.x, y: s.y })), // 逐节拷贝，序列化内容与活状态解耦
            dir: direction,
            dirQueue: dirQueue.slice(), // 预输入队列快照（浅拷贝数组，序列化内容与活状态解耦）
            food: { x: food.x, y: food.y },
            score: score,
            eaten: eatenCount,
            maxCombo: maxComboRun, // 本局连击峰值（成就进度随快照延续）
            gold: goldCountRun     // 本局已捕获金苹果数（成就进度随快照延续）
        };
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
        } catch (e) { /* 存储不可用时静默放弃，不影响游戏 */ }
    } else {
        // 未开始 / 游戏结束 / 死亡演出中：不留快照
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 静默 */ }
    }
}

/**
 * 从 localStorage 读取进度快照并恢复续玩状态（键 arcade_save_snake）：
 * 逐字段校验版本号 / 类型 / 取值范围 / 方向枚举 / 棋盘规格 / 蛇身与食物的
 * 空间合法性，任何异常（键缺失 / JSON 损坏 / 字段非法 / 越界重叠）都清除快照
 * 并返回 false，调用方回退默认新开局流程；绝不因脏数据抛错。
 * 校验通过后：覆盖蛇身 / 方向 / 食物 / 分数等核心状态，按恢复后的难度基准与
 * 已吃食物数重新推导移动间隔（与局内提速公式一致），复位全部特效与瞬态计时，
 * 刷新 HUD 并重绘一帧棋面。恢复后的局处于"暂停中"，由调用方显示暂停遮罩，
 * 玩家按空格（原有继续输入）即恢复运行。
 * @returns {boolean} 快照合法并已恢复返回 true；无快照或快照非法返回 false
 */
function restoreSnapshot() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false; // 无快照：正常新开局，无需清理
        const snap = JSON.parse(raw);
        // 版本号不符（损坏或未来格式）：立即弃用并清除
        if (!snap || typeof snap !== 'object' || (snap.v !== 1 && snap.v !== 2)) { // v1/v2 均兼容读取
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 难度档：非负整数且对应难度按钮真实存在
        if (!Number.isInteger(snap.diff) || snap.diff < 0 || snap.diff > 3) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        const diffBtn = document.querySelectorAll('.difficulty-btn')[snap.diff];
        if (!diffBtn) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 棋盘规格：必须为有限数值且与当前棋盘一致（CSS 锁定 500×500 → 20×20，正常恒等）
        if (!Number.isFinite(snap.cols) || !Number.isFinite(snap.rows) ||
            snap.cols !== boardCols || snap.rows !== boardRows) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 蛇身：数组且长度合法（开局 3 节只增不减，上限为棋盘总格数）
        if (!Array.isArray(snap.snake) || snap.snake.length < 3 || snap.snake.length > snap.cols * snap.rows) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 蛇身逐节校验：整数坐标且在棋盘内；同步收集坐标键用于去重与食物重叠校验
        const seen = new Set();
        for (let i = 0; i < snap.snake.length; i++) {
            const seg = snap.snake[i];
            if (!seg || typeof seg !== 'object' ||
                !Number.isInteger(seg.x) || !Number.isInteger(seg.y) ||
                seg.x < 0 || seg.x >= snap.cols || seg.y < 0 || seg.y >= snap.rows) {
                localStorage.removeItem(SAVE_KEY);
                return false;
            }
            const key = seg.x + ',' + seg.y;
            if (seen.has(key)) { // 蛇身存在重叠格属于非法状态
                localStorage.removeItem(SAVE_KEY);
                return false;
            }
            seen.add(key);
        }
        // 方向：当前方向须为合法枚举；预输入队列（v2 数组）或 v1 单字段 nextDir 亦须合法
        const dirs = ['up', 'down', 'left', 'right'];
        if (!dirs.includes(snap.dir) ||
            !(Array.isArray(snap.dirQueue)
                ? snap.dirQueue.every(d => dirs.includes(d))
                : dirs.includes(snap.nextDir))) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 食物：整数坐标在棋盘内，且不与蛇身任何一节重叠
        if (!snap.food || typeof snap.food !== 'object' ||
            !Number.isInteger(snap.food.x) || !Number.isInteger(snap.food.y) ||
            snap.food.x < 0 || snap.food.x >= snap.cols || snap.food.y < 0 || snap.food.y >= snap.rows ||
            seen.has(snap.food.x + ',' + snap.food.y)) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 分数与已吃食物数：有限非负整数
        if (!Number.isFinite(snap.score) || !Number.isInteger(snap.score) || snap.score < 0 ||
            !Number.isFinite(snap.eaten) || !Number.isInteger(snap.eaten) || snap.eaten < 0) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }

        // ---------- 校验全部通过：覆盖游戏状态 ----------
        selectDifficulty(diffBtn); // 恢复难度档（基准速度/食物得分/无敌模式 + 按钮高亮；加载期 uiClick 无声无害）
        snake = snap.snake.map(s => ({ x: s.x, y: s.y })); // 逐节拷贝，与快照对象隔离
        prevSnake = snake.slice(); // 插值基准与当前位置重合，恢复首帧不做插值滑动
        direction = snap.dir;
        // 预输入队列恢复：v2 为数组，v1 旧快照单字段 nextDir 包装为单元素队列；
        // 过滤与当前方向相反的意图（异常存档），防止续玩第一步 180° 掉头即死
        dirQueue = (Array.isArray(snap.dirQueue) ? snap.dirQueue : [snap.nextDir])
            .filter(d => d !== opposites[direction]);
        food = { x: snap.food.x, y: snap.food.y };
        score = snap.score;
        eatenCount = snap.eaten;
        syncDangerLayer(); // 续玩长蛇直接进入危险分层，与恢复后的局面匹配
        // 按恢复后的速度等级重新推导移动计时节奏（与局内每吃 SPEED_STEP 个提速一档的公式一致）
        gameSpeed = Math.max(SPEED_MIN, Math.round(baseSpeed * Math.pow(SPEED_FACTOR, eatenCount / SPEED_STEP)));
        // 复位特效与瞬态状态：恢复出的是"干净的进行中局面"
        moveAcc = 0;        // 累加器清零：续玩后先等满一个完整 gameSpeed 再迈第一步
        foodAge = 1;        // 跳过食物出生弹入动画（foodAge≥0.2 后恒为满尺寸）
        goldApple = null;   // 金苹果为限时瞬态，不入快照，恢复后自然重新判定
        comboCount = 0;
        comboTimer = 0;
        headFlash = 0;
        flashTime = 0;
        shakeTime = 0;
        isDying = false;
        deathTimer = 0;
        isNewRecord = false;
        particlePool.clear();
        floatTexts.length = 0;
        achPanelOpen = false;
        achWall.hidden = true; // 成就墙为瞬态 UI，不入快照，恢复后强制关闭
        // 恢复本局成就统计（旧版快照无 maxCombo/gold 字段，类型校验不通过时回退 0，进度不虚报）
        maxComboRun = typeof snap.maxCombo === 'number' && Number.isFinite(snap.maxCombo) && snap.maxCombo > 0 ? snap.maxCombo : 0;
        goldCountRun = typeof snap.gold === 'number' && Number.isFinite(snap.gold) && snap.gold > 0 ? snap.gold : 0;
        // 刷新 HUD：分数与速度等级与恢复后的状态一致（最高分键与逻辑不变）
        FX.tweenNumber(scoreElement, score, 128, v => 'SCORE ' + v); // 分数滚动补间：从当前显示值平滑滚到新值（reduced-motion 自动降级直写）
        speedLevelElement.textContent = `LV ${1 + Math.floor(eatenCount / SPEED_STEP)}`;
        draw(performance.now(), 0); // 立即重绘一帧：暂停遮罩下方即呈现恢复后的棋面
        return true;
    } catch (e) {
        // 任何异常（JSON 损坏 / 存储不可用等）：清除快照并按无存档处理，绝不向上抛错
        try { localStorage.removeItem(SAVE_KEY); } catch (e2) { /* 静默 */ }
        return false;
    }
}

/* ===================== 输入与窗口事件 ===================== */

/**
 * 全局键盘控制：V / Esc 开合成就墙；空格切换暂停；方向键 / WASD 压入深度 2
 * 转向预输入队列（同向去重、180° 掉头拒绝，快速连按拐双弯不丢键），
 * 并阻止方向键滚动页面
 * @param {KeyboardEvent} event 键盘事件
 */
document.addEventListener('keydown', (event) => {
    // V 键开合成就墙（全站统一开墙键：V；A/WASD 已被转向占用，V 为空闲键）
    if (event.code === 'KeyV') {
        event.preventDefault();
        if (!event.repeat) toggleAchPanel(); // 防长按连发
        return;
    }

    // Esc 关闭成就墙（仅墙打开时接管，与 V 键等效）
    if (event.code === 'Escape' && achPanelOpen) {
        event.preventDefault();
        if (!event.repeat) toggleAchPanel();
        return;
    }

    // 空格切换暂停
    if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) togglePause(); // 防长按连发：系统按键重复率下反复切换暂停
        return;
    }

    let newDirection = null;
    switch(event.key) {
        // 方向键与 WASD 双通道支持（左手操作），大小写均匹配以兼容大写锁定
        case 'ArrowUp': case 'w': case 'W': newDirection = 'up'; break;
        case 'ArrowDown': case 's': case 'S': newDirection = 'down'; break;
        case 'ArrowLeft': case 'a': case 'A': newDirection = 'left'; break;
        case 'ArrowRight': case 'd': case 'D': newDirection = 'right'; break;
    }

    if (!newDirection) return;
    event.preventDefault(); // 阻止方向键滚动页面
    if (event.repeat) return; // 防御：按住方向的系统重复键不再入队（队列同向去重已兜底，此处显式拦截语义更清晰）
    if (isPaused) return; // 暂停中（含切窗自动暂停）蛇已冻结：不入队、不播转向音，避免恢复瞬间莫名转向
    queueDirection(newDirection); // 压入预输入队列：拐双弯的两个意图分属两个 tick 依次生效
});

/**
 * 转向预输入入队（深度 2）：与队尾方向（队空时与当前实际方向）比较——
 * 同向不重复入队、180° 掉头拒绝；队列满则淘汰最旧意图，保证最新按键优先
 * @param {string} newDirection 待入队方向（up/down/left/right）
 */
function queueDirection(newDirection) {
    const ref = dirQueue.length ? dirQueue[dirQueue.length - 1] : direction;
    if (newDirection === ref || newDirection === opposites[ref]) return; // 同向重复 / 180° 掉头均忽略
    if (dirQueue.length >= DIR_QUEUE_MAX) dirQueue.shift(); // 队列满淘汰最旧，新意图优先
    dirQueue.push(newDirection);
    SFX.snakeTurn();
}

/* ---------- 画布滑动手势：触屏 / 鼠标统一 pointer 通道（契约对齐 1024：阈值出招 · 起点重置连滑） ---------- */

/** 滑动出招阈值（像素）：位移超过此值才判定方向，防止轻微误触乱转向 */
const SWIPE_THRESHOLD = 26;
/** 是否有进行中的滑动手势（pointerdown 起手，pointerup/cancel 收尾） */
let swipeActive = false;
/** 手势起点（客户端坐标），每次出招后重置为当前指针位置，一次拖动可连续出招 */
let swipeX = 0, swipeY = 0;

/**
 * 终止进行中的滑动手势：松手 / 系统接管指针 / 失焦时调用，
 * 防止残留手势在暂停恢复后误出招
 */
function endSwipe() {
    swipeActive = false;
}

canvas.addEventListener('pointerdown', (event) => {
    // 仅对局进行中启动手势：未开始/已结束（遮罩面板接管交互）/暂停（含切窗自动暂停）/
    // 死亡演出/成就面板期间均不接管，与键盘通道的暂停守卫语义一致
    if (!isRunning || isPaused || achPanelOpen || isDying) return;
    event.preventDefault(); // 阻止画布默认的触屏滚动 / 鼠标拖选行为
    canvas.setPointerCapture(event.pointerId); // 按住后拖出画布仍持续跟踪至松手
    swipeActive = true;
    swipeX = event.clientX;
    swipeY = event.clientY;
});

canvas.addEventListener('pointermove', (event) => {
    if (!swipeActive) return; // 未按下时的悬浮移动直接忽略
    if (!isRunning || isPaused || achPanelOpen || isDying) return; // 暂停 / 演出期间冻结手势
    const dx = event.clientX - swipeX;
    const dy = event.clientY - swipeY;
    // 位移不足阈值视为尚未成招，继续等待指针划动
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    // 主导轴判定方向，复用键盘同一路径入队（同向去重 / 180° 掉头拒绝自动生效）
    queueDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipeX = event.clientX; // 重置起点为当前指针位置，同一次拖动可连续触发多步
    swipeY = event.clientY;
});

canvas.addEventListener('pointerup', endSwipe); // 松手结束手势（capture 保证按住拖出画布也必送达）
canvas.addEventListener('pointercancel', endSwipe); // 系统接管指针（如来电 / 触控冲突）时兜底终止

// 切出窗口时自动暂停，避免回来时蛇已经撞死
window.addEventListener('blur', () => {
    endSwipe(); // 清理进行中的滑动手势：切窗后不会补发 pointerup，残留手势恢复后会误出招
    if (isRunning && !isDying && !isPaused) togglePause();
});

// 暂停遮罩点击恢复：点遮罩空白处续玩，与键盘空格等效；
// 失焦自动暂停与快照续玩等待确认共用同一遮罩，点击同样适用
pauseScreen.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return; // 遮罩内可交互元素（返回链接等）走自身默认行为，不误触发恢复
    if (isRunning && !isDying && isPaused) togglePause();
});

/* ---------- 进度镜像快照：三处保存触发点 ---------- */

// 触发点 a：父页游戏厅关闭 iframe 覆盖层前下发 arcade:save 消息 → 立即镜像当前局进度
// （saveSnapshot 内部自行区分：进行中/暂停中保存，未开始/已结束则清除快照）
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'arcade:save') saveSnapshot();
});

// 触发点 b：页面卸载兜底（关闭标签页 / 刷新 / 父页移除 iframe 均触发）
// —— 进行中或暂停中保存快照；未开始 / 已结束则由 saveSnapshot 清除
window.addEventListener('pagehide', () => {
    saveSnapshot();
});

/* ===================== 主循环 ===================== */

/**
 * 逻辑推进（由 rAF 渲染循环每帧调用）：暂停 / 成就面板 / 死亡演出 /
 * FX.hitstop 卡帧期间冻结；否则向累加器存入帧间隔，攒满一个 gameSpeed
 * 就推进一格蛇移动（while 补帧处理低帧率场景，guard 上限防死亡螺旋）；
 * 蛇死亡或局内结算时清零累加器，使插值进度定格（蛇停在完整格位）
 * @param {number} dtMs 距上一帧的毫秒数（已由渲染层做 50ms 封顶）
 */
function updateLogic(dtMs) {
    if (!isRunning || isPaused || achPanelOpen || isDying || FX.frozen()) return;
    moveAcc += dtMs;
    let guard = 0;
    // 补帧循环：低帧率（如切后台回来）时单帧最多追 4 格，防逻辑雪崩
    while (moveAcc >= gameSpeed && guard < 4) {
        moveAcc -= gameSpeed;
        guard++;
        moveSnake();
        // 撞死 / 蛇占满全场结算：立即清零累加器，插值定格在当前格位
        if (isDying || !isRunning) {
            moveAcc = 0;
            break;
        }
    }
    if (guard >= 4) moveAcc = 0; // 追帧上限触发：丢弃积压，避免回来后连续瞬移
}

/** 上一渲染帧时间戳，用于计算 delta */
let lastRender = performance.now();
/** 渲染循环挂起标志：true 表示已向浏览器预约下一帧（后台节流挂起期间保持 true）；
 *  看门狗据此区分「循环存活」与「排程丢失/从未启动」 */
let loopWaiting = false;

/**
 * 渲染主循环（rAF 驱动，逻辑与渲染统一于此）：先按帧间隔推进逻辑累加器，
 * 再按累加进度计算蛇身插值系数；未暂停且未打开成就墙时推进
 * 粒子/飘字/闪白/死亡演出计时，随后逐帧重绘画面。
 * 解锁 toast 与成就墙均为 DOM 覆盖层，不参与画布绘制。
 * 自愈式结构：下一帧排程前置于帧逻辑，且帧逻辑整体 try/catch 兜底——
 * 任何一帧（逻辑推进/特效/绘制链）抛出的偶发异常都只跳过该帧，
 * 循环本身永不中断，下一帧自动全量重绘（静态背景层贴回不透明底色），
 * 杜绝旧版「调度在帧尾 → 单次异常永久停摆 → 画布空白纯黑需手动刷新」的缺陷
 * @param {number} now 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
 */
function renderLoop(now) {
    loopWaiting = false; // 进入本帧：清挂起标志（此刻到帧尾之间若异常也不会丢下一帧）
    requestAnimationFrame(renderLoop); // 前置排程：先预约下一帧，再执行本帧逻辑
    try {
        // 单帧步长上限 50ms：切走标签页再切回时，避免计时一次性跳变
        const dt = Math.min((now - lastRender) / 1000, 0.05);
        lastRender = now;
        updateLogic(dt * 1000); // 逻辑 tick 推进（内部自行处理暂停/卡帧/死亡冻结）
        // 蛇身插值进度：累加器占当前移动间隔的比例（定格时 t 冻结，蛇悬停在两格之间）
        const t = Math.min(1, moveAcc / gameSpeed);
        if (!isPaused && !achPanelOpen) updateEffects(dt); // 成就墙打开时同步冻结游戏特效（粒子/飘字等）
        draw(now, t); // 解锁 toast 与成就墙均为 DOM 覆盖层，不再参与画布绘制
    } catch (err) {
        // 帧级异常兜底：留痕后继续（下一帧已由前置排程预约，画面自动恢复重绘）
        console.error('[snake] 渲染帧异常（已跳过本帧，循环继续）:', err);
    }
    loopWaiting = true; // 本帧收尾：标记下一帧已预约（后台节流挂起期间保持 true）
}

// 难度恢复：页面加载时保持与上一次选择一致（默认中等，序号 2；无敌 0 / 简单 1 / 中等 2 / 困难 3；
// 加载时 AudioContext 尚未激活，selectDifficulty 中的 uiClick 无声，无害）
// 隐私模式 / 禁用站点数据时读取抛 SecurityError：try/catch 静默保持 NaN，走默认难度
let savedDifficultyIndex = NaN;
try {
    savedDifficultyIndex = parseInt(localStorage.getItem(DIFFICULTY_KEY), 10);
} catch (e) { /* 存储不可用时静默回退默认难度 */ }
if (!Number.isNaN(savedDifficultyIndex) && savedDifficultyIndex !== 2) {
    const savedDifficultyBtn = document.querySelectorAll('.difficulty-btn')[savedDifficultyIndex];
    if (savedDifficultyBtn) {
        // try/catch 兜底：此调用发生在渲染循环启动之前，一旦抛错（如旧缓存 audio.js 缺
        // SFX.uiClick）整个初始化链中断——rAF 与看门狗都不会注册，画布永久白屏无自愈机会
        try {
            selectDifficulty(savedDifficultyBtn);
        } catch (e) { /* 难度状态已就位仅缺一声点击音：静默继续初始化 */ }
    }
}

// ---------- 每日挑战（2026-11-04 新增）：按当日日期生成目标长度，达成后当日落盘 ----------
// 位置约束：必须位于下方 restoreSnapshot() 调用之前——续玩恢复成功路径会调用
// updateDailyGoal()，若其依赖的 const/let（dailyGoalElement 等）尚未初始化将触发
// TDZ ReferenceError，顶层脚本中断导致 rAF 与看门狗均未注册（无格无蛇无食物白屏）
/** 当日日期串 YYYYMMDD（本地时区，跨日自动换新目标） */
const DAILY_DATE = (() => {
    const d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
})();
/** 当日目标长度（蛇总节数，含蛇头）：15 + 日期哈希 % 16 → 每日 15~30 节不等 */
const DAILY_GOAL = (() => {
    let h = 0;
    for (let i = 0; i < DAILY_DATE.length; i++) h = (h * 31 + DAILY_DATE.charCodeAt(i)) >>> 0; // 多项式整数哈希
    return 15 + h % 16;
})();
/** 每日挑战达成落盘键（arcade_daily_snake_<YYYYMMDD>，值 '1'；当日已达成则不再重复演出） */
const DAILY_SNAKE_KEY = 'arcade_daily_snake_' + DAILY_DATE;
/** 每日目标 HUD 元素（STATS 面板「今日」行） */
const dailyGoalElement = document.getElementById('dailyGoal');
/** 当日是否已达成（读取失败按未达成处理，可重新达成） */
let dailyGoalDone = (() => {
    try { return localStorage.getItem(DAILY_SNAKE_KEY) === '1'; } catch (e) { return false; }
})();

/**
 * 刷新「今日」HUD 行并处理达成演出：显示 当前长度/目标，当日已达成则显示「达成 N」；
 * 首次达到目标长度时播破纪录号角 + 蛇头金色迸溅 + 飘字，并落盘当日达成标记
 */
function updateDailyGoal() {
    if (!dailyGoalElement) return; // HUD 行缺失时静默跳过
    if (dailyGoalDone) { dailyGoalElement.textContent = '达成 ' + DAILY_GOAL; return; }
    const len = snake.length;
    dailyGoalElement.textContent = len + '/' + DAILY_GOAL;
    if (len >= DAILY_GOAL) {
        dailyGoalDone = true;
        dailyGoalElement.textContent = '达成 ' + DAILY_GOAL;
        try { localStorage.setItem(DAILY_SNAKE_KEY, '1'); } catch (e) { /* 存储不可用时静默放弃 */ }
        SFX.newRecord(); // 复用破纪录号角：达成演出更醒目
        const headSeg = snake[0];
        if (headSeg) {
            const cx = headSeg.x * gridSize + gridSize / 2;
            const cy = headSeg.y * gridSize + gridSize / 2;
            spawnBurst(cx, cy, '#ffd23e', 26, 200); // 金色迸溅（复用粒子系统）
            floatTexts.push({ x: cx, y: cy - 6, text: '今日目标达成!', t: 0, color: '#ffd23e' });
        }
    }
}

// 进度镜像快照恢复：核心状态创建后、默认新局逻辑之前执行。
// 恢复成功 → 局面置为"运行中但暂停"，停在现有暂停遮罩等待玩家按空格续玩
// （防恢复即死），遮罩内追加"已恢复上次进度"提示；按空格走原有 togglePause 恢复运行。
// 恢复失败（无快照/快照非法已清除）→ 不做任何事，保持原有默认新开局流程（开始遮罩等待玩家）
if (restoreSnapshot()) {
    isRunning = true;
    isPaused = true;
    startScreen.style.display = 'none'; // 收起开始遮罩：进度已续玩，防止其与暂停遮罩叠放双显
    pauseScreen.style.display = 'block';
    pauseRestoredElement.style.display = 'block';
    updateDailyGoal(); // 续玩局同样显示每日目标进度
}

// 启动渲染循环（逻辑 tick 由循环内的 updateLogic 统一推进，开局默认未运行）
loopWaiting = true;
requestAnimationFrame(renderLoop);

/**
 * 判定画布是否从未成功绘制过（像素全透明）：静态背景层每帧以不透明底色
 * （#0f1a12）覆盖全画布，任何一帧成功绘制后画布即不再全透明；画布内容为空时
 * 露出 CSS 深色背景，表现为「纯黑无网格无蛇无食物」
 * @returns {boolean} 画布全透明或像素属性为零（从未绘制）返回 true
 */
function isCanvasBlank() {
    if (!canvas.width || !canvas.height) return true; // 像素属性为零：等同于从未绘制
    // 三点采样（左上/中心/右下），全部透明才判定空白，避免单点误判
    const w = canvas.width;
    const h = canvas.height;
    const points = [[2, 2], [w >> 1, h >> 1], [w - 3, h - 3]];
    for (let i = 0; i < points.length; i++) {
        if (ctx.getImageData(points[i][0], points[i][1], 1, 1).data[3] !== 0) return false;
    }
    return true;
}

// 渲染看门狗：每 2 秒巡检一次，仅当「循环无挂起帧（排程丢失或从未启动）且画布
// 从未绘制」时自动复活——重适配画布尺寸并重新拉起渲染循环，用户无需手动刷新。
// 双重条件保证不误判：后台节流挂起期间 loopWaiting 保持 true（存活）；画布保留
// 历史画面时 isCanvasBlank 为 false（渲染链曾正常工作，无「纯黑」问题）
setInterval(() => {
    if (loopWaiting) return;      // 下一帧已预约：循环存活，不干预
    if (!isCanvasBlank()) return; // 画布有历史画面：无「纯黑」问题，不干预
    console.warn('[snake] 看门狗：检测到渲染循环未启动/画布空白，自动复活');
    setupDisplay();               // 重适配画布尺寸（防零尺寸/像素属性残留）
    loopWaiting = true;
    requestAnimationFrame(renderLoop); // 重新拉起渲染循环，下一帧全量重绘
}, 2000);

// ---------- 游玩时长统计 + 键帽实时高亮（2026-11-04 新增，公共库 fx.js 能力） ----------
// FX.playtime：rAF 累计页面可见游玩时长，嵌入模式周期经 arcade:playtime 消息上报大厅累计落盘
// （键 arcade_playtime_snake），独立运行时由 fx.js 直写同一键；FX.KeyLight：点亮 KEYS 面板
// 中带 data-code 的键帽（window 级捕获委托，零侵入，reduced-motion 下无过渡）
// 二者均为装饰性公共库能力：分别 try/catch 兜底，浏览器持有旧缓存 fx.js（缺能力或
// API 形状不符）时静默跳过，绝不因尾部装饰调用抛错中断初始化收尾（KeyLight 不再注册）
try { FX.playtime.init('snake'); } catch (e) { /* 时长统计不可用：静默跳过 */ }
try { FX.KeyLight.init(); } catch (e) { /* 键帽高亮不可用：静默跳过 */ }
