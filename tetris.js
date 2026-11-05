/* ======================================================================
 * 俄罗斯方块 (TETRIS) —— 像素街机厅游戏逻辑
 * 10×20 棋盘 · 28px 单元格 · 7 种经典方块 · 幽灵投影落点预览
 * 机制：7-bag 随机袋 / Hold 暂存（C/Shift，每次落子限一次）/ NEXT 三块预览 /
 *      SRS 踢墙旋转（顺时针 ↑/W/X · 逆时针 Z）/ 触底锁定延迟 500ms（移动旋转可重置，上限 15 次）/
 *      DAS 150ms + ARR 30ms 自实现按键重复 / 危险分级警报音（冷却 2.5s）/
 *      连消 COMBO 加成（50×连击×等级）/ 累计成就三条（V 键查看）/
 *      T-Spin 判定（T 块旋入凹槽：四角占 3 + 最后动作为旋转，区分 FULL/MINI）/
 *      B2B 连锁（连续困难消行——Tetris 或 T-Spin 消行——得分 ×1.5）/
 *      All Clear 全消奖励（一次消行后棋盘清空追加高额奖励分）/
 *      软降 +1 分 / 硬降每格 +2 分；消行得分 × 等级 × 难度倍率；
 *      每 10 行升级并加速；难度决定初始下落速度与分数倍率；无敌档堆到顶时清空棋盘继续；
 *      最高分 localStorage 持久化；P 键暂停；切出窗口自动暂停
 * 特效：消行闪白演出 + 碎块粒子 + 阶梯 hitstop 卡帧 / 硬降残影 + 台面震动 + 落地 hitstop /
 *      TETRIS!（消 4 行）全屏白闪 + 中央大字 / LEVEL UP 大字 / ALL CLEAR 大字 + 白闪 /
 *      T-SPIN 技能飘字（FULL 亮紫 / MINI 灰蓝）/
 *      危险警报红光呼吸 / 锁定尘土粒子 / COMBO 连消飘字 / 破纪录全屏金色烟花
 * 依赖：audio.js 全局音效库 SFX；fx.js 画布 DPR 适配（FX.setupCanvas）与特效
 *      （FX.recordBurst / FX.hitstop 卡帧 / FX.prefersReduced 减弱动效降级）
 * ==================================================================== */

/* ===================== 画布与上下文 ===================== */

/** 主游戏画布（10×20 棋盘） */
const canvas = document.getElementById('gameCanvas');
/** 主画布 2D 绘图上下文（FX.setupCanvas 适配后坐标为 CSS 逻辑像素） */
const ctx = canvas.getContext('2d');
/** 后续方块预览画布（纵向依次绘制 3 块） */
const nextCanvas = document.getElementById('nextCanvas');
/** 预览画布 2D 绘图上下文 */
const nextCtx = nextCanvas.getContext('2d');
/** HOLD 暂存预览画布 */
const holdCanvas = document.getElementById('holdCanvas');
/** 暂存预览画布 2D 绘图上下文 */
const holdCtx = holdCanvas.getContext('2d');

// 网格参数：10 列 × 20 行，单元格 28px
const COLS = 10;
const ROWS = 20;
const CELL = 28;

// ---------- 画布逻辑尺寸常量（与 CSS 固定尺寸一致；DPR 适配后 canvas.width 为物理像素，绘制必须改用逻辑常量） ----------
const VIEW_W = COLS * CELL; // 主画布逻辑宽 280
const VIEW_H = ROWS * CELL; // 主画布逻辑高 560
const NEXT_W = 150;         // NEXT 预览画布逻辑宽
const NEXT_H = 240;         // NEXT 预览画布逻辑高（纵向 3 条预览带）
const HOLD_W = 150;         // HOLD 预览画布逻辑宽
const HOLD_H = 120;         // HOLD 预览画布逻辑高
const PREVIEW_CELL = 20;    // 预览画布小格子尺寸（小于主棋盘 CELL）
const NEXT_COUNT = 3;       // NEXT 预览方块数量

// 三块画布 DPR 适配：按 CSS 固定尺寸放大物理分辨率并锁定逻辑坐标系（可安全重复调用）
FX.setupCanvas(canvas);
FX.setupCanvas(nextCanvas);
FX.setupCanvas(holdCanvas);

// 7 种方块定义（matrix 为初始形状矩阵，1 表示实心格）
const PIECES = [
    { name: 'I', color: '#35e0ff', matrix: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { name: 'O', color: '#ffd23e', matrix: [[1, 1], [1, 1]] },
    { name: 'T', color: '#c17bff', matrix: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'S', color: '#39ff6a', matrix: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    { name: 'Z', color: '#ff3ea5', matrix: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    { name: 'J', color: '#4d79ff', matrix: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'L', color: '#ff9a3e', matrix: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] }
];

// 消行得分表（下标为一次消除的行数：单消 100 / 双消 300 / 三消 500 / 四消 800；得分 = 表值 × 当前等级 × 难度倍率）
const LINE_SCORES = [0, 100, 300, 500, 800];

// ---------- T-Spin / B2B / All Clear 计分表（得分 = 表值 × 当前等级 × 难度倍率，与消行分公式一致） ----------
// T-Spin 得分表（下标为同时消除的行数：0 行 400 / 单消 800 / 双消 1200 / 三消 1600）
const TSPIN_SCORES = [400, 800, 1200, 1600];
// Mini T-Spin 得分表（下标为同时消除的行数：0 行 100 / 单消 200 / 双消 400；三消在 Mini 判定下实际不可能出现，补 0 占位）
const MINI_TSPIN_SCORES = [100, 200, 400, 0];
// All Clear 全消奖励表（下标为触发全消的行数：单消 800 / 双消 1200 / 三消 1800 / 四消 2000）
const PC_SCORES = [800, 1200, 1800, 2000];

// ---------- 游戏状态 ----------
let board = createBoard();   // 固定方块网格，0 空、1-7 对应 PIECES 索引 + 1
let piece = null;            // 当前方块 { x, y, rot, typeIndex, matrix }
let nextQueue = [];          // 后续方块类型队列（长度恒为 NEXT_COUNT=3，供 NEXT 预览）
let bag = [];                // 7-bag 随机袋：洗牌后的方块索引，弹空重洗
let holdType = -1;           // HOLD 暂存方块类型索引（-1 = 暂存区为空）
let holdUsed = false;        // 本次落子是否已使用过 Hold（每次落子仅可换一次）
let score = 0;               // 当前分数
let level = 1;               // 当前等级
let totalLines = 0;          // 累计消除行数
let dropInterval = 600;      // 下落间隔（毫秒），随等级缩短
let dropBase = 600;          // 难度决定的初始下落间隔
let scoreMult = 2;           // 难度决定的分数倍率
/** 是否无敌模式：新生成方块与堆叠重叠（堆到顶）时清空棋盘继续游戏，而非结束游戏 */
let invincibleMode = false;
/** 难度选择存档键（localStorage），页面加载时恢复上一次选择 */
const DIFFICULTY_KEY = 'tetrisDifficulty';
let dropCounter = 0;         // 下落计时累加器
let lastTime = 0;            // 上一帧时间戳
let running = false;         // 游戏是否进行中
let paused = false;          // 是否暂停
let highScore = 0; // 最高分持久化（读取失败回退 0）
// 隐私模式 / 禁用站点数据时 localStorage 读取抛 SecurityError：try/catch 静默回退 0，不中断初始化
try {
    highScore = parseInt(localStorage.getItem('tetrisHighScore')) || 0;
} catch (e) { /* 存储不可用时静默回退默认值 */ }

// ---------- T-Spin / B2B 状态 ----------
let lastActionRotate = false; // 锁定前最后一次成功操作是否为旋转（T-Spin 判定前提：移动/下落会清零，仅旋转置真）
let lastKickIndex = -1;       // 最后一次成功旋转使用的踢墙偏移序号（4 = TST 大位移 kick，可将 Mini 升级为 Full）
let b2bActive = false;        // B2B 连锁状态：上一次消行是否为困难消行（Tetris 或 T-Spin 消行），普通消行断链

// ---------- 锁定延迟 / DAS-ARR / 危险警报参数 ----------
const LOCK_DELAY = 500;      // 方块触底后的锁定延迟（毫秒）
const MAX_LOCK_RESETS = 15;  // 同一方块因移动/旋转重置锁定计时的最大次数
const DAS_DELAY = 150;       // 按住方向键的初段延迟（毫秒），过后进入自动重复
const ARR_INTERVAL = 30;     // 自动重复阶段每格移动间隔（毫秒）
const ALARM_COOLDOWN = 2500; // 危险警报音效冷却（毫秒）
let lockTimer = 0;           // 锁定延迟计时累加器（毫秒）
let lockResets = 0;          // 当前方块已重置锁定计时的次数
let alarmCooldownUntil = 0;  // 危险警报冷却截止时间戳（毫秒，与 rAF 时间戳同源）

// ---------- DAS/ARR 按键重复状态 ----------
let leftHeld = false;  // 左方向键是否按住
let rightHeld = false; // 右方向键是否按住
let activeDir = 0;     // 当前 DAS 驱动方向（-1 左 / 1 右 / 0 无）
let dasTimer = 0;      // DAS 初段延迟计时（毫秒）
let arrTimer = 0;      // ARR 自动重复计时（毫秒）

// ---------- 特效状态 ----------
const CLEAR_FX_TIME = 0.35; // 消行闪白演出时长（秒）
const TRAIL_TIME = 0.15;    // 硬降残影存活时长（秒）
const BIGTEXT_TIME = 1.2;   // 中央大字存活时长（秒）
const PARTICLE_GRAVITY = 320; // 粒子重力（像素/秒²）
let clearing = null;        // 消行演出状态 { rows: 满行行号数组, timer: 剩余秒数 }
// 粒子池（消行碎块 / 锁定尘土）{ x, y, vx, vy, life, maxLife, color, size }：预分配零分配复用，满员自动征用最旧粒子
const particlePool = new FX.Pool(240, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 3 }));
let trails = [];            // 硬降残影 { matrix, x, y0, typeIndex, t }
let shakeTime = 0;          // 台面震动剩余时间（秒）
let flashTime = 0;          // 全屏白闪剩余时间（秒）
let bigText = null;         // 中央大字 { text, t }（TETRIS! / LEVEL UP）
const DANGER_ROWS = 4;      // 堆叠最高点进入顶部该行数范围内即触发危险警报
const COMBO_TIME = 0.9;     // COMBO 连消飘字存活时长（秒）
let comboCount = 0;         // 连续消行计数（落块未消行即断连清零）
let comboText = null;       // 连消飘字 { text, t }
const CLEARTEXT_TIME = 0.9; // 消行得分飘字存活时长（秒）
let clearText = null;       // 消行得分飘字 { text, t }
const SPINTEXT_TIME = 1.0;  // T-SPIN 技能飘字存活时长（秒）
let spinText = null;        // T-SPIN 技能飘字 { text, t, mini }（mini 为 true 时灰蓝小字）
const DEATH_FADE_TIME = 0.7; // 堆顶死亡灰暗渐隐时长（秒）
let deathFadeTime = 0;      // 死亡渐隐剩余时间（秒），>0 时结算面板尚未弹出

// ---------- DOM 引用 ----------
const scoreEl = document.getElementById('scoreVal');
const levelEl = document.getElementById('levelVal');
const linesEl = document.getElementById('linesVal');
const highEl = document.getElementById('highVal');
const startScreen = document.getElementById('startScreen');
const pauseScreen = document.getElementById('pauseScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const newRecordEl = document.getElementById('newRecord');
const achWall = document.getElementById('achWall');      // 成就墙全屏遮罩层
const achGrid = document.getElementById('achGrid');      // 成就卡片网格容器
const achCountEl = document.getElementById('achCount');  // 已解锁成就计数
const achTotalEl = document.getElementById('achTotal');  // 成就总数
const achBarFill = document.getElementById('achBarFill'); // 头部完成度进度条填充
const pauseRestoredEl = document.getElementById('pauseRestored'); // 暂停遮罩「已恢复上次进度」提示行

/**
 * 创建空白棋盘
 * @returns {number[][]} ROWS × COLS 的全 0 二维数组
 */
function createBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

/**
 * 7-bag 随机袋抽取：把 7 种方块各一次装入袋中用 Fisher-Yates 洗牌，
 * 依次弹出保证每 7 块内 7 种各出现一次；袋空则重新洗牌装填（标准 7-bag 规则）
 * @returns {number} 0-6，对应 PIECES 下标
 */
function drawFromBag() {
    // 袋空：重新装入全部 7 种方块索引
    if (bag.length === 0) {
        for (let i = 0; i < PIECES.length; i++) bag.push(i);
        // Fisher-Yates 洗牌：从尾向前，每步与随机位置交换
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    return bag.pop();
}

/**
 * 生成新方块并置于顶部居中，出生位置被占（堆到顶）时游戏结束；
 * 无敌模式例外：清空整个棋盘后正常生成，游戏继续；
 * 传入 forcedType（Hold 换块）时不消费 NEXT 队列，直接以指定类型生成
 * @param {number} [forcedType] 强制使用的方块类型索引（Hold 换块用），缺省时从 NEXT 队列头部消费
 */
function spawnPiece(forcedType) {
    // forcedType 有效时直接采用（Hold 换块）；否则消费 NEXT 队列头部并从 7-bag 补充队尾
    const consume = forcedType === undefined || forcedType === null;
    const type = consume ? nextQueue.shift() : forcedType;
    if (consume) nextQueue.push(drawFromBag());
    piece = {
        x: 0,
        y: 0,
        rot: 0, // SRS 旋转状态（0-3）
        typeIndex: type,
        matrix: PIECES[type].matrix
    };
    // 水平居中
    piece.x = Math.floor((COLS - piece.matrix[0].length) / 2);
    // 重置锁定延迟与新块专属状态
    lockTimer = 0;
    lockResets = 0;
    holdUsed = false;
    lastActionRotate = false; // 新块未发生过旋转，T-Spin 前提清零
    lastKickIndex = -1;       // 踢墙序号同步清零
    drawNext();
    // 出生位置即冲突说明堆到顶了
    if (collide(piece.x, piece.y, piece.matrix)) {
        if (invincibleMode) {
            // 无敌模式：不结束游戏，清空整个棋盘后照常放置，游戏继续
            clearBoard();
        } else {
            // 普通难度：堆顶死亡演出——立即停机并灰暗渐隐 0.7s，播完再弹结算面板
            running = false;
            deathFadeTime = DEATH_FADE_TIME;
        }
    }
}

/**
 * 无敌模式专用：清空整个棋盘（移除所有堆叠方块），使新方块得以在出生位置正常放置，游戏继续；
 * 不加分、不计入总行数，避免无敌档借此刷分
 */
function clearBoard() {
    board = board.map(row => new Array(COLS).fill(0));
}

/**
 * 碰撞检测：方块矩阵在指定位置是否与边界或已固定块冲突
 * @param {number} x 方块左上角列坐标（可为负）
 * @param {number} y 方块左上角行坐标（可为负，顶部以上视为合法）
 * @param {number[][]} matrix 方块矩阵
 * @returns {boolean} 是否冲突
 */
function collide(x, y, matrix) {
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
            if (!matrix[r][c]) continue; // 空格跳过
            const bx = x + c;
            const by = y + r;
            // 左右越界或触底
            if (bx < 0 || bx >= COLS || by >= ROWS) return true;
            // 顶部以上不检测（允许方块从界外入场）
            if (by >= 0 && board[by][bx]) return true;
        }
    }
    return false;
}

/**
 * 将当前方块写入棋盘（锁定）
 */
function merge() {
    for (let r = 0; r < piece.matrix.length; r++) {
        for (let c = 0; c < piece.matrix[r].length; c++) {
            if (!piece.matrix[r][c]) continue;
            const by = piece.y + r;
            if (by >= 0) board[by][piece.x + c] = piece.typeIndex + 1;
        }
    }
}

/**
 * 查找棋盘上所有已填满的行
 * @returns {number[]} 满行行号数组（升序，可能为空）
 */
function findFullRows() {
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
        if (board[r].every(v => v !== 0)) rows.push(r);
    }
    return rows;
}

/**
 * 在指定位置喷出一组粒子（消行演出用）
 * @param {number} px 粒子出生点像素 x 坐标
 * @param {number} py 粒子出生点像素 y 坐标
 * @param {string} color 粒子颜色
 * @param {number} count 粒子数量
 */
function spawnParticles(px, py, color, count) {
    if (FX.prefersReduced) return; // 减弱动效：跳过粒子特效
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;      // 均匀圆周散射方向
        const spd = 60 + Math.random() * 120;          // 随机初速
        const p = particlePool.obtain();               // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = px;
        p.y = py;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 60;               // 轻微上抛，落点更好看
        p.life = 0.4 + Math.random() * 0.3;            // 0.4 ~ 0.7 秒寿命
        p.maxLife = p.life;
        p.color = color;
        p.size = 3 + Math.random() * 3;
    }
}

/**
 * 方块锁定时在其支撑格底边冒出尘土粒子（灰白色、低速上扬、短寿命），
 * 强化"砸落到堆积层"的触地手感
 */
function spawnDust() {
    if (FX.prefersReduced) return; // 减弱动效：跳过尘土粒子
    // 扫描方块矩阵：实心格且正下方无同类实心格（即直接接触地面/堆积层）视为支撑格
    for (let r = 0; r < piece.matrix.length; r++) {
        for (let c = 0; c < piece.matrix[r].length; c++) {
            if (!piece.matrix[r][c]) continue;
            const supported = r + 1 >= piece.matrix.length || !piece.matrix[r + 1][c];
            if (!supported) continue;
            // 每个支撑格底边冒 2 粒尘土：左右少量外扩 + 向上小抛
            for (let i = 0; i < 2; i++) {
                const p = particlePool.obtain();       // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
                p.x = (piece.x + c + 0.5) * CELL + (Math.random() - 0.5) * CELL * 0.6;
                p.y = (piece.y + r + 1) * CELL - 2;
                p.vx = (Math.random() - 0.5) * 90;
                p.vy = -30 - Math.random() * 60;
                p.life = 0.22 + Math.random() * 0.18;
                p.maxLife = p.life;
                p.color = '#8f9ab0';
                p.size = 2 + Math.random() * 2;
            }
        }
    }
}

/**
 * 推进全部特效计时与粒子物理（暂停时冻结，游戏结束后余韵继续播完）
 * @param {number} dt 本帧时间增量（秒）
 */
function updateEffects(dt) {
    shakeTime = Math.max(0, shakeTime - dt);
    flashTime = Math.max(0, flashTime - dt);
    // 中央大字倒计时
    if (bigText) {
        bigText.t -= dt;
        if (bigText.t <= 0) bigText = null;
    }
    // 连消飘字倒计时
    if (comboText) {
        comboText.t -= dt;
        if (comboText.t <= 0) comboText = null;
    }
    // 消行得分飘字倒计时
    if (clearText) {
        clearText.t -= dt;
        if (clearText.t <= 0) clearText = null;
    }
    // T-SPIN 技能飘字倒计时
    if (spinText) {
        spinText.t -= dt;
        if (spinText.t <= 0) spinText = null;
    }
    // 硬降残影衰减（倒序遍历便于 splice）
    for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].t -= dt;
        if (trails[i].t <= 0) trails.splice(i, 1);
    }
    // 粒子物理：重力 + 位移 + 寿命（池活跃区正向遍历，sweep 回收死粒零分配）
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        p.life -= dt;
        p.vy += PARTICLE_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    particlePool.sweep();
}

// ---------- T-Spin 判定 ----------
// T 块各旋转态的"前角"偏移（相对 T 中心格 (1,1)：前角 = T 凸头指向一侧的两格）
// 下标为 piece.rot：rot0 朝上 / rot1 朝右 / rot2 朝下 / rot3 朝左
const T_FRONT_CORNERS = [
    [[-1, -1], [1, -1]],  // rot0 朝上：上左 + 上右
    [[1, -1], [1, 1]],    // rot1 朝右：右上 + 右下
    [[-1, 1], [1, 1]],    // rot2 朝下：下左 + 下右
    [[-1, -1], [-1, 1]]   // rot3 朝左：左上 + 左下
];

/**
 * 查询棋盘格占用状态（T-Spin 四角判定专用）：
 * 顶部以上（y < 0）视为开放未占用，左右出墙与触底视为占用
 * @param {number} cx 列坐标
 * @param {number} cy 行坐标
 * @returns {boolean} 该格是否被占用
 */
function occupied(cx, cy) {
    if (cy < 0) return false;                              // 顶部以上开放（允许 T 头探出天井）
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;   // 出墙 / 触底视为占用
    return board[cy][cx] !== 0;
}

/**
 * T-Spin 判定（Tetris Guideline 简化版），必须在 merge 之前调用：
 * 条件① 当前为 T 块（typeIndex === 2）；② 锁定前最后一次成功操作是旋转；
 * ③ 锁定时 T 中心四角（(±1,±1) 偏移）至少 3 格被占；
 * 四角中被占 ≥3 即成立；前两角都被占 → Full，否则 Mini；
 * 例外：最后一次旋转使用了踢墙表第 5 偏移（序号 4，TST 大位移 kick）→ 直接升级为 Full
 * @returns {{mini: boolean}|null} 成立时返回 { mini }，不成立返回 null
 */
function detectTSpin() {
    if (piece.typeIndex !== 2 || !lastActionRotate) return null;
    const cx = piece.x + 1, cy = piece.y + 1; // T 中心格（3×3 矩阵的 (1,1)）
    // 四角占用统计
    let filled = 0;
    if (occupied(cx - 1, cy - 1)) filled++;
    if (occupied(cx + 1, cy - 1)) filled++;
    if (occupied(cx - 1, cy + 1)) filled++;
    if (occupied(cx + 1, cy + 1)) filled++;
    if (filled < 3) return null; // 四角占不足 3：非 T-Spin
    // 前两角均被占 → Full；仅一前角（靠后角凑数）→ Mini；TST 大位移 kick 强制升 Full
    const front = T_FRONT_CORNERS[piece.rot];
    const isFull = (occupied(cx + front[0][0], cy + front[0][1]) && occupied(cx + front[1][0], cy + front[1][1])) || lastKickIndex === 4;
    return { mini: !isFull };
}

/**
 * 锁定方块 → 检测满行：
 * 有满行则进入闪白演出状态（延迟结算），否则直接生成下一块；
 * 锁定前先做 T-Spin 判定（需 merge 前的棋盘与方块姿态）
 */
function lockPiece() {
    const spin = detectTSpin(); // merge 前判定 T-Spin
    if (spin) {
        // T-Spin 达成：飘字（Full 亮紫 / Mini 灰蓝）+ 专属音效 + Full 轻震
        spinText = { text: spin.mini ? 'T-SPIN MINI' : 'T-SPIN', t: SPINTEXT_TIME, mini: spin.mini };
        SFX.tSpin();
        if (!spin.mini && !FX.prefersReduced) shakeTime = Math.max(shakeTime, 0.12);
    }
    merge();
    spawnDust(); // 落定尘土：砸到堆积层的手感反馈
    SFX.tLock();
    const rows = findFullRows();
    if (rows.length > 0) {
        // 连续消行计数：从第 2 连开始弹 COMBO 飘字
        comboCount++;
        if (comboCount >= 2) comboText = { text: 'COMBO ×' + comboCount, t: COMBO_TIME };
        // 进入消行演出：闪白 CLEAR_FX_TIME 秒后由 finishClear 实际删行结算（携带 T-Spin 信息供计分）
        clearing = { rows, timer: CLEAR_FX_TIME, spin };
        SFX.tClear(rows.length);
        if (rows.length === 4) {
            // 一次消 4 行（TETRIS）：台面震动 + 全屏白闪（减弱动效时跳过）+ 中央大字庆祝
            if (!FX.prefersReduced) {
                shakeTime = 0.25;
                flashTime = 0.3;
            }
            bigText = { text: 'TETRIS!', t: BIGTEXT_TIME };
        }
    } else {
        comboCount = 0; // 落块未消行，连消断连（B2B 链不受影响：T-Spin 0 行 / 普通落块均不断链）
        if (spin) {
            // T-Spin 无消行：仍发放 0 行基础分（不消行不动 B2B 链状态）
            const gained = (spin.mini ? MINI_TSPIN_SCORES[0] : TSPIN_SCORES[0]) * level * scoreMult;
            score += gained;
            clearText = { text: `+${gained}`, t: CLEARTEXT_TIME };
            updateHud();
        }
        spawnPiece();
    }
}

/**
 * 消行演出结束：喷粒子 → hitstop 卡帧 → 删行 → 计分（T-Spin 表 / B2B 连锁 / COMBO / All Clear）升级 → 生成下一块
 */
function finishClear() {
    const rows = clearing.rows;
    const spin = clearing.spin; // 本次消行是否伴随 T-Spin（lockPiece 判定结果，无 T-Spin 为 null）
    clearing = null;
    // 删行前为满行每格喷出 2 个粒子（颜色取原方块色，保留消行前的画面记忆）
    for (const r of rows) {
        for (let c = 0; c < COLS; c++) {
            spawnParticles((c + 0.5) * CELL, (r + 0.5) * CELL, PIECES[board[r][c] - 1].color, 2);
        }
    }
    // hitstop 卡帧：按消行数阶梯定格（单消 45 / 双消 60 / 三消 75ms，Tetris 四消 90ms 最重，T-Spin 追加 20ms），
    // 粒子迸发瞬间画面定格放大打击感（FX 内部自带减弱动效守卫）
    FX.hitstop(rows.length === 4 ? 90 : 30 + rows.length * 15 + (spin ? 20 : 0));
    // 从大到小删行（删除点之后的行才前移，降序删除不影响更小行号），全部删完后统一在顶部补空行，
    // 避免「删一行补一行」交替进行导致行号位移、残留未删除的满行
    const sorted = [...rows].sort((a, b) => b - a);
    for (const r of sorted) board.splice(r, 1);
    for (let i = 0; i < sorted.length; i++) board.unshift(new Array(COLS).fill(0));
    // 基础分：T-Spin 消行走专属计分表，普通消行走消行表（均 × 等级 × 难度倍率）
    let gained = (spin
        ? (spin.mini ? MINI_TSPIN_SCORES[rows.length] : TSPIN_SCORES[rows.length])
        : LINE_SCORES[rows.length]) * level * scoreMult;
    // B2B 连锁：本次为困难消行（Tetris 或 T-Spin 消行）且链已激活 → 得分 ×1.5（向下取整）
    const difficult = rows.length === 4 || !!spin;
    let b2bNow = false; // 本次是否实际触发 B2B 加成（供飘字标注）
    if (difficult) {
        if (b2bActive) {
            gained = Math.floor(gained * 1.5);
            b2bNow = true;
            SFX.comboUp(comboCount); // 连锁达成：复用连击上扬音效
        }
        b2bActive = true;  // 困难消行：建立或延续 B2B 链
    } else {
        b2bActive = false; // 普通消行（1~3 行非 T-Spin）：断链
    }
    // COMBO 连消加成：连击数 ≥2 时追加 50 × 连击 × 等级，并播连击音效
    if (comboCount >= 2) {
        gained += 50 * comboCount * level;
        if (!b2bNow) SFX.comboUp(comboCount); // B2B 已播过连锁音效时避免同帧重复
    }
    // All Clear 全消检测：删行后棋盘全空 → 追加全消奖励分 + 大字 + 白闪 + 专属音效
    let isAllClear = true;
    for (const row of board) {
        if (row.some(v => v !== 0)) { isAllClear = false; break; }
    }
    if (isAllClear) gained += PC_SCORES[rows.length - 1] * level * scoreMult;
    score += gained;
    clearText = { text: `+${gained}` + (b2bNow ? ' B2B' : ''), t: CLEARTEXT_TIME }; // 得分飘字（B2B 触发时追加标注）
    if (isAllClear) {
        bigText = { text: 'ALL CLEAR', t: BIGTEXT_TIME };
        if (!FX.prefersReduced) flashTime = Math.max(flashTime, 0.35); // 全屏白闪（减弱动效时跳过）
        SFX.allClear();
    }
    totalLines += rows.length;
    // 每 10 行升 1 级，下落加快（以难度初始速度为基准递减）
    const newLevel = Math.floor(totalLines / 10) + 1;
    if (newLevel > level) {
        level = newLevel;
        dropInterval = Math.max(80, dropBase - (level - 1) * 60); // 每升 1 级间隔缩短 60ms，下限 80ms
        bigText = { text: 'LEVEL UP', t: BIGTEXT_TIME };
        SFX.tLevelUp();
    }
    // 成就数据上报：累计消行 / 单次消行峰值 / 当前等级（trackRunStat 达标即自动解锁对应成就）
    trackRunStat('lines', totalLines);
    trackRunStat('maxRows', rows.length);
    trackRunStat('level', level);
    updateHud();
    spawnPiece();
}

/**
 * 矩阵顺时针旋转 90°（转置 + 行反转），返回新矩阵不修改原矩阵
 * @param {number[][]} m 原矩阵
 * @returns {number[][]} 旋转后的新矩阵
 */
function rotate(m) {
    const rows = m.length;
    const cols = m[0].length;
    const res = Array.from({ length: cols }, () => new Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            res[c][rows - 1 - r] = m[r][c];
        }
    }
    return res;
}

/**
 * 矩阵逆时针旋转 90°（转置 + 列反转），返回新矩阵不修改原矩阵
 * @param {number[][]} m 原矩阵
 * @returns {number[][]} 旋转后的新矩阵
 */
function rotateCCW(m) {
    const rows = m.length;
    const cols = m[0].length;
    const res = Array.from({ length: cols }, () => new Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            res[cols - 1 - c][r] = m[r][c];
        }
    }
    return res;
}

// ---------- SRS 踢墙表（收录顺时针与逆时针各 4 个转换，共 8 组） ----------
// 表值为 SRS 惯例坐标（x 右正、y 上正）；本画布 y 轴向下增长，应用时 dy 需取反
/** JLSTZ（T/S/Z/J/L）共用踢墙偏移表，键为「起始态>目标态」（1>0 / 2>1 / 3>2 / 0>3 为逆时针转换） */
const SRS_KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};
/** I 型专用踢墙偏移表（SRS 中 I 型拥有独立的一套偏移；1>0 / 2>1 / 3>2 / 0>3 为逆时针转换） */
const SRS_KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

/**
 * 旋转当前方块（标准 SRS 踢墙，支持顺/逆时针）：
 * O 型不旋转；I 型用独立踢墙表，JLSTZ 共用一套；按「起始态>目标态」依次尝试 5 组偏移，
 * 每组先平移再旋转，全部失败则保持原状；
 * 成功后记录 lastActionRotate / lastKickIndex（T-Spin 判定依据，逆时针旋转同样计入）
 * @param {number} [dir=1] 旋转方向（1 顺时针 / -1 逆时针）
 */
function rotatePiece(dir = 1) {
    if (piece.typeIndex === 1) return; // O 型：旋转无意义，直接跳过
    const from = piece.rot;
    const to = (from + dir + 4) % 4; // 方向化 4 态循环（dir=-1 逆时针回退，+4 防负下标）
    const rotated = dir > 0 ? rotate(piece.matrix) : rotateCCW(piece.matrix);
    const table = piece.typeIndex === 0 ? SRS_KICKS_I : SRS_KICKS_JLSTZ;
    const kicks = table[from + '>' + to];
    for (let ki = 0; ki < kicks.length; ki++) { // 带序号遍历：成功序号供 T-Spin 升级判定
        const k = kicks[ki];
        const dx = k[0];
        const dy = -k[1]; // SRS 惯例 y 上正，画布 y 向下增长，取反
        if (!collide(piece.x + dx, piece.y + dy, rotated)) {
            piece.matrix = rotated;
            piece.x += dx;
            piece.y += dy;
            piece.rot = to;
            lastActionRotate = true; // 最后一次成功操作 = 旋转（移动/下落会清零）
            lastKickIndex = ki;      // 记录使用的踢墙偏移序号（4 = TST 大位移）
            SFX.tRotate();
            resetLockDelay(); // 锁定延迟期内旋转成功：重置锁定计时
            return;
        }
    }
}

/**
 * 自然下落一格；触底后不再立即锁定，交由主循环的锁定延迟计时处理
 */
function drop() {
    if (!collide(piece.x, piece.y + 1, piece.matrix)) {
        piece.y++;
        lockTimer = 0;           // 离开触底状态，清空锁定计时
        lastActionRotate = false; // 成功下落：清除旋转标志（最后动作不再是旋转）
    }
}

/**
 * 软降：手动下移一格得 1 分；触底时不立即锁定，等待锁定延迟自然结算
 */
function softDrop() {
    if (!collide(piece.x, piece.y + 1, piece.matrix)) {
        piece.y++;
        score++;
        SFX.tMove();
        lockTimer = 0;            // 离开触底状态，清空锁定计时
        lastActionRotate = false; // 成功下落：清除旋转标志
        dropCounter = 0; // 重置计时，避免同一帧再次自然下落
        updateHud();
    }
}

/**
 * 计算幽灵投影（落点预览）所在行
 * @returns {number} 从当前位置直落到底的行坐标
 */
function ghostDropY() {
    let y = piece.y;
    while (!collide(piece.x, y + 1, piece.matrix)) y++;
    return y;
}

/**
 * 硬降：瞬间落底，每降 1 格得 2 分，留下运动残影并震动台面（+落地 hitstop 卡帧），随后立即锁定
 */
function hardDrop() {
    const gy = ghostDropY();
    // 记录起始位置的残影（随时间渐隐），营造高速坠落的运动感（减弱动效时跳过）
    if (!FX.prefersReduced) {
        trails.push({ matrix: piece.matrix, x: piece.x, y0: piece.y, typeIndex: piece.typeIndex, t: TRAIL_TIME });
    }
    score += (gy - piece.y) * 2;
    if (gy !== piece.y) lastActionRotate = false; // 实际发生位移才清旋转标志（原地硬降保留，支持「旋转 + 硬降」T-Spin）
    piece.y = gy;
    dropCounter = 0;
    if (!FX.prefersReduced) shakeTime = 0.18; // 落地震动（减弱动效时跳过）
    FX.shake(canvas, 3, 200); // 画布级震动（2026-11-04 新增）：CSS transform 抖动整个画布，与台面内部震动叠加强化硬降冲击（FX 内部自带减弱动效守卫）
    FX.hitstop(20); // 落地 hitstop：定格 1~2 帧增强硬降打击感（FX 内部自带减弱动效守卫）
    SFX.tDrop();
    lockPiece(); // 硬降：跳过锁定延迟，立即锁定
}

/**
 * 重置锁定延迟计时（触底状态下移动/旋转成功时调用）：
 * 同一方块最多重置 MAX_LOCK_RESETS 次，防止无限拖延锁定
 */
function resetLockDelay() {
    if (lockResets >= MAX_LOCK_RESETS) return; // 次数耗尽：不再重置，触底后按时锁定
    lockTimer = 0;
    // 仅触底状态下移动/旋转才消耗重置次数；离地时计时本就为 0，无需消耗
    if (collide(piece.x, piece.y + 1, piece.matrix)) lockResets++;
}

/**
 * 水平移动当前方块一格
 * @param {number} dir 移动方向（-1 左 / 1 右）
 * @returns {boolean} 是否移动成功（撞墙返回 false）
 */
function tryMoveH(dir) {
    if (collide(piece.x + dir, piece.y, piece.matrix)) return false;
    piece.x += dir;
    lastActionRotate = false; // 成功平移：清除旋转标志（最后动作不再是旋转）
    SFX.tMove();
    resetLockDelay(); // 锁定延迟期内移动成功：重置锁定计时
    return true;
}

/**
 * Hold 暂存换块：把当前方块存入暂存区并取出暂存块（暂存区为空则直接取下一块）；
 * 每次落子仅可换一次（holdUsed 标记），换块后重绘暂存预览
 */
function holdPiece() {
    if (holdUsed || !running || paused || clearing) return;
    SFX.tRotate(); // 换块音效
    const current = piece.typeIndex;
    if (holdType === -1) {
        // 暂存区为空：存入当前块，从 NEXT 队列取新块
        holdType = current;
        spawnPiece();
    } else {
        // 暂存区有块：与当前块交换
        const swap = holdType;
        holdType = current;
        spawnPiece(swap);
    }
    holdUsed = true; // 本次落子已使用 Hold（在 spawnPiece 之后置位，避免被其重置）
    drawHold();
}

/**
 * 启动 DAS 按键重复：立即移动一格并开始初段延迟计时
 * @param {number} dir 移动方向（-1 左 / 1 右）
 */
function startDAS(dir) {
    tryMoveH(dir);
    activeDir = dir;
    dasTimer = 0;
    arrTimer = 0;
}

/**
 * 松开方向键：更新按住状态；若松开的是 DAS 驱动方向，
 * 则切回另一按住方向重新计时，否则停止自动重复
 * @param {number} dir 松开的方向（-1 左 / 1 右）
 */
function releaseDir(dir) {
    if (dir < 0) leftHeld = false; else rightHeld = false;
    if (activeDir === dir) {
        if (leftHeld) startDAS(-1);
        else if (rightHeld) startDAS(1);
        else activeDir = 0;
    }
}

/**
 * 推进 DAS/ARR 自动重复状态机：
 * 初段 DAS_DELAY 内不动作；达成瞬间立即移动一格，之后每 ARR_INTERVAL 移动一格；
 * 撞墙时清零 ARR 计时，等待方向变化或松键
 * @param {number} deltaMs 本帧时间增量（毫秒）
 */
function updateDAS(deltaMs) {
    if (activeDir === 0) return;
    dasTimer += deltaMs;
    if (dasTimer < DAS_DELAY) return; // 初段延迟未达成
    if (arrTimer === 0) arrTimer = ARR_INTERVAL; // DAS 达成的第一帧：置满 ARR 计时实现"立即移动一格"
    arrTimer += deltaMs;
    while (arrTimer >= ARR_INTERVAL) {
        arrTimer -= ARR_INTERVAL;
        if (!tryMoveH(activeDir)) {
            arrTimer = 0; // 顶墙：停止本帧继续尝试
            break;
        }
    }
}

/**
 * 危险分级警报检查：堆叠最高点进入顶部 2 行播 2 级警报，
 * 进入顶部 DANGER_ROWS(4) 行播 1 级警报；音效冷却 ALARM_COOLDOWN 毫秒
 * @param {number} now 当前帧时间戳（毫秒，与 rAF 时间戳同源）
 */
function checkDangerAlarm(now) {
    const top = stackTopRow();
    let lvl = 0;
    if (top <= 1) lvl = 2;             // 堆到顶部 2 行以内：2 级（急迫）
    else if (top < DANGER_ROWS) lvl = 1; // 进入顶部 4 行：1 级（警示）
    if (lvl === 0) return;
    if (now < alarmCooldownUntil) return; // 冷却中：不重复播报
    alarmCooldownUntil = now + ALARM_COOLDOWN;
    SFX.alarm(lvl);
}

/**
 * 绘制单个发光格子（主体色 + 顶部高光 + 底部暗边）
 * @param {CanvasRenderingContext2D} context 目标画布上下文
 * @param {number} px 像素 x 坐标
 * @param {number} py 像素 y 坐标
 * @param {string} color 格子颜色
 * @param {number} [cellSize] 格子尺寸（预览画布用小格，缺省为主棋盘 CELL）
 */
function drawCell(context, px, py, color, cellSize) {
    const s = cellSize || CELL; // 缺省用主棋盘格子尺寸（预览画布传 PREVIEW_CELL 小格）
    context.fillStyle = color;
    context.fillRect(px, py, s - 1, s - 1);
    // 顶部高光
    context.fillStyle = 'rgba(255,255,255,0.28)';
    context.fillRect(px + 2, py + 2, s - 6, 3);
    // 底部暗边，增强立体感
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.fillRect(px + 2, py + s - 6, s - 6, 3);
}

/**
 * 在指定偏移处绘制整个方块矩阵
 * @param {number[][]} matrix 方块矩阵
 * @param {number} offsetX 列偏移
 * @param {number} offsetY 行偏移
 * @param {string} color 格子颜色
 */
function drawMatrix(matrix, offsetX, offsetY, color) {
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
            if (matrix[r][c]) drawCell(ctx, (offsetX + c) * CELL, (offsetY + r) * CELL, color);
        }
    }
}

/* ---------- 静态网格层离屏缓存：网格线仅在脏标记置位时重绘一次，每帧一次 drawImage 贴回 ---------- */

/** 静态网格层离屏画布（物理分辨率与主画布保持一致） */
const gridLayerCanvas = document.createElement('canvas');
/** 静态网格层绘制上下文 */
const gridLayerCtx = gridLayerCanvas.getContext('2d');
/** 网格层脏标记：true 时下一帧重建（DPR 适配 / 画布尺寸变化时由 resize 监听置位） */
let gridLayerDirty = true;

/**
 * 将棋盘背景网格线渲染到离屏层：约 29 段网格路径原先每帧重绘，
 * 现仅在尺寸/DPR 变化时重建一次。棋盘底色（外扩 10px 防震动露边）保留每帧绘制
 */
function renderGridLayer() {
    const view = FX.dims(canvas); // 读主画布 dpr：离屏层与主画布共用同一逻辑坐标系
    gridLayerCanvas.width = canvas.width; // 物理分辨率与主画布对齐（1:1 贴回不缩放）
    gridLayerCanvas.height = canvas.height;
    gridLayerCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // 锁 CSS 逻辑坐标，绘制代码零换算
    gridLayerCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    gridLayerCtx.strokeStyle = 'rgba(255,255,255,0.05)';
    gridLayerCtx.lineWidth = 1;
    gridLayerCtx.beginPath();
    for (let c = 1; c < COLS; c++) {
        gridLayerCtx.moveTo(c * CELL + 0.5, 0);
        gridLayerCtx.lineTo(c * CELL + 0.5, VIEW_H);
    }
    for (let r = 1; r < ROWS; r++) {
        gridLayerCtx.moveTo(0, r * CELL + 0.5);
        gridLayerCtx.lineTo(VIEW_W, r * CELL + 0.5);
    }
    gridLayerCtx.stroke();
}

/**
 * 在预览画布的指定水平带内按实际占用范围居中绘制一个方块（小格子）
 * @param {CanvasRenderingContext2D} context 目标画布上下文
 * @param {number} typeIndex 方块类型索引
 * @param {number} width 带区宽度（逻辑像素）
 * @param {number} height 带区高度（逻辑像素）
 * @param {number} yOffset 带区顶部在画布上的 y 偏移（逻辑像素）
 * @param {boolean} [dimmed] 是否置灰（本次落子已用过 Hold 时暂存块置灰）
 */
function drawMini(context, typeIndex, width, height, yOffset, dimmed) {
    const m = PIECES[typeIndex].matrix;
    const color = PIECES[typeIndex].color;
    // 找出矩阵实际占用的行列范围
    let minX = 4, maxX = -1, minY = 4, maxY = -1;
    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) {
                minX = Math.min(minX, c);
                maxX = Math.max(maxX, c);
                minY = Math.min(minY, r);
                maxY = Math.max(maxY, r);
            }
        }
    }
    // 按占用范围在带区内水平垂直居中
    const ox = (width - (maxX - minX + 1) * PREVIEW_CELL) / 2 - minX * PREVIEW_CELL;
    const oy = yOffset + (height - (maxY - minY + 1) * PREVIEW_CELL) / 2 - minY * PREVIEW_CELL;
    if (dimmed) context.globalAlpha = 0.35; // 本次落子已用过 Hold：暂存块置灰示意
    for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
            if (m[r][c]) drawCell(context, ox + c * PREVIEW_CELL, oy + r * PREVIEW_CELL, color, PREVIEW_CELL);
        }
    }
    if (dimmed) context.globalAlpha = 1;
}

/**
 * 绘制 HOLD 暂存预览（按实际占用范围居中；暂存区为空时留白）
 */
function drawHold() {
    holdCtx.clearRect(0, 0, HOLD_W, HOLD_H);
    if (holdType === -1) return; // 暂存区为空：留白
    drawMini(holdCtx, holdType, HOLD_W, HOLD_H, 0, holdUsed);
}

/**
 * 绘制后续 3 块预览：画布纵向三等分，每条带区内按实际占用范围居中依次绘制
 */
function drawNext() {
    nextCtx.clearRect(0, 0, NEXT_W, NEXT_H);
    const bandH = NEXT_H / NEXT_COUNT; // 每个预览带区高度
    for (let i = 0; i < NEXT_COUNT && i < nextQueue.length; i++) {
        drawMini(nextCtx, nextQueue[i], NEXT_W, bandH, i * bandH);
    }
}

/**
 * 计算堆叠最高点所在行（用于危险警报判定）
 * @returns {number} 从顶部数第一个含方块的行号；空棋盘返回 ROWS
 */
function stackTopRow() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c]) return r;
        }
    }
    return ROWS;
}

/**
 * 绘制整帧（含全部特效，自底向上分层）：
 * 震动 → 背景/网格 → 固定块 → 消行闪白 → 硬降残影 → 粒子 → 当前方块（含幽灵投影）→
 * 中央大字 → COMBO 飘字 → 消行得分飘字 → 全屏白闪 → 堆顶死亡灰暗渐隐 → 危险警报红光
 */
function draw() {
    ctx.save();
    // 台面震动：震动剩余时间越长偏移越大，随机方向抖动
    if (shakeTime > 0) {
        const amp = shakeTime * 30; // 0.18 秒时约 5px，快速衰减
        ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }
    // 背景多画 10px 边距，避免震动时露边
    ctx.fillStyle = '#0f1a1a';
    ctx.fillRect(-10, -10, VIEW_W + 20, VIEW_H + 20);
    // 静态网格层：脏标记置位时重建一次，之后每帧仅一次 drawImage 贴回
    if (gridLayerDirty) {
        renderGridLayer();
        gridLayerDirty = false;
    }
    ctx.drawImage(gridLayerCanvas, 0, 0, VIEW_W, VIEW_H);
    // 已固定的方块
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c]) drawCell(ctx, c * CELL, r * CELL, PIECES[board[r][c] - 1].color);
        }
    }
    // 消行闪白：满行覆盖白色脉冲（正弦闪 3 次后交棒给粒子）
    if (clearing) {
        const k = clearing.timer / CLEAR_FX_TIME; // 1 → 0
        ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * Math.abs(Math.sin(k * Math.PI * 3))})`;
        for (const r of clearing.rows) ctx.fillRect(0, r * CELL, VIEW_W, CELL);
    }
    // 硬降残影：起始位置的半透明方块矩阵，随时间渐隐
    for (const tr of trails) {
        ctx.globalAlpha = Math.max(0, tr.t / TRAIL_TIME) * 0.4;
        drawMatrix(tr.matrix, tr.x, tr.y0, PIECES[tr.typeIndex].color);
    }
    ctx.globalAlpha = 1;
    // 粒子（透明度随寿命衰减，池活跃区遍历）
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    // 当前方块 + 幽灵投影（消行演出期间隐藏：piece 此时已锁定并入板，属过期引用，不再作为活动块重复绘制）
    if (piece && running && !clearing) {
        const color = PIECES[piece.typeIndex].color;
        // 幽灵投影：落点预览（半透明）
        const gy = ghostDropY();
        if (gy !== piece.y) {
            ctx.globalAlpha = 0.22;
            drawMatrix(piece.matrix, piece.x, gy, color);
            ctx.globalAlpha = 1;
        }
        // 当前方块
        drawMatrix(piece.matrix, piece.x, piece.y, color);
    }
    // 中央大字（TETRIS! / LEVEL UP）：向上漂浮 + 尾段渐隐 + 青色霓虹光晕
    if (bigText) {
        const k = bigText.t / BIGTEXT_TIME; // 1 → 0
        ctx.globalAlpha = Math.min(1, k * 2); // 前 50% 全亮，尾段渐隐
        ctx.fillStyle = '#ffffff';
        ctx.font = '26px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#35e0ff';
        ctx.shadowBlur = 18;
        ctx.fillText(bigText.text, VIEW_W / 2, VIEW_H / 2 + 10 - (1 - k) * 24);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }
    // T-SPIN 技能飘字：Full 亮紫中字 / Mini 灰蓝小字，出现瞬间弹跳放大后安定，尾段渐隐上浮
    if (spinText) {
        const k = spinText.t / SPINTEXT_TIME; // 1 → 0
        // 前 20% 演出从 1.4 倍缩回 1 倍，模拟"弹出"感
        const scale = 1 + 0.4 * Math.max(0, k - 0.8) * 5;
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.fillStyle = spinText.mini ? '#9fb4d8' : '#c17bff';
        ctx.font = Math.round((spinText.mini ? 12 : 15) * scale) + 'px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(spinText.text, VIEW_W / 2, VIEW_H * 0.22 - (1 - k) * 10);
        ctx.globalAlpha = 1;
    }
    // COMBO 连消飘字：黄色小字，出现瞬间弹跳放大后安定，尾段渐隐上浮
    if (comboText) {
        const k = comboText.t / COMBO_TIME; // 1 → 0
        // 前 20% 演出从 1.4 倍缩回 1 倍，模拟"弹出"感
        const scale = 1 + 0.4 * Math.max(0, k - 0.8) * 5;
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.fillStyle = '#ffd23e';
        ctx.font = Math.round(13 * scale) + 'px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(comboText.text, VIEW_W / 2, VIEW_H * 0.3 - (1 - k) * 10);
        ctx.globalAlpha = 1;
    }
    // 消行得分飘字：白色中字，出现瞬间弹跳放大后安定，尾段渐隐上浮
    if (clearText) {
        const k = clearText.t / CLEARTEXT_TIME; // 1 → 0
        // 前 20% 演出从 1.35 倍缩回 1 倍，模拟"弹出"感
        const scale = 1 + 0.35 * Math.max(0, k - 0.8) * 5;
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.fillStyle = '#ffffff';
        ctx.font = Math.round(16 * scale) + 'px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(clearText.text, VIEW_W / 2, VIEW_H * 0.42 - (1 - k) * 12);
        ctx.globalAlpha = 1;
    }
    // 全屏白闪（仅 TETRIS 庆祝时触发，快速衰减）
    if (flashTime > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(flashTime / 0.3) * 0.5})`;
        ctx.fillRect(-10, -10, VIEW_W + 20, VIEW_H + 20);
    }
    // 堆顶死亡演出：整屏灰暗渐入，渐隐播完后由主循环弹出结算面板
    if (deathFadeTime > 0) {
        ctx.fillStyle = `rgba(8, 10, 18, ${(1 - deathFadeTime / DEATH_FADE_TIME) * 0.72})`;
        ctx.fillRect(-10, -10, VIEW_W + 20, VIEW_H + 20);
    }
    // 危险警报：堆叠最高点进入顶部 DANGER_ROWS 行范围内时，四边红色渐变呼吸警示
    if (running && stackTopRow() >= ROWS - DANGER_ROWS) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160); // 呼吸脉冲 0 → 1
        const a = 0.08 + pulse * 0.16;                               // 透明度随呼吸起伏
        const edge = 42;                                             // 光带厚度（像素）
        // 左右上下四条向内渐隐的红色光带
        let g = ctx.createLinearGradient(0, 0, edge, 0);
        g.addColorStop(0, `rgba(255,50,50,${a})`);
        g.addColorStop(1, 'rgba(255,50,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, edge, VIEW_H);
        g = ctx.createLinearGradient(VIEW_W, 0, VIEW_W - edge, 0);
        g.addColorStop(0, `rgba(255,50,50,${a})`);
        g.addColorStop(1, 'rgba(255,50,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(VIEW_W - edge, 0, edge, VIEW_H);
        g = ctx.createLinearGradient(0, 0, 0, edge);
        g.addColorStop(0, `rgba(255,50,50,${a})`);
        g.addColorStop(1, 'rgba(255,50,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, VIEW_W, edge);
        g = ctx.createLinearGradient(0, VIEW_H, 0, VIEW_H - edge);
        g.addColorStop(0, `rgba(255,50,50,${a})`);
        g.addColorStop(1, 'rgba(255,50,50,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, VIEW_H - edge, VIEW_W, edge);
    }
    ctx.restore();
}

/**
 * 更新 HUD 显示
 */
function updateHud() {
    trackRunStat('score', score); // 成就上报：单局得分（updateHud 是全部得分变动的唯一汇合点，软降/硬降/消行/T-Spin 全部经此）
    FX.tweenNumber(scoreEl, score, 128); // 分数滚动补间：从当前显示值平滑滚到新值（reduced-motion 自动降级直写）
    levelEl.textContent = level;
    linesEl.textContent = totalLines;
    highEl.textContent = highScore;
}

/**
 * 暂停 / 恢复切换
 */
function togglePause() {
    if (!running) return;
    // 成就墙打开期间暂停键不生效：墙面本身已冻结局面（见 toggleAchPanel），
    // 此时按 P 会让墙面悬停时底下局面重新开跑，造成双状态冲突
    if (achPanelOpen) return;
    paused = !paused;
    pauseScreen.style.display = paused ? 'block' : 'none';
    if (paused) {
        SFX.uiPause();    // 暂停音效
        SFX.bgm.pause();  // 背景音乐暂停（保留进度）
    } else {
        SFX.uiResume();   // 恢复音效
        // 快照续玩局此前从未起播 BGM（恢复流程不经 startGame）：start 同名幂等，
        // 未播时补起播、已在播时不受影响；随后 resume 接续手动暂停保留的进度
        SFX.bgm.start('tetris');
        SFX.bgm.resume(); // 背景音乐恢复
        lastTime = performance.now(); // 恢复时重置计时基准，防止瞬间连降
    }
}

/**
 * 选择难度：更新初始下落速度、分数倍率与无敌模式开关，并切换按钮高亮
 * @param {HTMLButtonElement} btn 被点击的难度按钮（data-drop / data-mult / data-invincible）
 */
function selectDifficulty(btn) {
    // 移除按钮焦点，防止空格误触按钮
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    dropBase = parseInt(btn.dataset.drop);
    scoreMult = parseInt(btn.dataset.mult);
    // 无敌模式开关：按钮带 data-invincible="1" 即无敌档，其余档位无此属性视为关闭
    invincibleMode = btn.dataset.invincible === '1';
    // 切换高亮样式
    document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // 持久化所选难度（按钮组中的序号），供下次加载时恢复
    try { localStorage.setItem(DIFFICULTY_KEY, String([...document.querySelectorAll('.difficulty-btn')].indexOf(btn))); } catch (e) { /* 存储不可用时静默跳过 */ } // 持久化失败不影响难度切换
    SFX.uiClick();
}

/**
 * 开始新游戏：重置全部状态并隐藏遮罩
 */
function startGame() {
    // 移除按钮焦点，防止空格误触按钮
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    board = createBoard();
    score = 0;
    level = 1;
    totalLines = 0;
    // 重置成就本局数据收集器（历史最佳存档 achStore.best 不重置）
    runStats.score = 0;
    runStats.lines = 0;
    runStats.level = 1;
    runStats.maxRows = 0;
    dropInterval = dropBase; // 应用所选难度的初始速度
    dropCounter = 0;
    lastTime = performance.now(); // 防止首帧 delta 过大导致瞬间下落
    // 清空全部特效残留
    clearing = null;
    particlePool.clear(); // 归还全部粒子（池对象保留复用）
    trails = [];
    shakeTime = 0;
    flashTime = 0;
    bigText = null;
    comboCount = 0;
    comboText = null;
    clearText = null;
    spinText = null;
    // 重置 T-Spin / B2B 连锁状态
    b2bActive = false;
    lastActionRotate = false;
    lastKickIndex = -1;
    // 重置锁定延迟 / DAS-ARR / 警报冷却状态
    lockTimer = 0;
    lockResets = 0;
    alarmCooldownUntil = 0;
    leftHeld = false;
    rightHeld = false;
    activeDir = 0;
    dasTimer = 0;
    arrTimer = 0;
    // 重置 7-bag 随机袋并预填 NEXT 队列、清空 HOLD 暂存
    bag = [];
    nextQueue = [];
    for (let i = 0; i < NEXT_COUNT; i++) nextQueue.push(drawFromBag());
    holdType = -1;
    holdUsed = false;
    spawnPiece();
    running = true;
    paused = false;
    startScreen.style.display = 'none';
    pauseScreen.style.display = 'none';
    gameOverScreen.style.display = 'none';
    achWall.hidden = true; // 关闭可能开着的成就墙
    achPanelOpen = false;
    achFrozen = false; // 同步清零面板冻结标记，防止新局误带旧冻结来源
    pauseRestoredEl.style.display = 'none'; // 新开局：隐藏「已恢复上次进度」提示
    updateHud();
    drawHold();
    drawNext();
    SFX.start();
    SFX.bgm.start('tetris'); // 启动俄罗斯方块背景音乐
}

/**
 * 游戏结束：显示结算面板并持久化最高分
 */
function gameOver() {
    running = false;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 存储不可用时静默 */ } // 游戏结束：本局进度快照作废，下次进入按新开局（清除失败不中断结算）
    finalScoreEl.textContent = score;
    const isRecord = score > highScore;
    if (isRecord) {
        highScore = score;
        try { localStorage.setItem('tetrisHighScore', highScore); } catch (e) { /* 存储不可用时静默，不中断结算面板 */ }
        updateHud();
        SFX.newRecord();  // 破纪录音效
        FX.recordBurst(); // 破纪录全屏金色烟花（内置减弱动效降级）
    }
    newRecordEl.style.display = isRecord ? 'block' : 'none';
    gameOverScreen.style.display = 'block';
    SFX.bgm.stop(); // 停止背景音乐
    SFX.gameOver();
}

/**
 * 主循环（requestAnimationFrame 驱动，下一帧排程前置于帧逻辑：先排程后执行，
 * 单帧异常只跳过该帧，渲染链永不中断）：时间增量累加器控制自然下落节奏；
 * 消行演出期间暂停下落并倒计时，演出结束交棒 finishClear；
 * hitstop 卡帧期间（FX.frozen）跳过全部逻辑与特效推进，仅渲染定格画面；
 * 特效在非暂停时持续推进（游戏结束后余韵继续播完）；每帧无条件刷新 lastTime，
 * 避免暂停恢复后首帧 delta 暴涨导致瞬间连降
 * @param {number} t 当前帧时间戳（毫秒，由 rAF 传入）
 */
function loop(t) {
    requestAnimationFrame(loop); // 前置排程：先预约下一帧，再执行本帧逻辑（单帧异常不再中断渲染循环）
    const dt = Math.min((t - lastTime) / 1000, 0.05); // 秒，封顶防切页跳变
    const frozen = FX.frozen(); // hitstop 卡帧中：跳过一切推进仅渲染，画面完全定格（打击感核心）
    if (running && !paused && !frozen) {
        if (clearing) {
            // 消行演出中：倒计时结束后实际删行结算（此间方块不下落）
            clearing.timer -= dt;
            if (clearing.timer <= 0) finishClear();
        } else {
            const deltaMs = t - lastTime;
            dropCounter += deltaMs;
            if (dropCounter > dropInterval) {
                drop();
                dropCounter = 0;
            }
            // 锁定延迟：触底后累计计时，满 LOCK_DELAY 才锁定；离地即清零
            if (collide(piece.x, piece.y + 1, piece.matrix)) {
                lockTimer += deltaMs;
                if (lockTimer >= LOCK_DELAY) lockPiece();
            } else {
                lockTimer = 0;
            }
            updateDAS(deltaMs);  // 推进 DAS/ARR 自动重复
            checkDangerAlarm(t); // 危险分级警报检查（含冷却）
        }
    }
    // 特效推进：暂停或 hitstop 卡帧时冻结，其余时刻（含结算面板期间）继续播完余韵
    if (!paused && !frozen) updateEffects(dt);
    // 堆顶死亡演出倒计时：灰暗渐隐播完后才弹出结算面板（结算音效因此错后）
    if (deathFadeTime > 0) {
        deathFadeTime -= dt;
        if (deathFadeTime <= 0) {
            deathFadeTime = 0;
            gameOver();
        }
    }
    lastTime = t; // 每帧都更新，避免暂停恢复后 delta 暴涨（下一帧已由函数开头前置排程预约）
    draw();
}

/**
 * 全局键盘控制：
 * P 暂停/恢复（游戏进行中含暂停态可按）；游戏进行中 ←/A →/D 平移、↓/S 软降、
 * ↑/W/X 顺时针旋转、Z 逆时针旋转、空格硬降；
 * 方向键与空格均阻止默认的页面滚动行为
 * @param {KeyboardEvent} e 键盘事件
 */
document.addEventListener('keydown', e => {
    // 阻止方向键 / 空格滚动页面
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
        e.preventDefault();
    }
    if (e.code === 'KeyP') {
        if (!e.repeat) togglePause(); // 防长按连发：系统按键重复率下反复切换暂停
        return;
    }
    if (e.code === 'KeyV') { // V 键：成就墙开关（C 键已被 Hold 暂存占用，沿用 V 不冲突）
        if (!e.repeat) toggleAchPanel(); // 防长按连发
        return;
    }
    if (e.code === 'Escape' && achPanelOpen) { // Esc：成就墙打开时优先关闭（游戏内无其他 Esc 语义）
        e.preventDefault();
        toggleAchPanel();
        return;
    }
    if (!running || paused || !piece || clearing) return; // 消行演出期间冻结操作
    switch (e.code) {
        // 方向键与 WASD 双通道支持（左手操作）；e.code 不受大写锁定影响；
        // 自实现 DAS/ARR：忽略系统 e.repeat 事件，按住期间的重复移动由 updateDAS 驱动
        case 'ArrowLeft': case 'KeyA':
            if (!e.repeat && !leftHeld) { leftHeld = true; startDAS(-1); }
            break;
        case 'ArrowRight': case 'KeyD':
            if (!e.repeat && !rightHeld) { rightHeld = true; startDAS(1); }
            break;
        case 'ArrowDown': case 'KeyS':
            if (!e.repeat) softDrop();
            break;
        case 'ArrowUp': case 'KeyW': case 'KeyX':
            if (!e.repeat) rotatePiece(); // 顺时针旋转（↑ / W / X）
            break;
        case 'KeyZ':
            if (!e.repeat) rotatePiece(-1); // 逆时针旋转（Z）：高端玩家快速回退姿态，双指交替微调更顺手
            break;
        case 'Space':
            if (!e.repeat) hardDrop();
            break;
        case 'KeyC': case 'ShiftLeft': case 'ShiftRight':
            if (!e.repeat) holdPiece(); // Hold 暂存换块（每次落子限一次）
            break;
    }
});

// 松开方向键：更新 DAS 按住状态（终止自动重复或换向）
document.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') releaseDir(-1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') releaseDir(1);
});

// 失焦：清空 DAS 按键状态（防止切回后按键"卡住"持续移动）与触屏连发计时，并自动暂停
window.addEventListener('blur', () => {
    leftHeld = false;
    rightHeld = false;
    activeDir = 0;
    stopAllTouchRepeats(); // 触屏按钮连发计时同步清空（对齐失焦清理惯例）
    if (running && !paused) togglePause();
});

// 暂停遮罩点击恢复（参照华容道 / 蜜蜂机台）：遮罩悬浮于画布之上会拦截点击，
// 点击遮罩空白处即恢复（与 P 键同走 togglePause；失焦自动暂停弹出的遮罩同样适用，
// 因为二者共用同一遮罩与暂停状态）；点在遮罩内按钮/链接上时不触发恢复，
// 避免误触 UI（如返回大厅）导致先恢复运行再跳转、快照存成运行态
pauseScreen.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a')) return; // 按钮/链接只响应自身点击语义，不充当恢复热区
    togglePause(); // 内部自守卫：未开局 / 成就墙打开时不会误恢复
});

// ---------- 触屏按钮控制 ----------
// 与键盘 keydown 同源的动作函数：单发（旋转/硬降/Hold）pointerdown 直接触发，
// 连发（←/→/↓）用 setTimeout 初段延迟 + setInterval 连发模拟 DAS/ARR 手感；
// 暂停 / 结束 / 消行守卫与键盘 keydown 内联判断完全一致

/** 触屏连发初段延迟（毫秒）：模拟键盘 DAS 手感，取 200ms 略长于键盘 150ms 以容错拇指按住 */
const TOUCH_DAS_DELAY = 200;
/** 触屏连发间隔（毫秒）：模拟键盘 ARR 手感，取 70ms 略慢于键盘 30ms 便于拇指感知节奏 */
const TOUCH_ARR_INTERVAL = 70;
/** 连发按钮在途定时器登记表：按钮元素 → { delay: 初段延迟句柄, repeat: 连发间隔句柄 } */
const touchRepeatTimers = new Map();

/**
 * 触屏操作守卫：与键盘 keydown 处理器的内联守卫同源——
 * 游戏进行中、非暂停、存在活动方块、非消行演出期才允许操作
 * @returns {boolean} 允许执行操作返回 true
 */
function isTouchActionAllowed() {
    return running && !paused && !!piece && !clearing;
}

/**
 * 停止指定按钮的在途连发：清空初段延迟与连发间隔两个定时器并撤销登记
 * @param {HTMLElement} btn 连发按钮元素
 */
function stopTouchRepeat(btn) {
    const reg = touchRepeatTimers.get(btn);
    if (reg) {
        clearTimeout(reg.delay);
        clearInterval(reg.repeat);
        touchRepeatTimers.delete(btn);
    }
}

/**
 * 清空全部在途触屏连发计时器（窗口失焦兜底，防止切回后按钮"卡住"持续移动）
 */
function stopAllTouchRepeats() {
    for (const btn of Array.from(touchRepeatTimers.keys())) stopTouchRepeat(btn);
}

/**
 * 绑定单发触屏按钮（旋转 / 硬降 / Hold）：
 * pointerdown 直接触发键盘 keydown 调用的同一动作函数，自动继承其内部守卫语义；
 * 触屏 pointerdown 天然无重复事件，无需 e.repeat 防抖
 * @param {string} btnId 按钮 id
 * @param {Function} action 键盘 keydown 调用的同一动作函数
 */
function bindTouchTapButton(btnId, action) {
    document.getElementById(btnId).addEventListener('pointerdown', e => {
        e.preventDefault(); // 防止按钮抢焦点（后续空格/回车误触）与触发滚动
        if (isTouchActionAllowed()) action();
    });
}

/**
 * 绑定连发触屏按钮（← / → / ↓）：
 * 按下立即执行一次（对齐键盘 startDAS 按下即移动一格），200ms 初段延迟后
 * 以 70ms 间隔连发；pointerup / pointercancel / 窗口失焦清空计时器；
 * 连发中遇暂停 / 结束 / 消行自动停发
 * @param {string} btnId 按钮 id
 * @param {Function} action 单次动作函数（键盘 DAS 底层 tryMoveH / 软降 softDrop）
 */
function bindTouchRepeatButton(btnId, action) {
    const btn = document.getElementById(btnId);
    btn.addEventListener('pointerdown', e => {
        e.preventDefault(); // 防止按钮抢焦点与触发滚动
        // 触点捕获到按钮：手指滑出按钮区域仍能收到 pointerup/cancel，防止连发"卡住"
        if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
        if (!isTouchActionAllowed()) return;
        stopTouchRepeat(btn); // 防御：多指误触重复按下时先清旧连发
        action(); // 立即执行一次
        // 初段延迟达成后进入连发；期间已松手（登记被清空）则放弃进入
        const delay = setTimeout(() => {
            const reg = touchRepeatTimers.get(btn);
            if (!reg) return;
            reg.repeat = setInterval(() => {
                if (!isTouchActionAllowed()) { stopTouchRepeat(btn); return; } // 暂停/结束/消行：停发
                action();
            }, TOUCH_ARR_INTERVAL);
        }, TOUCH_DAS_DELAY);
        touchRepeatTimers.set(btn, { delay: delay, repeat: null });
    });
    const stop = () => stopTouchRepeat(btn);
    btn.addEventListener('pointerup', stop);     // 松手停止
    btn.addEventListener('pointercancel', stop); // 系统接管（滚动/手势）取消
}

// 触屏按钮 → 键盘同款动作映射：单发四个 + 连发三个（与键盘动作一一对应）
bindTouchTapButton('touchBtnCW', () => rotatePiece());     // 顺时针旋转（键盘 ↑/W/X 同源）
bindTouchTapButton('touchBtnCCW', () => rotatePiece(-1));  // 逆时针旋转（键盘 Z 同源）
bindTouchTapButton('touchBtnDrop', hardDrop);              // 硬降（键盘空格同源）
bindTouchTapButton('touchBtnHold', holdPiece);             // Hold 暂存（键盘 C/Shift 同源）
bindTouchRepeatButton('touchBtnLeft', () => tryMoveH(-1)); // 左移连发（键盘 DAS 底层 tryMoveH）
bindTouchRepeatButton('touchBtnRight', () => tryMoveH(1)); // 右移连发
bindTouchRepeatButton('touchBtnDown', softDrop);           // 软降连发（键盘 ↓/S 同源）

// ---------- 成就系统（v2：对齐 snake 机台的 DOM 成就墙） ----------
// 结构说明：ACHIEVEMENTS 为 8 条成就定义（普通/稀有/史诗/传说四档稀有度）；
// runStats 收集本局实时数据（开局清零），achStore.best 按维度记录历史最佳并持久化；
// 达到 target 即解锁 → 右上角 toast 堆叠提示 + 破纪录音效，史诗/传说追加金色烟花庆典；
// 成就墙（#achWall）打开期间局面冻结：与手动暂停共用 paused 闸门（主循环 / DAS / 触屏连发
// 全部以 paused 为闸门，逻辑与特效一并定格），由 achFrozen 记录冻结来源以便精准还原。
/** localStorage 存档键：v2 结构 { unlocked: {id:时间戳}, best: {维度:最佳值} }（沿用旧键名，旧档自动迁移） */
const ACH_KEY = 'arcade_ach_tetris';
/** 稀有度 → 中文标签映射：卡片右上角徽章与 toast 副标题共用 */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
/** 历史最佳默认值：level 从 1 起步（等级基数），其余维度从 0 累计 */
const BEST_DEFAULTS = { score: 0, lines: 0, level: 1, maxRows: 0 };
/** 成就定义清单（8 条）：id 为存档标识——旧三条（lines40/tetris4/level5）id 原样保留，
 *  老玩家存档迁移后成就不丢失；stat/target 用于卡片历史最佳进度条 */
const ACHIEVEMENTS = [
    { id: 'score10000',  name: '得分好手',   icon: '🎯', rarity: 'rare',      cat: '得分', desc: '单局得分达到 10,000',   stat: 'score',   target: 10000 },
    { id: 'score30000',  name: '得分专家',   icon: '💠', rarity: 'epic',      cat: '得分', desc: '单局得分达到 30,000',   stat: 'score',   target: 30000 },
    { id: 'score100000', name: '十万俱乐部', icon: '👑', rarity: 'legendary', cat: '得分', desc: '单局得分达到 100,000', stat: 'score',   target: 100000 },
    { id: 'lines40',     name: '行云流水',   icon: '🧱', rarity: 'common',    cat: '成长', desc: '累计消除 40 行',        stat: 'lines',   target: 40 },
    { id: 'lines100',    name: '消行大师',   icon: '🏗️', rarity: 'epic',      cat: '成长', desc: '累计消除 100 行',       stat: 'lines',   target: 100 },
    { id: 'level5',      name: '高速运转',   icon: '⚡', rarity: 'common',    cat: '成长', desc: '等级达到 5',            stat: 'level',   target: 5 },
    { id: 'level10',     name: '十级高手',   icon: '🌟', rarity: 'legendary', cat: '成长', desc: '等级达到 10',           stat: 'level',   target: 10 },
    { id: 'tetris4',     name: 'TETRIS！',   icon: '💥', rarity: 'rare',      cat: '技巧', desc: '单次消除 4 行',         stat: 'maxRows', target: 4 }
];
/** 本局实时数据收集器：开局清零，随游玩经 trackRunStat 持续刷新 */
const runStats = { score: 0, lines: 0, level: 1, maxRows: 0 };
/** 成就存档 v2：unlocked 值为解锁时间戳（0 = 旧档迁移，仅存「已达成」语义），best 为历史最佳 */
let achStore = loadAchStore();
/** 成就墙是否打开：true 时局面冻结（paused 由 achFrozen 接管，见 toggleAchPanel） */
let achPanelOpen = false;
/** 成就墙冻结来源标记：true = 当前暂停由成就墙打开引起（关闭时据此恢复原状态） */
let achFrozen = false;

/**
 * 读取成就存档并兼容迁移到 v2 结构：
 * v1 旧档为「已解锁 id 数组」→ 全部迁入 unlocked（时间戳记 0，墙上显示「已达成」）；
 * v2 档缺失维度时按 BEST_DEFAULTS 补齐（新增成就维度向后兼容旧存档）
 * @returns {{unlocked: Object<string, number>, best: Object<string, number>}} v2 成就存档
 */
function loadAchStore() {
    try {
        const raw = localStorage.getItem(ACH_KEY);
        if (!raw) return { unlocked: {}, best: { ...BEST_DEFAULTS } }; // 无存档：全新档案
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
            // v1 → v2 迁移：旧 id 全部保留，历史最佳无从考证按默认值起步（后续游玩自然填充）
            const migrated = { unlocked: {}, best: { ...BEST_DEFAULTS } };
            for (const id of data) migrated.unlocked[id] = 0;
            return migrated;
        }
        // v2 结构：best 缺失维度用默认值补齐（展开时已存键覆盖默认值，缺失键自然落到默认值）
        return { unlocked: data.unlocked || {}, best: { ...BEST_DEFAULTS, ...(data.best || {}) } };
    } catch (e) { /* 存档损坏：按全新档案处理 */ }
    return { unlocked: {}, best: { ...BEST_DEFAULTS } };
}

/**
 * 持久化成就存档（unlocked 解锁表 + best 历史最佳一并写入 localStorage）
 */
function saveAchStore() {
    try {
        localStorage.setItem(ACH_KEY, JSON.stringify(achStore));
    } catch (e) { /* 隐私模式写入失败：成就提示照常弹出，仅不入盘，不中断结算链 */ }
}

/**
 * 上报本局数据并驱动成就判定：刷新 runStats 与历史最佳（只增不减），
 * 随后检查引用该维度的全部成就，达标即解锁
 * @param {string} stat 数据维度（score/lines/level/maxRows，对应 BEST_DEFAULTS 键）
 * @param {number} value 当前值（累进维度传累计值，峰值维度传当前峰值）
 */
function trackRunStat(stat, value) {
    runStats[stat] = value;
    if (value > achStore.best[stat]) { // 只增不减：刷新历史最佳并立即持久化
        achStore.best[stat] = value;
        saveAchStore();
    }
    // 达标解锁：遍历定义表检查引用该维度的成就（8 条量级，线性遍历开销可忽略）
    for (const a of ACHIEVEMENTS) {
        if (a.stat === stat && value >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 解锁成就：幂等（已解锁静默返回）→ 持久化 → toast 堆叠提示 + 破纪录音效，
 * 史诗 / 传说级追加金色烟花庆典；成就墙开着时同步刷新卡片
 * @param {string} id 成就 id（对应 ACHIEVEMENTS 中的定义）
 */
function unlockAchievement(id) {
    if (achStore.unlocked[id] !== undefined) return; // 去重：已解锁不重复提示
    achStore.unlocked[id] = Date.now(); // 记录解锁时间戳（供未来按时间排序 / 展示）
    saveAchStore();
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (def) {
        showAchToast(def);
        SFX.newRecord(); // 成就解锁音：对齐全库音色（与贪吃蛇等机台一致复用破纪录五连琶音）
        // 史诗 / 传说级追加金色烟花庆典（FX 内置减弱动效自动降级）
        if (def.rarity === 'epic' || def.rarity === 'legendary') FX.recordBurst();
    }
    // 成就墙开着时同步刷新解锁状态
    if (achPanelOpen) renderAchWall();
}

/**
 * 弹出成就解锁 toast：右上角堆叠滑入（CSS toastCycle 动画 3.2s 播完即移除节点），
 * 连续解锁时堆叠上限 3 条，超出裁掉最旧的
 * @param {{id: string, name: string, icon: string, rarity: string}} def 成就定义对象
 */
function showAchToast(def) {
    const stack = document.getElementById('achToastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'ach-toast ' + def.rarity; // 稀有度决定左色条与图标光晕配色
    el.innerHTML = '<div class="toast-icon">' + def.icon + '</div>' +
        '<div class="toast-body">' +
        '<span class="toast-cap">成就解锁 · ' + RARITY_LABEL[def.rarity] + '</span>' +
        '<span class="toast-name">' + def.name + '</span></div>';
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3300); // 与 CSS 动画时长(3.2s)对齐，播完移除节点防堆积
    while (stack.children.length > 3) stack.firstChild.remove(); // 堆叠上限：裁掉最旧 toast
}

/**
 * 渲染成就墙卡片网格：完成度计数 / 顶部总进度条 + 逐卡片（图标、名称、描述、
 * 历史最佳进度条、稀有度徽章）；--i 序号驱动 CSS 瀑布入场与流光错峰动画
 */
function renderAchWall() {
    const unlockedCount = ACHIEVEMENTS.filter(a => achStore.unlocked[a.id] !== undefined).length;
    achCountEl.textContent = unlockedCount;
    achTotalEl.textContent = ACHIEVEMENTS.length;
    achBarFill.style.width = (unlockedCount / ACHIEVEMENTS.length * 100) + '%'; // 完成度总进度条
    achGrid.innerHTML = ACHIEVEMENTS.map((a, i) => {
        const done = achStore.unlocked[a.id] !== undefined;
        // 进度条：历史最佳 / 目标值（封顶 100%）；已达成的显示完整进度
        const best = a.stat !== undefined ? achStore.best[a.stat] : 0;
        const pct = a.stat !== undefined ? Math.min(100, Math.round(best / a.target * 100)) : (done ? 100 : 0);
        // 进度条下方文案：带 stat 维度显示「历史最佳 当前值/目标值」，事件型成就显示达成状态
        const meta = a.stat !== undefined
            ? '<span>历史最佳</span><span>' + Math.min(best, a.target).toLocaleString('en-US') + ' / ' + a.target.toLocaleString('en-US') + '</span>'
            : '<span>一次性挑战</span><span>' + (done ? '已达成' : '待达成') + '</span>';
        return '<div class="ach-card ' + (done ? 'unlocked ' : 'locked ') + a.rarity + '" style="--i:' + i + '">' +
            '<div class="ach-icon">' + a.icon + (done ? '' : '<span class="ach-lock">🔒</span>') + '</div>' +
            '<div class="ach-info">' +
            '<div class="ach-name">' + a.name + '</div>' +
            '<div class="ach-desc">' + a.desc + '</div>' +
            '<div class="ach-prog"><div class="ach-prog-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="ach-prog-meta">' + meta + '</div>' +
            '</div>' +
            '<div class="ach-rarity-chip ' + a.rarity + '">' + RARITY_LABEL[a.rarity] + '</div>' +
            '</div>';
    }).join('');
}

/**
 * 成就墙开关：V 键 / Esc / 关闭按钮 / 遮罩点击统一入口，开关均播提示音。
 * 打开时先渲染最新数据再冻结局面（主循环、DAS、触屏连发全部以 paused 为闸门，
 * 逻辑与特效一并定格），BGM 同步挂起保留进度；achFrozen 记录冻结来源，
 * 关闭时只还原由墙面引起的暂停——手动暂停的局关闭后保持原暂停态，二者互斥不冲突
 */
function toggleAchPanel() {
    achPanelOpen = !achPanelOpen;
    achWall.hidden = !achPanelOpen;
    SFX.uiClick(); // 开关提示音
    if (achPanelOpen) {
        renderAchWall();
        // 墙打开即冻结：与手动暂停共用 paused 开关，BGM 同步挂起（保留进度）
        if (running && !paused) {
            achFrozen = true;
            paused = true;
            SFX.bgm.pause();
        }
    } else if (achFrozen) {
        // 关闭墙面：仅当冻结来源于墙面时恢复运行（手动暂停的局保持原暂停态）
        achFrozen = false;
        paused = false;
        SFX.bgm.resume();             // 续播挂起的 BGM
        lastTime = performance.now(); // 重置计时基准，防止恢复瞬间 delta 暴涨导致连降
        SFX.uiResume();               // 恢复音效，与手动暂停恢复体验一致
    }
}

// 点击成就墙遮罩空白处关闭（点在面板内部不触发）：与键盘 Esc / 关闭按钮同走 toggleAchPanel
achWall.addEventListener('pointerdown', e => {
    if (e.target === e.currentTarget) toggleAchPanel();
});

// ---------- 进度镜像快照 ----------
/** 进度快照存档键（localStorage）：返回游戏厅 / 页面卸载 / 父页下发保存指令时写入，下次进入游戏页时恢复 */
const SAVE_KEY = 'arcade_save_tetris';

/**
 * 保存当前局进度镜像快照到 localStorage（纯数据：数组/数值/布尔，不含函数与 DOM 引用）：
 * 仅在游戏进行中或暂停中写入；处于开始界面 / 结算界面时清除已有快照；
 * 整体 try/catch 静默容错，存储异常（隐私模式 / 超容量等）不中断游戏流程
 */
function saveSnapshot() {
    try {
        // 未开始（开始界面）或已结束（结算界面）：快照失去意义，直接清除旧存档
        if (!running && !paused) {
            localStorage.removeItem(SAVE_KEY);
            return;
        }
        // 组装纯数据快照：首字段固定版本号 v=1，恢复时校验
        const snapshot = {
            v: 1,                                                        // 格式版本号
            board: board.map(row => row.slice()),                        // 棋盘深拷贝（0 空 / 1-7 方块色索引）
            piece: { type: piece.typeIndex, rot: piece.rot, x: piece.x, y: piece.y }, // 当前方块类型/旋转态/坐标
            nextQueue: nextQueue.slice(),                                // NEXT 预览队列（3 项）
            bag: bag.slice(),                                            // 7-bag 随机器剩余队列
            holdType: holdType,                                          // HOLD 暂存块（-1 为空）
            holdUsed: holdUsed,                                          // 本周目是否已换持
            score: score,                                                // 分数
            level: level,                                                // 等级
            totalLines: totalLines                                       // 累计消行数
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
    } catch (e) { /* 序列化或存储失败：静默跳过，不影响游戏 */ }
}

/**
 * 校验快照数据合法性：版本号、棋盘尺寸（20 行 × 10 列）、方块种类枚举（0-6）、
 * 旋转态（0-3）、坐标范围、HOLD 取值与计数进度逐字段核对
 * @param {*} s 待校验的快照对象（JSON.parse 结果）
 * @returns {boolean} 全部字段合法返回 true，任一非法返回 false
 */
function isValidSnapshot(s) {
    if (!s || typeof s !== 'object' || s.v !== 1) return false; // 首字段版本号不符：立即弃用
    // 棋盘：20 行 × 10 列，格值 0-7 整数
    if (!Array.isArray(s.board) || s.board.length !== ROWS) return false;
    for (let r = 0; r < ROWS; r++) {
        const row = s.board[r];
        if (!Array.isArray(row) || row.length !== COLS) return false;
        for (let c = 0; c < COLS; c++) {
            const v = row[c];
            if (!Number.isInteger(v) || v < 0 || v > PIECES.length) return false;
        }
    }
    // 当前方块：类型 0-6 / 旋转态 0-3 / 坐标为有限整数且落在画布外围安全范围内
    const p = s.piece;
    if (!p || typeof p !== 'object') return false;
    if (!Number.isInteger(p.type) || p.type < 0 || p.type >= PIECES.length) return false;
    if (!Number.isInteger(p.rot) || p.rot < 0 || p.rot > 3) return false;
    if (!Number.isInteger(p.x) || p.x < -4 || p.x >= COLS) return false;
    if (!Number.isInteger(p.y) || p.y < -4 || p.y >= ROWS) return false;
    // NEXT 预览队列：恒为 3 项，每项 0-6
    if (!Array.isArray(s.nextQueue) || s.nextQueue.length !== NEXT_COUNT) return false;
    for (const t of s.nextQueue) {
        if (!Number.isInteger(t) || t < 0 || t >= PIECES.length) return false;
    }
    // 7-bag 剩余队列：0-7 项，每项 0-6
    if (!Array.isArray(s.bag) || s.bag.length > PIECES.length) return false;
    for (const t of s.bag) {
        if (!Number.isInteger(t) || t < 0 || t >= PIECES.length) return false;
    }
    // HOLD：-1（空）或 0-6；本周目换持标记必须为布尔
    if (!Number.isInteger(s.holdType) || s.holdType < -1 || s.holdType >= PIECES.length) return false;
    if (typeof s.holdUsed !== 'boolean') return false;
    // 计数与进度：非负整数，等级至少为 1
    if (!Number.isInteger(s.score) || s.score < 0) return false;
    if (!Number.isInteger(s.level) || s.level < 1) return false;
    if (!Number.isInteger(s.totalLines) || s.totalLines < 0) return false;
    return true;
}

/**
 * 从 localStorage 恢复进度快照：读键 → JSON.parse → 逐字段校验（含棋盘与方块位置的组合碰撞检测）；
 * 合法则覆盖游戏核心状态，Lock Delay / DAS-ARR 等输入时序状态复位为默认值，
 * 特效与 T-Spin / B2B / COMBO 状态清零，下落间隔按恢复后的等级重新推导；
 * 随后进入暂停遮罩等待玩家按 P 继续（防恢复即死）；任何异常或非法数据一律
 * 清除快照并返回 false，走默认新开局，绝不因脏数据抛错
 * @returns {boolean} 是否成功恢复（true = 已恢复并暂停；false = 无快照或快照非法）
 */
function restoreSnapshot() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false; // 无存档：按新开局处理
        const s = JSON.parse(raw);
        if (!isValidSnapshot(s)) {
            localStorage.removeItem(SAVE_KEY); // 脏数据：弃用并清除
            return false;
        }
        // —— 覆盖核心状态：棋盘 + 按保存的旋转态从初始矩阵旋转出当前姿态 ——
        board = s.board.map(row => row.slice());
        let matrix = PIECES[s.piece.type].matrix;
        for (let i = 0; i < s.piece.rot; i++) matrix = rotate(matrix);
        piece = { x: s.piece.x, y: s.piece.y, rot: s.piece.rot, typeIndex: s.piece.type, matrix };
        // 组合校验：恢复位置与棋盘冲突视为非法（防恢复即卡死），清除快照走新局
        if (collide(piece.x, piece.y, piece.matrix)) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        nextQueue = s.nextQueue.slice();
        bag = s.bag.slice();
        holdType = s.holdType;
        holdUsed = s.holdUsed;
        score = s.score;
        level = s.level;
        totalLines = s.totalLines;
        dropInterval = Math.max(80, dropBase - (level - 1) * 60); // 下落速度按恢复后的等级重新推导
        // —— 输入时序状态复位为默认值（Lock Delay / DAS-ARR / 警报冷却 / 死亡渐隐） ——
        dropCounter = 0;
        lockTimer = 0;
        lockResets = 0;
        leftHeld = false;
        rightHeld = false;
        activeDir = 0;
        dasTimer = 0;
        arrTimer = 0;
        alarmCooldownUntil = 0;
        deathFadeTime = 0;
        // —— 特效与 T-Spin / B2B / COMBO 状态清零 ——
        clearing = null;
        particlePool.clear();
        trails = [];
        shakeTime = 0;
        flashTime = 0;
        bigText = null;
        comboCount = 0;
        comboText = null;
        clearText = null;
        spinText = null;
        b2bActive = false;
        lastActionRotate = false;
        lastKickIndex = -1;
        // —— 进入暂停遮罩等待玩家继续（防恢复即死） ——
        running = true;
        paused = true;
        lastTime = performance.now(); // 重置计时基准，防止恢复瞬间 delta 暴涨导致连降
        startScreen.style.display = 'none';
        gameOverScreen.style.display = 'none';
        pauseScreen.style.display = 'block';
        pauseRestoredEl.style.display = 'block'; // 遮罩追加「已恢复上次进度」提示
        // 刷新 HUD / HOLD / NEXT 预览与画布一帧
        updateHud();
        drawHold();
        drawNext();
        draw();
        return true;
    } catch (e) {
        localStorage.removeItem(SAVE_KEY); // 任何异常：清除可疑存档，按新开局处理
        return false;
    }
}

// 页面卸载（刷新 / 关闭 / 父页移除 iframe）：进行中或暂停中的局写入快照（未开始/已结束由 saveSnapshot 内部清除）
window.addEventListener('pagehide', () => saveSnapshot());

// ---------- CRT 开关机音效双监听 ----------
let embedFsLast = null; // iframe 嵌入模式下最近一次全屏状态（null=尚未同步，首条消息静默）

// 独立打开模式：监听文档全屏切换，进全屏播开机音、退出播关机音
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});

// iframe 嵌入模式：父页面通过 postMessage 广播全屏状态与存档指令
window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'arcade:fs') {
        const fs = !!d.fs;
        // 沿检测：仅状态翻转时发声；首条消息（embedFsLast 为 null）仅静默同步状态
        if (embedFsLast !== null && fs !== embedFsLast) {
            if (fs) SFX.crtOn();
            else SFX.crtOff();
        }
        embedFsLast = fs;
    } else if (d.type === 'arcade:save') {
        saveSnapshot(); // 父页关闭覆盖层前下发：保存进度镜像快照
    }
});

// 窗口尺寸变化：三块画布按新 DPR 重建物理分辨率（CSS 逻辑尺寸固定不变）
window.addEventListener('resize', () => {
    FX.setupCanvas(canvas);
    FX.setupCanvas(nextCanvas);
    FX.setupCanvas(holdCanvas);
    gridLayerDirty = true; // 主画布物理分辨率/DPR 已变：下一帧重建静态网格层
});

// ---------- 初始化 ----------

// 难度恢复：页面加载时保持与上一次选择一致（默认中等，序号 2：无敌0/简单1/中等2/困难3；
// 加载时 AudioContext 尚未激活，selectDifficulty 中的 uiClick 无声，无害）
// 隐私模式 / 禁用站点数据时读取抛 SecurityError：try/catch 静默保持 NaN，走默认难度
let savedDifficultyIndex = NaN;
try {
    savedDifficultyIndex = parseInt(localStorage.getItem(DIFFICULTY_KEY), 10);
} catch (e) { /* 存储不可用时静默回退默认难度 */ }
if (!Number.isNaN(savedDifficultyIndex) && savedDifficultyIndex !== 2) {
    const savedDifficultyBtn = document.querySelectorAll('.difficulty-btn')[savedDifficultyIndex];
    if (savedDifficultyBtn) selectDifficulty(savedDifficultyBtn);
}

// 进度快照恢复：核心状态已创建、默认新局之前尝试恢复上次进度
// （成功 → 停在暂停遮罩等待玩家按 P 继续；失败/无快照 → 保持开始界面走原新局逻辑）
restoreSnapshot();

updateHud();
drawHold();
draw();
requestAnimationFrame(loop);

// ---------- 游玩时长统计 + 键帽实时高亮（2026-11-04 新增，公共库 fx.js 能力） ----------
// FX.playtime：rAF 累计页面可见游玩时长，嵌入模式周期经 arcade:playtime 消息上报大厅累计落盘
// （键 arcade_playtime_tetris），独立运行时由 fx.js 直写同一键；FX.KeyLight：点亮 KEYS 面板
// 中带 data-code 的键帽（window 级捕获委托，零侵入，reduced-motion 下无过渡）
FX.playtime.init('tetris');
FX.KeyLight.init();
