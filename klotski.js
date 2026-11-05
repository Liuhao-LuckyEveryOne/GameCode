/* ======================================================================
 * 华容道 (KLOTSKI) —— 像素街机厅游戏逻辑
 * 4×5 棋盘（108px 格）· 六种经典布局（横刀立马 / 指挥若定 / 捷足先登 /
 *          过五关 / 近在咫尺 / 兵临城下）
 * 核心机制：滑块只能滑入相邻空位（一次手势可沿直线连滑多格），曹操抵达
 *          底部中央出口（左上角到达 (1,3)）即通关；每次滑动按滑过格数
 *          计步；撤销栈支持逐步回退；三档难度（新手=滑动方向提示 /
 *          进阶=标准规则 / 大师=禁用撤销，不设"无敌"档），最少步纪录
 *          按 难度+布局 分键持久化；棋局进度自动保存（与难度绑定）——
 *          每次滑动/撤销后落盘，刷新或关闭页面后自动续玩
 * 操作方式：拖拽滑块（跟手移动 · 松手吸附）/ 点击选中 + 方向键推动 /
 *          数字键 1~6 切换布局 / U 撤销 · R 重开 · H 提示 · P 演示最佳解
 * 提示系统：H 键触发 BFS 最短路求解，高亮推荐棋子与滑动方向；
 *          按难度差异化——新手无限次 / 进阶每局限 3 次 / 大师禁用
 * 求解架构：BFS 求解器运行于 Blob 内联 Web Worker（主线程零阻塞，开局 /
 *          提示 / 演示三类求解均异步回调，请求按 id 路由、局面编码 + 局代次
 *          双校验丢弃过期结果；同一初始局面的解缓存复用 + 在途请求合并，
 *          重开/换局/演示零重复计算；Worker 不可用时降级为拒绝求解，不卡游戏）
 * 演示系统：P 键自动复现当前布局的 BFS 最佳解（格步口径，各布局均可完整通关）：
 *          从初始棋面起按固定节奏逐步自动执行，通关走完整庆祝演出但不写
 *          纪录与评级（非玩家成绩）；演示中玩家输入被屏蔽，P 中断 / R 重开
 * 评级系统：通关按 步数/BFS最优步数 的比率评 S/A/B/C，使用 H 提示会封顶
 *          等级（1~2 次最高 A、≥3 次最高 B）；最佳评级按 难度+布局 分键记录
 * 每日一题：本地日期经 FNV-1a 哈希对布局池取模，确定性选出当日布局
 *          （同一天必同一题、跨日自动换题）；侧栏按钮「今」角标提示，
 *          今日未完成时进页自动选中当日布局，当日通关即记入当日成绩
 * 进度镜像：返回游戏厅 / 收到 arcade:save 消息 / 页面卸载时保存本局快照（arcade_save_klotski），
 *          下次进入自动校验并切到快照布局摆好局面续玩，通关 / 重开 / 换布局清除快照
 * 视觉特效：拖拽跟手位移 + 键盘/撤销滑动补间动画 / 滑动残影拖尾 /
 *          落位挤压弹跳 / 回弹补间 / 选中棋子呼吸光晕 / 悬停棋子白色微光 /
 *          手型光标切换 / 曹操临门出口脉冲 + 金色四角星迸发 + 墙体红金渐变 /
 *          出口常时呼吸微光 / 棋盘织锦底纹（离屏缓存）/
 *          棋子精细纹理（确定性木纹线·对角高光带·顶部受光带·底部/右侧内阴影·
 *          曹操锦缎菱格+鎏金双线框+渐变铆钉+描边王冠+鎏金文字·关羽绦带纹·
 *          武将束带扣·兵卒圆环徽章·浮雕文字）/
 *          通关逃脱演出（曹操冲出出口 + 金光柱爆闪）+ 群子错峰欢呼弹跳 /
 *          棋盘入场错峰浮现 / 步数数字跳动反馈 / 滑行落位扬起尘土粒子 /
 *          拖拽落点金色虚影 / 连击里程碑飘字 / 开局"开演"金字 /
 *          舞台浮尘粒子（厅内空气微尘，全画布缓浮）/
 *          无法移动时画面轻震 / 通关金纸屑飘落后延迟弹出结算面板
 * 音效体系：普通滑块轻快滑音 vs 曹操低音区厚重滑音 / 曹操选中庄重双低音 /
 *          落位吸附 / 临门双哔 / 回弹 / 撞墙闷响 / 撤销 / 提示灵感音 /
 *          开局开演号角 / 换局木质翻牌音 / 连击里程碑递升音 /
 *          逼近纪录心跳音 /
 *          通关琶音 + 破门轰鸣 + 新纪录接力琶音 + S 级评级专属揭晓音
 * 渲染架构：requestAnimationFrame 单循环驱动计时、动画与全部绘制
 *          （rAF 在后台标签页暂停，离开窗口时计时自然停止）
 * 暂停体系：空格手动暂停 + 窗口失焦自动暂停（P 键已被演示系统占用，故空格承担暂停）；
 *          华容道虽是回合制，但用时统计（elapsed）参与评级与纪录，两种暂停
 *          均冻结计时与演示步进，保证切窗/挂机不会虚增用时、污染纪录公平性
 * 依赖：audio.js 提供的全局音效库 SFX
 * ==================================================================== */

/* ===================== 棋盘与布局常量 ===================== */

/** 棋盘列数（横向 4 格） */
const COLS = 4;
/** 棋盘行数（纵向 5 格） */
const ROWS = 5;
/** 单格边长（像素）：108 使棋盘总高与右侧说明栏（约 609px）上下对齐 */
const CELL = 108;
/** 棋盘区像素宽度 */
const BOARD_W = COLS * CELL;
/** 棋盘区像素高度 */
const BOARD_H = ROWS * CELL;
/** 棋盘距画布边缘的内边距（像素） */
const PAD = 12;
/** 棋盘下方出口提示区高度（像素）：41 使画布总高凑足 605px，与右侧说明栏自然高度（约 609px）上下大体对齐 */
const EXIT_H = 41;
/** 曹操通关目标：左上角格坐标（x=1 且底边贴住棋盘底，即占住底部中央出口） */
const EXIT_POS = { x: 1, y: ROWS - 2 };
/** 滑动补间动画时长（秒）：键盘推动、撤销回移与拖拽落位共用 */
const SLIDE_DUR = 0.11;
/** 拖拽判定阈值（像素）：指针位移超过该值才确定滑动方向 */
const DRAG_THRESHOLD = 14;
/** 无法移动时画面震动初始强度（秒） */
const SHAKE_TIME = 0.18;
/** 布局选择存档键（localStorage），页面加载时恢复上一次选择 */
const LAYOUT_KEY = 'klotskiLayout';
/** 每日一题存档键前缀：完整键 = 前缀 + '_' + 当日日期，存当日完成步数 */
const DAILY_KEY = 'klotskiDaily';
/** 进度快照存档键（localStorage，与其它街机游戏同一契约）：保存布局/难度/棋子位置/步数 */
const SAVE_KEY = 'arcade_save_klotski';
/** 难度选择存档键（localStorage），页面加载时恢复上一次选择 */
const DIFF_KEY = 'klotskiDifficulty';

/**
 * 难度 id 列表（下标即难度序号，不设"无敌"档）：
 * easy=新手（选中棋子显示可滑方向提示，可撤销，H 提示无限次）
 * normal=进阶（标准规则，可撤销，H 提示每局限 3 次）
 * hard=大师（无提示且禁用撤销与 H 提示）
 * 三档的通关条件与计步规则完全一致，差异仅在辅助手段
 */
const DIFF_IDS = ['easy', 'normal', 'hard'];

/** 进阶难度每局可用的 H 键提示次数 */
const NORMAL_HINT_QUOTA = 3;
/** H 键提示的高亮展示时长（秒），到时自动熄灭 */
const HINT_DUR = 2.6;
/** BFS 求解的状态数上限（防极端局面长时间占用 Worker，超限放弃求解） */
const HINT_SEARCH_LIMIT = 250000;
/** 演示模式相邻两步的间隔（秒）：略长于滑动补间 0.11s，保证落位动画播完再走下一步 */
const DEMO_STEP_INTERVAL = 0.3;

/** 通关评级阈值表：步数 / BFS 最优步数的比率逐档判定（先命中先得） */
const RANK_TIERS = [
    { rank: 'S', ratio: 1.15 }, // 近乎最优解
    { rank: 'A', ratio: 1.4 },
    { rank: 'B', ratio: 1.8 },
    { rank: 'C', ratio: Infinity }
];
/** 评级封顶规则：使用 H 提示会限制本次通关最高可获评级 */
const RANK_HINT_CAPS = [
    { maxHints: 0, cap: 'S' }, // 未用提示：不封顶
    { maxHints: 2, cap: 'A' }, // 用 1~2 次：最高 A
    { maxHints: Infinity, cap: 'B' } // 用 3 次及以上：最高 B
];
/** 评级优先级序（下标越小越优），用于封顶与最佳评级比较 */
const RANK_ORDER = ['S', 'A', 'B', 'C'];

/** 棋子类型外观表：渐变顶/底色、描边色、文字色与发光 RGB（供 rgba 拼接） */
const PIECE_STYLE = {
    cao:  { top: '#ffe9a8', bottom: '#e8a80c', border: '#ffd23e', text: '#5a3a00', glow: '255,210,62' },
    guan: { top: '#9dffc4', bottom: '#1fae52', border: '#39ff6a', text: '#03300f', glow: '57,255,106' },
    gen:  { top: '#9adfff', bottom: '#1f7ae0', border: '#35e0ff', text: '#04263f', glow: '53,224,255' },
    sol:  { top: '#eef1ff', bottom: '#97a0cf', border: '#cfd6ff', text: '#2a2f55', glow: '207,214,255' }
};

/**
 * 经典布局定义：pieces 为各棋子的初始 { 名称, 类型, 宽, 高, 列 x, 行 y }
 * （t: cao=曹操 2×2 / guan=关羽 2×1 / gen=武将 1×2 / sol=兵卒 1×1）
 */
const LAYOUTS = [
    {
        id: 'hengdao', name: '横刀立马', desc: '经典开局',
        pieces: [
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 0 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 2 },
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 0 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 0 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 2 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 2 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 0, y: 4 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 3, y: 4 }
        ]
    },
    {
        id: 'zhihui', name: '指挥若定', desc: '空位宽松',
        pieces: [
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 0 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 2 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 0, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 3, y: 0 },
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 1 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 1 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 3 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 3 }
        ]
    },
    {
        id: 'jiezu', name: '捷足先登', desc: '双卒开路',
        pieces: [
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 0, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 3, y: 0 },
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 1 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 1 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 2 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 3 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 3 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 3 }
        ]
    },
    {
        id: 'guowu', name: '过五关', desc: '边关把守',
        pieces: [
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 0, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 3, y: 0 },
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 1 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 1 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 2 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 3 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 4 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 4 }
        ]
    },
    {
        id: 'jinzai', name: '近在咫尺', desc: '中路重兵',
        pieces: [
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 0 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 0 },
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 0 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 2 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 2 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 2 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 4 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 4 }
        ]
    },
    {
        id: 'binglin', name: '兵临城下', desc: '卒压城头',
        pieces: [
            { n: '张飞', t: 'gen',  w: 1, h: 2, x: 0, y: 0 },
            { n: '赵云', t: 'gen',  w: 1, h: 2, x: 3, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 0 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 0 },
            { n: '曹操', t: 'cao',  w: 2, h: 2, x: 1, y: 1 },
            { n: '马超', t: 'gen',  w: 1, h: 2, x: 0, y: 2 },
            { n: '黄忠', t: 'gen',  w: 1, h: 2, x: 3, y: 2 },
            { n: '关羽', t: 'guan', w: 2, h: 1, x: 1, y: 3 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 1, y: 4 },
            { n: '卒', t: 'sol', w: 1, h: 1, x: 2, y: 4 }
        ]
    }
];

/* ===================== 游戏状态 ===================== */

/** 当前棋子数组（由布局深拷贝而来，元素含运行时字段 anim / dragOff / squash / bounce / enter 等） */
let pieces = [];
/** 当前布局序号（localStorage 持久化，页面加载时恢复） */
let layoutIndex = 0;
/** 当前难度序号（localStorage 持久化，页面加载时恢复；默认进阶，下标 1） */
let diffIndex = 1;
/** 本局剩余提示次数（新手=Infinity / 进阶=NORMAL_HINT_QUOTA / 大师=0），随难度即时切换 */
let hintLeft = 0;
/** 缓存的最优解路径（棋面变动即失效）：[{ t, x, y, dx, dy }, ...] */
let hintPath = null;
/** BFS 求解是否在途（H 键提示请求已发出、回调未归）：在途重复按键静默等待 */
let hintPending = false;
/** 当前展示的 H 键提示：{ piece, dx, dy, t }（t 为已展示秒数），null 表示无提示 */
let hint = null;
/** 本布局 BFS 最优步数（loadLayout 时求解缓存，0 表示求解失败），通关评级基准 */
let optimalMoves = 0;
/** 本局已使用的 H 提示次数（评级封顶依据，刷新展示不计数） */
let hintsUsed = 0;
/** 本次通关评级（win 时计算，结算面板展示），空表示尚未通关 */
let currentRank = '';
/** 当前难度+布局的历史最佳评级（localStorage 持久化，空表示尚无纪录） */
let bestRank = '';
/** 本次通关新解锁的成就 id 列表（win 时检查，结算面板展示用；空数组表示无新成就） */
let freshAchievements = [];
/** 当前选中的棋子（方向键推动的目标；切换布局后默认为曹操） */
let selected = null;
/** 已滑动的步数（一次滑过几格计几步） */
let moves = 0;
/** 本局累计用时（秒），仅 playing 状态在 rAF 中累加 */
let elapsed = 0;
/** 上次写入时间显示的整秒数（避免每帧重复改 DOM 文本） */
let lastShownSec = -1;
/** 游戏阶段：ready=开始遮罩中 / playing=进行中 / won=已通关 */
let state = 'ready';
/**
 * 暂停标记（空格手动暂停与窗口失焦自动暂停共用）：
 * 华容道虽是回合制，但有用时统计（elapsed）且参与评级与纪录，
 * 暂停期间必须冻结计时与演示步进，否则切窗/挂机会虚增用时、污染纪录公平性
 */
let isPaused = false;
/** 撤销栈：每次实际滑动压入 { piece, dx, dy, steps } */
const undoStack = [];
/** 当前布局的最少步数纪录（0 表示尚无纪录，显示为 —） */
let bestMoves = 0;
/** 本局是否刷新了最少步纪录（结算面板据此显示"新纪录"提示） */
let isNewRecord = false;
/** 画面震动剩余时间（秒），无法移动时触发 */
let shake = 0;
/** 胜利结算面板延迟显示的倒计时（秒），给纸屑演出留时间 */
let winRevealTimer = 0;
/** 演示模式进行中：true 时按最佳解逐步自动执行，玩家输入被屏蔽（P 中断 / R 重开） */
let demoActive = false;
/** 演示剩余步序（startDemo 时求解的完整路径快照，逐步弹出）：[{ t, x, y, dx, dy }, ...] */
let demoPath = null;
/** 演示步进倒计时（秒）：递减至 0 执行下一步并重置为 DEMO_STEP_INTERVAL */
let demoTimer = 0;
/** 本次通关是否为演示复现（结算面板据此展示"最佳解复现"而非玩家评级） */
let demoWin = false;

/* ===================== 特效状态 ===================== */

/** 滑动补间动画由各棋子的 anim 字段承载：{ fx, fy, t }（起点格坐标 + 进度秒） */
/** 通关金纸屑数组 { x, y, vx, vy, rot, vr, w, h, color, sway } */
const confetti = [];
/** 纸屑下落重力加速度（像素/秒²），落速缓慢营造飘落感 */
const CONFETTI_GRAVITY = 60;
/** 纸屑最大下落速度（像素/秒），封顶防止加速过猛 */
const CONFETTI_MAX_SPEED = 130;
/** 通关纸屑总数量 */
const CONFETTI_COUNT = 90;
/** 通关纸屑配色池（金红为主，点缀街机四色） */
const CONFETTI_COLORS = ['#ffd23e', '#ff5540', '#39ff6a', '#35e0ff', '#ff3ea5', '#eef1ff'];
/** 滑动残影单帧寿命（秒） */
const TRAIL_LIFE = 0.22;
/** 残影采样间隔（秒） */
const TRAIL_INTERVAL = 0.03;
/** 残影队列容量上限（超出丢弃最旧，防止长拖拽撑爆数组） */
const TRAIL_MAX = 60;
/** 落位挤压弹跳动画时长（秒） */
const SQUASH_DUR = 0.2;
/** 拖拽未过半格的回弹补间时长（秒） */
const BOUNCE_DUR = 0.14;
/** 滑动残影队列：{ x, y, w, h, glow, life }（像素轮廓 + 发光 RGB + 剩余寿命） */
const trails = [];
/** 残影采样计时器（秒），累计到 TRAIL_INTERVAL 批量采样一轮 */
let trailTimer = 0;
/** 曹操临门状态：一步下滑即可抵达出口时为 true，驱动出口框急促脉冲 */
let nearExit = false;
/** 临门检测的位置指纹：全部棋子坐标的零分配累积值，与上帧不一致才重算临门探测 */
let nearExitFp = -1;
/** 逃脱演出总时长（秒）：曹操冲出出口下滑并渐隐的完整过程 */
const ESCAPE_DUR = 0.9;
/** 逃脱演出中曹操下滑总距离（像素，约 2.4 格），模拟冲出棋盘冲向出口外 */
const ESCAPE_SLIDE = CELL * 2.4;
/** 逃脱起手爆闪时长（秒）：出口开口白金色闪光 */
const ESCAPE_FLASH_DUR = 0.18;
/** 逃脱演出状态：{ t }（进度秒），null 表示未在进行（win 时启动） */
let escape = null;
/** 通关纸屑延迟撒放倒计时（秒），让曹操逃脱演出先行展示 */
let confettiDelay = 0;
/** 入场动画单枚时长（秒）：棋子从缩放 0.55 → 1 的浮现过渡 */
const ENTER_DUR = 0.24;
/** 入场错峰间隔（秒）：按棋子序号依次延迟登场 */
const ENTER_STAGGER = 0.03;
/** 尘土粒子单粒基准寿命（秒），实际寿命在此基础上下随机浮动 */
const DUST_LIFE = 0.42;
/** 每次落位迸出的尘土粒子数量 */
const DUST_COUNT = 7;
/** 尘土粒子重力加速度（像素/秒²），微微上抛后坠回消散 */
const DUST_GRAVITY = 260;
/** 尘土粒子对象池：{ x, y, vx, vy, r, life }（像素坐标 + 速度 + 半径 + 剩余寿命），满员自动征用最旧粒子 */
const dustPool = new FX.Pool(96, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 2, life: 0 }));
/** 临门金星单粒基准寿命（秒），实际寿命在此基础上下随机浮动 */
const SPARK_LIFE = 0.6;
/** 每次临门点亮迸发的金星数量 */
const SPARK_COUNT = 10;
/** 临门金星重力加速度（像素/秒²），上抛后缓缓坠落 */
const SPARK_GRAVITY = 140;
/** 临门金星对象池：{ x, y, vx, vy, rot, vr, size, life }（金色四角星，临门点亮瞬间迸发），满员自动征用最旧粒子 */
const sparkPool = new FX.Pool(96, () => ({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, size: 3, life: 0 }));
/** 鼠标悬停所指的棋子（驱动白色微光描边与手型光标），null 表示无 */
let hoverPiece = null;
/** 上次写入步数显示的数值（比对变化后触发数字跳动反馈） */
let lastMovesShown = 0;
/** 上次写入提示次数显示的字符串（比对变化后才写 DOM，避免每帧重复改文本） */
let lastHintShown = '';
/** 上次写入最佳评级显示的字符串（比对变化后才写 DOM） */
let lastRankShown = '';

/* ---------- 视听增强：连击 / 飘字 / 开演 / 浮尘 / 墙体金化 ---------- */

/** 连击判定窗口（秒）：两次有效滑动间隔不超过该值才延续连击 */
const COMBO_WINDOW = 2.5;
/** 连击里程碑档位：连击数恰好命中这些值时触发飘字与音效 */
const COMBO_STEPS = [3, 6, 9];
/** 当前连击计数（有效滑动 +1，超窗或撤销清零） */
let comboCount = 0;
/** 连击窗口倒计时（秒），归零即连击断链 */
let comboTimer = 0;
/** 飘字队列：{ text, x, y, t, dur, color }（连击里程碑等提示文字上浮渐隐） */
const floaters = [];
/** 开演字幕时长（秒）：开局"开 演"金字的弹性缩放展示 */
const GO_DUR = 1.0;
/** 开演字幕状态：{ t }（进度秒），null 表示未在展示 */
let goText = null;
/** 通关欢呼单枚弹跳时长（秒）：群子依次跳起庆祝 */
const CELEBRATE_DUR = 0.6;
/** 舞台浮尘粒子数量：厅内空气微尘的规模（轻量，不影响性能） */
const AMBIENT_DUST_COUNT = 12;
/** 舞台浮尘粒子队列：{ x, y, r, spd, phase }（上浮 + 正弦横摆 + 顶部回绕） */
const ambientDust = [];
/** 浮尘初始化标记：首帧惰性生成，避免脚本加载期访问画布尺寸 */
let ambientDustReady = false;
/** 曹操临门墙体金化混合系数（0=常态红 1=完全金），指数趋近平滑过渡 */
let wallBlend = 0;
/** 逼近纪录紧张音触发标志：每区间只响一次，回退到安全步数后重置 */
let tenseFired = false;

/* ===================== DOM 引用 ===================== */

/** 游戏画布 */
const canvas = document.getElementById('game');
/** 2D 绘图上下文（setupCanvas 内部会重设 transform 为 dpr 缩放基准，绘制一律使用逻辑坐标） */
const ctx = canvas.getContext('2d');
/** 画布逻辑宽度（CSS 像素）：DPR 适配后所有布局/边界计算一律以此为准 */
let viewW = BOARD_W + 2 * PAD;
/** 画布逻辑高度（CSS 像素）：DPR 适配后所有布局/边界计算一律以此为准 */
let viewH = BOARD_H + 2 * PAD + EXIT_H;

/**
 * 应用 DPR 适配：调用共享库 FX.setupCanvas 将画布物理分辨率按 devicePixelRatio
 * 放大（上限 2），并把绘制坐标系锁定为 CSS 逻辑尺寸；进入页面与窗口尺寸变化时调用
 */
function applyDprFit() {
    const v = FX.setupCanvas(canvas, 2);
    viewW = v.w;
    viewH = v.h;
}
applyDprFit();
// 窗口尺寸/全屏切换导致画布 clientWidth 变化时重放 DPR 适配，保持高清渲染
window.addEventListener('resize', applyDprFit);
/** 步数显示元素 */
const moveElement = document.getElementById('moveVal');
/** 用时显示元素 */
const timeElement = document.getElementById('timeVal');
/** 最少步纪录显示元素 */
const bestElement = document.getElementById('bestVal');
/** 侧栏撤销按钮（大师难度下置灰禁用） */
const undoBtnElement = document.getElementById('undoBtn');
/** 侧栏提示次数显示元素 */
const hintElement = document.getElementById('hintVal');
/** 侧栏最佳评级显示元素 */
const rankElement = document.getElementById('rankVal');
/** 结算面板评级徽章元素 */
const winRankElement = document.getElementById('winRank');
/** 结算面板评级说明元素（步数/最优/提示次数） */
const winRankDescElement = document.getElementById('winRankDesc');
/** 开始遮罩 */
const startScreen = document.getElementById('startScreen');
/** 通关结算遮罩 */
const winScreen = document.getElementById('winScreen');
/** 暂停遮罩（与开始/胜利遮罩同款面板形态，空格手动暂停与失焦自动暂停共用） */
const pauseScreen = document.getElementById('pauseScreen');
/** 结算面板步数元素 */
const finalMovesElement = document.getElementById('finalMoves');
/** 结算面板用时元素 */
const finalTimeElement = document.getElementById('finalTime');
/** "新纪录"提示元素 */
const newRecordElement = document.getElementById('newRecord');
/** 开始遮罩每日一题信息行元素（今日题目名 + 完成状态） */
const dailyLineElement = document.getElementById('dailyLine');
/** 结算面板"今日一题完成"标记元素 */
const dailyDoneElement = document.getElementById('dailyDone');
/** 结算面板"成就解锁"提示行元素（本次通关有新成就时绿色展示成就名） */
const achUnlockedElement = document.getElementById('achUnlocked');

/* ===================== 核心逻辑 ===================== */

/**
 * 构建棋盘占用网格：除 exclude 外的所有棋子占据的格子标记为 true
 * @param {object} [exclude] 需要从占用统计中排除的棋子（自身滑行探测时排除自己）
 * @returns {boolean[][]} ROWS×COLS 的占用矩阵
 */
function buildGrid(exclude) {
    const grid = [];
    for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(false));
    for (const p of pieces) {
        if (p === exclude) continue;
        for (let cy = p.y; cy < p.y + p.h; cy++) {
            for (let cx = p.x; cx < p.x + p.w; cx++) grid[cy][cx] = true;
        }
    }
    return grid;
}

/**
 * 探测棋子沿指定方向最多能直线滑行几格（逐格检查边界与其他棋子占用）
 * @param {object} p 待移动的棋子
 * @param {number} dx 方向水平分量（-1/0/1）
 * @param {number} dy 方向垂直分量（-1/0/1）
 * @returns {number} 可滑行的最大格数（0 表示该方向被锁死）
 */
function slideRange(p, dx, dy) {
    const grid = buildGrid(p);
    let n = 0;
    // 逐格向前探测：越界或目标区域任一格被占即停
    while (n < Math.max(COLS, ROWS)) {
        const nx = p.x + dx * (n + 1);
        const ny = p.y + dy * (n + 1);
        if (nx < 0 || ny < 0 || nx + p.w > COLS || ny + p.h > ROWS) break;
        let free = true;
        for (let cy = ny; cy < ny + p.h && free; cy++) {
            for (let cx = nx; cx < nx + p.w; cx++) {
                if (grid[cy][cx]) { free = false; break; }
            }
        }
        if (!free) break;
        n++;
    }
    return n;
}

/**
 * 命中测试：像素坐标落在哪个棋子上（按棋子逻辑位置判定，不含拖拽偏移）
 * @param {number} px 画布内像素 x
 * @param {number} py 画布内像素 y
 * @returns {object|null} 命中的棋子；未命中返回 null
 */
function pieceAt(px, py) {
    const cx = (px - PAD) / CELL;
    const cy = (py - PAD) / CELL;
    for (const p of pieces) {
        if (cx >= p.x && cx < p.x + p.w && cy >= p.y && cy < p.y + p.h) return p;
    }
    return null;
}

/**
 * 登记一次有效滑动并推进连击：窗口内连续滑动累计计数，
 * 命中里程碑（3/6/9）时在棋盘上方弹出连击飘字并播放递升音效；
 * 由 trySlide（键盘）与 pointerup（拖拽）两条滑动路径共同调用（DRY）
 */
function registerCombo() {
    if (demoActive) return; // 演示模式：连击里程碑飘字/音效屏蔽，避免喧宾夺主
    comboCount++;
    comboTimer = COMBO_WINDOW; // 刷新连击窗口
    const idx = COMBO_STEPS.indexOf(comboCount);
    if (idx >= 0) {
        // 命中里程碑：绿色 → 金色 → 橙红逐档升格的飘字 + 音高递增音效
        floaters.push({
            text: `妙手连击 ×${comboCount}`,
            x: PAD + BOARD_W / 2,
            y: PAD + BOARD_H * 0.32,
            t: 0,
            dur: 1.1,
            color: ['#7dff8a', '#ffd23e', '#ff8866'][Math.min(idx, 2)]
        });
        SFX.klCombo(idx);
    }
}

/**
 * 检查"逼近纪录"状态：当前步数距历史最少步只差 2 步以内且尚未通关时，
 * 播放一次心跳紧张音（每区间只触发一次）；退回安全步数后重置允许再次触发；
 * 由 trySlide 与 pointerup 两条滑动路径共同调用（DRY）
 */
function checkTense() {
    if (demoActive) return; // 演示模式：逼近纪录心跳音屏蔽（演示成绩不算纪录）
    if (bestMoves > 0 && moves >= bestMoves - 2 && moves < bestMoves) {
        if (!tenseFired) {
            tenseFired = true;
            SFX.klTense(); // 低音心跳：破纪录前的紧张感
        }
    } else if (moves < bestMoves - 2) {
        tenseFired = false; // 退回安全区：允许下次逼近再触发
    }
}

/**
 * 执行一次滑动并结算（键盘/方向键路径）：实际滑行 min(steps, 可滑格数) 格，
 * 累计步数、压入撤销栈、播放音效并检查通关
 * @param {object} p 待移动的棋子
 * @param {number} dx 方向水平分量
 * @param {number} dy 方向垂直分量
 * @param {number} [steps] 期望滑行格数（默认 1，实际受可滑格数限制）
 * @returns {boolean} 是否产生了实际位移
 */
function trySlide(p, dx, dy, steps = 1) {
    if (isPaused) return false; // 暂停中冻结走子（含演示步进经由本函数结算的路径）
    const k = slideRange(p, dx, dy);
    if (k <= 0) {
        SFX.klBlock();
        shake = SHAKE_TIME; // 锁死方向的撞墙反馈震动
        return false;
    }
    const n = Math.min(steps, k);
    startSlideAnim(p);
    p.x += dx * n;
    p.y += dy * n;
    moves += n;
    if (!demoActive) trackRunStat('moves', moves); // 本局步数实时上报成就统计（演示复现不计入玩家成绩）
    undoStack.push({ piece: p, dx, dy, steps: n });
    invalidateHint(); // 棋面已变：提示展示与解路径缓存作废
    if (p.t === 'cao') SFX.klMoveCao(n); // 曹操专属：低音区厚重滑音
    else SFX.klMove(n); // 音高随滑动格数递增，连滑越远越高昂
    registerCombo(); // 连击推进：窗口内连续滑动，命中里程碑触发飘字音效
    checkTense(); // 逼近纪录检查：临门两步内的心跳提示
    updateHud();
    checkWin();
    return true;
}

/**
 * 为棋子启动一次补间动画：记录滑动前的视觉位置作为插值起点
 * @param {object} p 即将发生逻辑位移的棋子
 * @param {number} [fx] 插值起点格坐标 x（缺省取当前逻辑位置；拖拽滑行时传松手时的偏移位置以保持视觉连续）
 * @param {number} [fy] 插值起点格坐标 y（缺省取当前逻辑位置）
 */
function startSlideAnim(p, fx = p.x, fy = p.y) {
    p.anim = { fx, fy, t: 0 };
}

/**
 * 撤销上一次滑动（仅进行中可用；大师难度禁用）：弹出撤销栈反向回移并回退步数
 */
function undoMove() {
    if (state !== 'playing' || isPaused || undoStack.length === 0) {
        SFX.klBlock();
        return;
    }
    if (currentDiffId() === 'hard') {
        SFX.klBlock(); // 大师难度禁用撤销：钝响 + 轻震反馈
        shake = SHAKE_TIME;
        return;
    }
    const u = undoStack.pop();
    startSlideAnim(u.piece);
    u.piece.x -= u.dx * u.steps;
    u.piece.y -= u.dy * u.steps;
    moves -= u.steps;
    comboCount = 0; // 撤销视为连击断链：清零计数，打断流畅判定
    comboTimer = 0;
    SFX.klUndo();
    invalidateHint(); // 棋面已回退：提示展示与解路径缓存作废
    updateHud();
}

/**
 * 通关判定：曹操左上角恰好落在出口位（底部中央、底边贴住棋盘底）即胜利
 */
function checkWin() {
    const cao = pieces.find(p => p.t === 'cao');
    if (cao && cao.x === EXIT_POS.x && cao.y === EXIT_POS.y) win();
}

/**
 * 通关结算：切换 won 状态 → 启动曹操逃脱演出（金光柱 + 冲出出口渐隐）→
 * 判定并持久化最少步纪录 → 评级 S/A/B/C 并持久化最佳评级 →
 * 延迟撒放金纸屑（让逃脱演出先行）→
 * 延迟约 1.15 秒（winRevealTimer 倒计时）弹出结算面板
 */
function win() {
    state = 'won';
    SFX.bgm.stop(); // 对局结束（玩家通关与演示复现通用）：停 BGM，让位给通关/逃脱音效
    nearExit = false; // 曹操已入出口，熄灭临门高亮
    clearSnapshot(); // 已通关：快照完成使命，予以清除（"再来一局"将重新开局）
    SFX.klWin();
    SFX.klEscape(); // 破门轰鸣：曹操冲出出口瞬间的低频冲刺质感
    escape = { t: 0 }; // 启动逃脱演出：曹操冲出出口下滑渐隐
    confettiDelay = 0.4; // 纸屑延后半拍撒放，先看曹操逃脱
    // 群子欢呼弹跳：为每个非曹操棋子分配错峰延迟（负值表示尚未起跳），
    // 曹操破门后小兵武将们依次跳起庆祝，营造"普天同庆"的群像感
    let ci = 0;
    for (const p of pieces) {
        if (p.t !== 'cao') p.celebrate = { t: -(ci++) * 0.07 };
    }
    if (demoActive) {
        // 演示复现通关：庆祝演出照常走完整套，但不写纪录与评级（非玩家成绩）
        demoActive = false;
        demoPath = null;
        demoWin = true;
        currentRank = '';
        isNewRecord = false;
    } else {
        demoWin = false;
        // 纪录判定：步数少于当前难度+布局的历史最少（或首次通关）即新纪录
        const key = bestKey(LAYOUTS[layoutIndex].id, currentDiffId());
        const prev = readBest(LAYOUTS[layoutIndex].id, currentDiffId());
        isNewRecord = prev === 0 || moves < prev;
        bestMoves = isNewRecord ? moves : prev;
        if (isNewRecord) {
            safeSet(key, String(moves)); // 隐私模式写失败静默，不影响通关结算演出
            SFX.klRecord(); // 新纪录：高音区琶音延迟接力，与通关琶音错峰形成两段式庆祝
            FX.recordBurst(); // 新纪录金色烟花：全屏覆盖层演出（系统减弱动态效果时自动跳过）
        }
        // 通关评级：步数比率定基础等级、提示次数封顶；优于历史最佳则落盘
        currentRank = computeRank();
        const prevRank = readRank(LAYOUTS[layoutIndex].id, currentDiffId());
        if (!prevRank || RANK_ORDER.indexOf(currentRank) < RANK_ORDER.indexOf(prevRank)) {
            safeSet(rankKey(LAYOUTS[layoutIndex].id, currentDiffId()), currentRank); // 隐私模式写失败静默
        }
        bestRank = readRank(LAYOUTS[layoutIndex].id, currentDiffId());
        // 成就检查：首次通关 / S 级评级 / 十八连破（须在纪录与评级落盘后判定，
        // 全通判定才能读到含本次通关的最新纪录）
        freshAchievements = checkAchievements(currentRank);
        // 每日一题：当日布局的玩家通关即记入当日成绩（重复通关取更优步数）
        if (layoutIndex === dailyIndex()) {
            const prevDaily = readDailyDone();
            if (!prevDaily || moves < prevDaily) {
                safeSet(DAILY_KEY + '_' + dailyKey(), String(moves)); // 隐私模式写失败静默
            }
        }
    }
    updateHud();
    winRevealTimer = 1.15; // 延长结算延迟：逃脱演出 0.9s + 纸屑先行片刻
}

/* ===================== 布局与流程控制 ===================== */

/**
 * 取当前难度 id
 * @returns {string} 难度 id（easy/normal/hard，见 DIFF_IDS）
 */
function currentDiffId() {
    return DIFF_IDS[diffIndex];
}

/**
 * 生成最少步纪录存档键：按 难度+布局 分键，各难度纪录互不掺水
 * @param {string} layoutId 布局 id
 * @param {string} diffId 难度 id
 * @returns {string} localStorage 键名
 */
function bestKey(layoutId, diffId) {
    return 'klotskiBest_' + diffId + '_' + layoutId;
}

/**
 * 安全读取 localStorage：存储不可用（隐私模式等）时返回 null 按无数据处理，不向上抛错
 * @param {string} key localStorage 键名
 * @returns {string|null} 存储值（读取失败为 null）
 */
function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

/**
 * 安全写入 localStorage：存储不可用（隐私模式/超容量等）时静默放弃，不中断通关结算等游戏流程
 * @param {string} key localStorage 键名
 * @param {string} value 写入值
 */
function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 写入失败静默 */ }
}

/**
 * 读取指定难度+布局的最少步纪录；
 * 进阶难度兼容回读旧版"不分难度"的纪录键，老玩家的历史纪录不丢失
 * @param {string} layoutId 布局 id
 * @param {string} diffId 难度 id
 * @returns {number} 最少步纪录（0 表示尚无纪录）
 */
function readBest(layoutId, diffId) {
    let v = parseInt(safeGet(bestKey(layoutId, diffId)) || '0', 10);
    if (!v && diffId === 'normal') {
        v = parseInt(safeGet('klotskiBest_' + layoutId) || '0', 10); // 旧版纪录视为进阶档
    }
    return Number.isNaN(v) ? 0 : v;
}

/**
 * 生成最佳评级存档键：按 难度+布局 分键，与最少步纪录同维度隔离
 * @param {string} layoutId 布局 id
 * @param {string} diffId 难度 id
 * @returns {string} localStorage 键名
 */
function rankKey(layoutId, diffId) {
    return 'klotskiRank_' + diffId + '_' + layoutId;
}

/**
 * 读取指定难度+布局的历史最佳评级
 * @param {string} layoutId 布局 id
 * @param {string} diffId 难度 id
 * @returns {string} 评级字符（S/A/B/C，尚无纪录时为空字符串）
 */
function readRank(layoutId, diffId) {
    return safeGet(rankKey(layoutId, diffId)) || '';
}

/* ===================== 成就系统 v2（DOM 成就墙 + toast，与全站七游戏同构） ===================== */

/** 成就解锁存档键（localStorage，跨局累计；大厅成就中心按此键聚合进度） */
const ACHIEVEMENT_KEY = 'arcade_ach_klotski';
/** 稀有度中文标签：卡片徽章与解锁 toast 共用 */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
/** 历史最佳统计初始值：best 缺项按此补齐（新增统计向后兼容旧档） */
const ACH_BEST_DEFAULTS = { wins: 0, moves: 0 };
/** 成就定义表（8 条，四档稀有度 普通2/稀有1/史诗3/传说2，顺序即成就墙展示顺序）：
 *  stat+target 驱动进度条（wins=跨局累计通关，moves=单局最大步数，均持久化于 best）；
 *  无 stat 的事件型成就（评级/速通/最优解/全通）由 checkAchievements 在通关瞬间判定 */
const KLOTSKI_ACHIEVEMENTS = [
    { id: 'firstWin', name: '初出茅庐', icon: '🚩', rarity: 'common', cat: '成长', desc: '首次通关任意布局', stat: 'wins', target: 1 },
    { id: 'steps50', name: '渐入佳境', icon: '👣', rarity: 'common', cat: '单局', desc: '单局滑动步数达到 50 步', stat: 'moves', target: 50 },
    { id: 'wins5', name: '常胜将军', icon: '🎖️', rarity: 'rare', cat: '成长', desc: '累计通关 5 次', stat: 'wins', target: 5 },
    { id: 'rankS', name: '神机妙算', icon: '🧠', rarity: 'epic', cat: '单局', desc: '任意布局以 S 级评级通关', target: 0 },
    { id: 'wins20', name: '百战不殆', icon: '⚔️', rarity: 'epic', cat: '成长', desc: '累计通关 20 次', stat: 'wins', target: 20 },
    { id: 'speed300', name: '兵贵神速', icon: '⚡', rarity: 'epic', cat: '单局', desc: '单局 5 分钟内通关', target: 0 },
    { id: 'optimal', name: '一步不差', icon: '👑', rarity: 'legendary', cat: '挑战', desc: '以理论最少步数通关任意布局', target: 0 },
    { id: 'allClear', name: '十八连破', icon: '🏰', rarity: 'legendary', cat: '挑战', desc: '全部 18 个难度×布局均已通关', target: 0 }
];
/** 成就存档（v2 结构）：{ unlocked:{id:解锁时间戳ms}, best:{wins,moves} }，页面载入时读档迁移 */
let achStore = loadAchStore();
/** 成就墙是否处于打开态：打开期间冻结逻辑计时、吞掉操作按键（拖拽由全屏遮罩天然拦截） */
let achPanelOpen = false;

/** 成就墙遮罩层（整层显隐，全屏拦截指针事件） */
const achWall = document.getElementById('achWall');
/** 成就墙卡片网格容器（按定义表动态重建） */
const achGrid = document.getElementById('achGrid');
/** 成就墙头部计数元素（「N/8」文本） */
const achCountElement = document.getElementById('achCount');
/** 成就墙头部完成度进度条填充 */
const achBarFill = document.getElementById('achBarFill');
/** 成就解锁 toast 堆叠容器（右上角） */
const achToastStack = document.getElementById('achToastStack');

/**
 * 从 localStorage 读取成就存档并归一化为 v2 结构（含 v1 老数组档迁移）。
 * v2 现行格式：{ unlocked:{id:时间戳ms}, best:{统计名:历史最大值} }；
 * v1 旧格式：纯字符串数组（老版华容道存档）——旧 id 全部迁入新 unlocked（时间戳 0），
 * firstWin/rankS/allClear 三个旧 id 与新定义表同名字沿用，老玩家成就零丢失
 * @returns {{unlocked: Object<string, number>, best: Object<string, number>}} 归一化后的成就存档
 */
function loadAchStore() {
    let raw = null;
    try { raw = JSON.parse(safeGet(ACHIEVEMENT_KEY) || 'null'); } catch (e) { raw = null; } // 存档损坏按无档处理
    // v2 对象档：直接归一（unlocked 非对象一律重建空表，best 缺项补初始值）
    if (raw && !Array.isArray(raw) && raw.unlocked && typeof raw.unlocked === 'object' && !Array.isArray(raw.unlocked)) {
        return { unlocked: raw.unlocked, best: Object.assign({}, ACH_BEST_DEFAULTS, raw.best || {}) };
    }
    // v1 数组档迁移：旧 id 收编进新结构后立即落盘（safeSet 静默兜底，失败则下次解锁写盘自然补上）
    if (Array.isArray(raw)) {
        const migrated = { unlocked: {}, best: Object.assign({}, ACH_BEST_DEFAULTS) };
        for (let i = 0; i < raw.length; i++) {
            if (typeof raw[i] === 'string') migrated.unlocked[raw[i]] = 0;
        }
        safeSet(ACHIEVEMENT_KEY, JSON.stringify(migrated));
        return migrated;
    }
    // 无档：全新存档
    return { unlocked: {}, best: Object.assign({}, ACH_BEST_DEFAULTS) };
}

/**
 * 持久化成就存档（复用 safeSet：存储不可用时静默放弃，不影响通关结算流程）
 * @param {{unlocked: Object, best: Object}} store 成就存档
 * @returns {void}
 */
function saveAchStore(store) {
    safeSet(ACHIEVEMENT_KEY, JSON.stringify(store));
}

/**
 * 判断成就是否已解锁
 * @param {string} id 成就 id
 * @returns {boolean} true=已解锁
 */
function hasAch(id) {
    return Object.prototype.hasOwnProperty.call(achStore.unlocked, id);
}

/**
 * 取全部已解锁成就 id 列表（结算面板对比「本次新增」用）
 * @returns {string[]} 已解锁成就 id 数组
 */
function unlockedAchIds() {
    return Object.keys(achStore.unlocked);
}

/**
 * 单局统计上报（max 语义）：刷新历史最佳并判定挂在该统计上的进度型成就。
 * 走子结算路径实时调用；仅破纪录时写盘，稳态零开销
 * @param {string} stat 统计名（ACH_BEST_DEFAULTS 的键）
 * @param {number} value 本局当前值
 * @returns {void}
 */
function trackRunStat(stat, value) {
    if (!(stat in achStore.best) || value <= achStore.best[stat]) return; // 未破纪录：不写盘不判成就
    achStore.best[stat] = value;
    saveAchStore(achStore);
    // 新纪录落盘后逐条比对定义表，达标即解锁（unlockAchievement 幂等）
    for (let i = 0; i < KLOTSKI_ACHIEVEMENTS.length; i++) {
        const a = KLOTSKI_ACHIEVEMENTS[i];
        if (a.stat === stat && value >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 累计型统计上报（add 语义）：增量累入 best 并判定对应成就（wins 跨局累计通关次数专用）
 * @param {string} stat 统计名
 * @param {number} delta 本次增量（非正数忽略）
 * @returns {void}
 */
function trackCumulativeStat(stat, delta) {
    if (!(stat in achStore.best) || delta <= 0) return;
    achStore.best[stat] += delta;
    saveAchStore(achStore);
    for (let i = 0; i < KLOTSKI_ACHIEVEMENTS.length; i++) {
        const a = KLOTSKI_ACHIEVEMENTS[i];
        if (a.stat === stat && achStore.best[stat] >= a.target) unlockAchievement(a.id);
    }
}

/**
 * 解锁成就（幂等）：首次解锁时落盘 + 右上角 DOM toast + 解锁音；
 * 史诗/传说追加金色烟花庆祝；重复触发直接短路
 * @param {string} id 成就 id（见 KLOTSKI_ACHIEVEMENTS 定义表）
 * @returns {boolean} 本次是否为新解锁（true=新解锁并已落盘；false=此前已解锁）
 */
function unlockAchievement(id) {
    if (hasAch(id)) return false; // 幂等短路
    let meta = null;
    for (let i = 0; i < KLOTSKI_ACHIEVEMENTS.length; i++) {
        if (KLOTSKI_ACHIEVEMENTS[i].id === id) { meta = KLOTSKI_ACHIEVEMENTS[i]; break; } // 查定义表取展示信息
    }
    if (!meta) return false; // 未定义的 id 忽略
    achStore.unlocked[id] = Date.now();
    saveAchStore(achStore);
    showAchToast(meta); // 右上角堆叠 toast（稀有度色边，自动滑入退场）
    SFX.newRecord(); // 成就解锁音
    if (meta.rarity === 'epic' || meta.rarity === 'legendary') FX.recordBurst(); // 高稀有度金色烟花
    return true;
}

/**
 * 生成一张成就解锁 toast 挂入右上角堆叠容器（CSS 动画滑入-停留-退场，3.4s 后自移除）
 * @param {{name: string, icon: string, rarity: string}} meta 成就定义
 * @returns {void}
 */
function showAchToast(meta) {
    const el = document.createElement('div');
    el.className = 'ach-toast r-' + meta.rarity;
    el.innerHTML =
        '<div class="t-icon">' + meta.icon + '</div>' +
        '<div class="t-body"><span class="t-title">成就解锁 · ' + RARITY_LABEL[meta.rarity] + '</span>' +
        '<span class="t-name">' + meta.name + '</span></div>';
    achToastStack.appendChild(el);
    setTimeout(() => el.remove(), 3400); // 与 toast CSS 动画总时长（滑入+停留+退场）对齐
    while (achToastStack.children.length > 4) achToastStack.firstChild.remove(); // 堆叠上限 4 条，超出移除最旧
}

/**
 * 计算进度型成就的完成百分比（0~100 取整，钳位防越界）
 * @param {{stat?: string, target?: number}} a 成就定义
 * @returns {number} 完成百分比
 */
function achProgPct(a) {
    if (!a.stat || !a.target) return 0;
    return Math.min(100, Math.round((achStore.best[a.stat] || 0) / a.target * 100));
}

/**
 * 进度型成就的「当前/目标」文案
 * @param {{stat?: string, target?: number}} a 成就定义
 * @returns {string} 如「17/20」；非进度型为空串
 */
function achProgText(a) {
    if (!a.stat || !a.target) return '';
    return Math.min(a.target, achStore.best[a.stat] || 0) + '/' + a.target;
}

/**
 * 重建成就墙：头部计数/完成度进度条 + 按定义表逐张重建卡片（开墙时调用）
 * @returns {void}
 */
function renderAchWall() {
    achGrid.innerHTML = ''; // 清空重建，保证与最新存档一致
    let count = 0;
    KLOTSKI_ACHIEVEMENTS.forEach((a, i) => {
        const unlocked = hasAch(a.id);
        if (unlocked) count++;
        // 进度区：进度型展示进度条+当前/目标；事件型无进度条
        const progHtml = a.stat && a.target
            ? '<div class="ach-prog"><div class="ach-prog-bar"><div class="ach-prog-fill" style="width:' +
              achProgPct(a) + '%"></div></div><span class="ach-prog-text">' + achProgText(a) + '</span></div>'
            : '';
        // 组装卡片：图标座（未解锁叠小锁）+ 名称行（名称+稀有度徽章）+ 描述 + 分类 + 进度
        const card = document.createElement('div');
        card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked') + ' r-' + a.rarity;
        card.style.setProperty('--i', i); // 逐张瀑布入场序号
        card.innerHTML =
            '<div class="ach-icon">' + a.icon + (unlocked ? '' : '<span class="ach-lock">🔒</span>') + '</div>' +
            '<div class="ach-info">' +
            '<div class="ach-name-row"><span class="ach-name">' + a.name + '</span>' +
            '<span class="ach-rarity">' + RARITY_LABEL[a.rarity] + '</span></div>' +
            '<div class="ach-desc">' + a.desc + '</div>' +
            '<div class="ach-cat">' + a.cat + '</div>' + progHtml + '</div>';
        achGrid.appendChild(card);
    });
    // 头部：「N/8」计数 + 完成度进度条
    achCountElement.textContent = count + '/' + KLOTSKI_ACHIEVEMENTS.length;
    achBarFill.style.width = Math.round(count / KLOTSKI_ACHIEVEMENTS.length * 100) + '%';
}

/**
 * 成就墙开合切换：开墙重建卡片并冻结计时（用时参与评级与纪录，看墙期间冻结保证公平）；
 * 开墙前先结算进行中的拖拽手势（endDrag），防止遮罩落下后残留半拖拽状态；
 * V 键任意状态可开合（含开始界面/通关面板），Esc 仅在开着时关闭
 * @returns {void}
 */
function toggleAchPanel() {
    achPanelOpen = !achPanelOpen;
    if (achPanelOpen) {
        endDrag(); // 结算进行中的拖拽手势，防止遮罩落下后残留半拖拽状态
        renderAchWall();
        achWall.hidden = false; // 移除 hidden 属性 → CSS display:flex 显示
    } else {
        achWall.hidden = true; // 加回 hidden 属性 → CSS display:none 隐藏
    }
    SFX.uiClick(); // 开合反馈音
}

/**
 * 通关后检查成就（在 win 的最少步纪录与评级落盘之后调用，
 * 十八连破判定读到的纪录已含本次通关）：
 * 累计通关 +1（首胜/常胜/百战进度型随写盘自动判定）/ 神机妙算（S 级评级）/
 * 兵贵神速（5 分钟内通关）/ 一步不差（理论最优步数）/ 十八连破（18 个难度×布局全通）
 * @param {string} rank 本次通关评级（S/A/B/C）
 * @returns {string[]} 本次新解锁的成就 id 列表（供结算面板展示，无新成就时为空数组）
 */
function checkAchievements(rank) {
    const before = unlockedAchIds(); // 结算前快照：用于识别「本次新增」
    trackCumulativeStat('wins', 1); // 累计通关 +1：进度型成就（首胜/5胜/20胜）随写盘自动判定
    trackRunStat('moves', moves); // 本局步数兜底上报（走子路径已实时上报，此处保证通关路径完整）
    // 神机妙算：本次评级达 S 即解锁（历史 S 不重判，以本次为准保持即时性）
    if (rank === 'S') unlockAchievement('rankS');
    // 兵贵神速：单局 5 分钟（300 秒）内通关
    if (elapsed <= 300) unlockAchievement('speed300');
    // 一步不差：步数恰为理论最优解（optimalMoves>0 过滤无最优解数据的布局）
    if (optimalMoves > 0 && moves === optimalMoves) unlockAchievement('optimal');
    // 十八连破：遍历全部难度×布局组合，最少步纪录均大于 0 才算全通
    let allDone = true;
    for (let d = 0; d < DIFF_IDS.length && allDone; d++) {
        for (let i = 0; i < LAYOUTS.length; i++) {
            if (readBest(LAYOUTS[i].id, DIFF_IDS[d]) <= 0) { allDone = false; break; }
        }
    }
    if (allDone) unlockAchievement('allClear');
    // 结算面板「成就解锁」行展示用：本次新增的 id 列表（保持定义表顺序）
    const fresh = [];
    for (let i = 0; i < KLOTSKI_ACHIEVEMENTS.length; i++) {
        const a = KLOTSKI_ACHIEVEMENTS[i];
        if (hasAch(a.id) && before.indexOf(a.id) < 0) fresh.push(a.id);
    }
    return fresh;
}

// ---------- 成就墙交互接线：V 键开关由下方全局 keydown 统一分派；遮罩空白处与 × 按钮点击关闭 ----------
achWall.addEventListener('click', e => {
    if (e.target === achWall && achPanelOpen) toggleAchPanel();
});
document.getElementById('achClose').addEventListener('click', toggleAchPanel);

/* ===================== 每日一题 ===================== */

/**
 * 取本地日期串：每日一题的唯一标识，跨日自动切换新题
 * @returns {string} 本地日期 YYYY-MM-DD
 */
function dailyKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

/**
 * FNV-1a 32 位哈希：把日期串均匀散列到布局池
 * （直接对日期数字取模会因日期的规律递增产生周期性偏置，散列后分布均匀）
 * @param {string} s 输入字符串（当日日期）
 * @returns {number} 32 位无符号散列值
 */
function hashStr(s) {
    let h = 0x811c9dc5; // FNV-1a 标准偏移基值
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193); // FNV 质数乘法（32 位回绕）
    }
    return h >>> 0; // 转无符号，避免后续取模出现负数
}

/**
 * 计算今日一题对应的布局序号：日期哈希对布局数取模，同一天必同一题
 * @returns {number} 今日布局在 LAYOUTS 中的下标
 */
function dailyIndex() {
    return hashStr(dailyKey()) % LAYOUTS.length;
}

/**
 * 读取今日一题的完成步数
 * @returns {number} 当日已完成的最少步数（0 表示今日尚未完成）
 */
function readDailyDone() {
    const v = parseInt(safeGet(DAILY_KEY + '_' + dailyKey()) || '0', 10);
    return Number.isNaN(v) ? 0 : v;
}

/**
 * 刷新开始遮罩上的每日一题信息行：今日题目名 + 完成状态
 * （开始遮罩仅在进页/重开时可见，静态刷新一次即可）
 */
function updateDailyLine() {
    const done = readDailyDone();
    dailyLineElement.textContent = done > 0
        ? `今日一题 · ${LAYOUTS[dailyIndex()].name} · 已完成 ${done} 步`
        : `今日一题 · ${LAYOUTS[dailyIndex()].name}`;
}

/**
 * 计算本次通关评级：
 * ① 基础等级：步数 / BFS 最优步数的比率对照 RANK_TIERS 逐档判定；
 * ② 提示封顶：按本局 hintsUsed 对照 RANK_HINT_CAPS，取"原等级与封顶中更差者"
 * @returns {string} 评级字符（S/A/B/C；无最优基准时兜底 C）
 */
function computeRank() {
    if (optimalMoves <= 0) return 'C'; // 求解失败无基准：不给高分
    const ratio = moves / optimalMoves; // 步数越接近最优解比率越小
    let rank = 'C';
    for (const tier of RANK_TIERS) {
        if (ratio <= tier.ratio) { rank = tier.rank; break; } // 先命中先得
    }
    for (const rule of RANK_HINT_CAPS) {
        if (hintsUsed <= rule.maxHints) {
            // 原等级优于封顶（下标更小）则降至封顶；本就低于封顶则不动
            if (RANK_ORDER.indexOf(rank) < RANK_ORDER.indexOf(rule.cap)) rank = rule.cap;
            break;
        }
    }
    return rank;
}

/**
 * 应用难度相关的界面状态：大师难度下将侧栏撤销按钮置灰禁用，
 * 并按难度刷新提示次数配额（新手无限 / 进阶每局 3 次 / 大师禁用）
 */
function applyDifficultyUi() {
    undoBtnElement.disabled = currentDiffId() === 'hard';
    updateHintQuota();
}

/**
 * 更新侧栏统计显示：步数 / 用时（整秒变化时）/ 最少步纪录 / 提示次数 / 最佳评级；
 * 步数变化瞬间触发数字跳动反馈（放大回弹动画）
 */
function updateHud() {
    // 步数变化时：更新文本并以 WAAPI 播放弹跳（scale 1 → 1.35 → 1）
    if (lastMovesShown !== moves) {
        lastMovesShown = moves;
        moveElement.textContent = moves;
        moveElement.animate(
            [
                { transform: 'scale(1)' },
                { transform: 'scale(1.35)' },
                { transform: 'scale(1)' }
            ],
            { duration: 180, easing: 'ease-out' }
        );
    }
    bestElement.textContent = bestMoves > 0 ? bestMoves : '—';
    // 提示次数显示：大师为 —、新手为 ∞、进阶为剩余次数（变化时才写 DOM）
    const hintLabel = currentDiffId() === 'hard' ? '—'
        : currentDiffId() === 'easy' ? '∞' : String(hintLeft);
    if (lastHintShown !== hintLabel) {
        lastHintShown = hintLabel;
        hintElement.textContent = hintLabel;
    }
    // 最佳评级显示（按当前难度+布局），尚无纪录时显示 —
    if (lastRankShown !== bestRank) {
        lastRankShown = bestRank;
        rankElement.textContent = bestRank || '—';
    }
}

/**
 * 装载指定序号的布局：重置棋子、计步、计时、撤销栈与特效状态，
 * 恢复该布局的最少步纪录；开始遮罩显示期间保持 ready，否则直接进入 playing
 * @param {number} index 布局序号（对应 LAYOUTS 下标）
 */
function loadLayout(index) {
    layoutIndex = index;
    const layout = LAYOUTS[index];
    // 深拷贝棋子并补齐运行时字段（拖拽偏移 / 补间 / 挤压 / 回弹 / 入场），
    // 入场按棋子序号负延迟，实现错峰依次浮现
    pieces = layout.pieces.map((src, i) => ({
        ...src,
        dragOffX: 0, dragOffY: 0, anim: null,
        enter: { t: -i * ENTER_STAGGER } // 负值表示尚未登场，等待各自出场时机
    }));
    selected = pieces.find(p => p.t === 'cao'); // 默认选中曹操
    moves = 0;
    elapsed = 0;
    lastShownSec = -1;
    isPaused = false; // 新局/重开/换局复位暂停标记，避免上一局的暂停态卡住新局
    pauseScreen.style.display = 'none'; // 同步隐藏暂停面板（复位暂停标记时遮罩一并撤下）
    undoStack.length = 0;
    confetti.length = 0;
    confettiDelay = 0;
    dustPool.clear(); // 归还全部尘土粒子（池对象保留复用）
    sparkPool.clear(); // 归还临门金星（原实现此处漏清，顺带修复换局残留）
    escape = null;
    lastMovesShown = 0;
    trails.length = 0;
    trailTimer = 0;
    nearExit = false;
    wallBlend = 0; // 墙体金化复位：新局从常态红墙开始
    comboCount = 0; // 新局连击状态清零
    comboTimer = 0;
    floaters.length = 0; // 清空残留飘字
    goText = null; // 清空开演字幕（换局重开时不重复播"开演"）
    tenseFired = false; // 逼近纪录紧张音复位：新局可重新触发
    shake = 0;
    winRevealTimer = 0;
    demoActive = false; // 新局复位演示状态：任何换局/重开都会终止进行中的演示
    demoPath = null;
    demoTimer = 0;
    demoWin = false;
    drag = null;
    hint = null; // 新局清空提示展示
    hintPath = null; // 新局清空解路径缓存
    hintPending = false; // 新局取消在途提示求解（回调经局代次校验自动丢弃）
    lastHintShown = '';
    lastRankShown = '';
    updateHintQuota(); // 新局按当前难度刷新提示次数配额
    hintsUsed = 0; // 新局提示使用计数归零
    isNewRecord = false;
    bestMoves = readBest(layout.id, currentDiffId()); // 纪录按 难度+布局 分键读取
    bestRank = readRank(layout.id, currentDiffId()); // 最佳评级按 难度+布局 分键读取
    // BFS 求解初始布局的最优步数作为评级基准（异步执行不阻塞开局渲染，
    // 回调校验局代次——换局/重开后旧结果作废）；取长度后即弃解路径缓存，
    // 避免玩家未按 H 时残留"初始局面解"导致后续提示跳步
    optimalMoves = 0; // 异步求解就绪前的兜底（0 = 未知，此间通关评级按 C）
    const gen = ++solveGen; // 捕获本局代次：回调时已换局则丢弃
    requestSolve(encodeBoard(), path => {
        if (gen !== solveGen) return; // 已换局/重开：过期结果丢弃
        optimalMoves = path ? path.length : 0;
    });
    hintPath = null;
    if (state !== 'ready') state = 'playing';
    winScreen.style.display = 'none'; // 通关面板中切换布局时同步收起结算遮罩
    updateHud();
}

/**
 * 将当前局进度镜像为纯数据快照写入 localStorage（键 arcade_save_klotski，与其它
 * 街机游戏同一契约）：仅在游戏进行中（含暂停中，state 为 playing）写入；处于开始
 * 界面（未开始）或已通关时转为清除快照（快照只服务于未打完的局）。整体 try/catch
 * 静默，存储不可用（隐私模式 / 配额满）等异常不影响游戏本体。
 * 快照字段（首字段固定版本号 v，读取时不匹配立即视为无效）：
 *   v       快照格式版本，恒为 1
 *   layout  布局标识（LAYOUTS 的 id，恢复时据此切到对应布局）
 *   diff    难度标识（DIFF_IDS 的 id，辅助规则与存档棋面绑定）
 *   pieces  全部棋子当前位置数组 [[x, y]...]（与布局棋子表顺序一一对应）
 *   moves   当前步数
 */
function saveSnapshot() {
    // 仅进行中的棋局值得存档：已通关 / 未开始时转为清除，防止下次误续玩打完或没开的局
    if (state === 'playing') {
        // 组装纯数据快照：仅含数值 / 字符串 / 数组，不含任何函数与 DOM 引用，可安全 JSON 序列化
        const snap = {
            v: 1, // 结构版本号：读取时不匹配立即视为无效
            layout: LAYOUTS[layoutIndex].id, // 布局标识：恢复时据此切到对应布局
            diff: currentDiffId(), // 难度标识：辅助规则不同，存档与难度绑定
            pieces: pieces.map(p => [p.x, p.y]), // 全部棋子当前位置（按布局棋子表顺序对应）
            moves: moves // 当前步数
        };
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
        } catch (e) { /* 存储不可用 / 配额满时静默放弃，不影响游戏 */ }
    } else {
        // 游戏未开始 / 已通关：不留快照
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 静默 */ }
    }
}

/**
 * 清除进度快照存档（键 arcade_save_klotski）：通关结算 / 手动重开 / 切换布局 /
 * 启动演示时调用，避免下次进入页面误续玩一局已被废弃的棋局；存储不可用时静默跳过
 */
function clearSnapshot() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* 存储受限时同样静默跳过 */ }
}

/**
 * 从 localStorage 读取进度快照并恢复续玩状态（键 arcade_save_klotski）：
 * 逐字段校验版本号 / 布局与难度标识可解析 / 棋子数量与该布局棋子表一致 /
 * 各棋子整数坐标且在棋盘界内 / 所有棋子两两互不重叠 / 步数为非负整数，
 * 任一校验失败即清除快照并返回 false（调用方回退默认新开局流程），绝不因脏数据抛错。
 * 校验通过后：切到快照的布局与难度，重新装载布局后把棋子摆到快照局面并同步步数，
 * 返回 true 由调用方直接进入可玩状态。
 * @returns {boolean} 快照合法并已恢复返回 true；无快照或快照非法返回 false
 */
function restoreSnapshot() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false; // 无快照：正常新开局，无需清理
        const snap = JSON.parse(raw);
        // 版本号不符（损坏或未来格式）：立即弃用并清除
        if (!snap || typeof snap !== 'object' || snap.v !== 1) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 布局标识：字符串且能在布局表中找到对应项（恢复时据此切到该布局）
        const li = typeof snap.layout === 'string'
            ? LAYOUTS.findIndex(l => l.id === snap.layout) : -1;
        if (li < 0) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 难度标识：字符串且能在难度表中找到对应项（辅助规则与存档棋面绑定）
        const di = typeof snap.diff === 'string' ? DIFF_IDS.indexOf(snap.diff) : -1;
        if (di < 0) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        const layout = LAYOUTS[li];
        // 棋子位置数组：数量必须与该布局的棋子表完全一致（按序一一对应）
        if (!Array.isArray(snap.pieces) || snap.pieces.length !== layout.pieces.length) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }
        // 逐棋子校验：整数坐标、按棋子自身宽高判定在棋盘界内；
        // 同步维护占用矩阵保证所有棋子两两互不重叠（逻辑同 buildGrid）
        const grid = [];
        for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(false));
        for (let i = 0; i < snap.pieces.length; i++) {
            const pos = snap.pieces[i];
            const src = layout.pieces[i];
            if (!Array.isArray(pos) || !Number.isInteger(pos[0]) || !Number.isInteger(pos[1])) {
                localStorage.removeItem(SAVE_KEY);
                return false;
            }
            // 界内判定：左上角非负，且按宽高推算的右 / 下边缘不超出棋盘
            if (pos[0] < 0 || pos[1] < 0 || pos[0] + src.w > COLS || pos[1] + src.h > ROWS) {
                localStorage.removeItem(SAVE_KEY);
                return false;
            }
            // 重叠判定：占据的每个格子均不得被先前棋子占用，校验通过后标记占用
            for (let cy = pos[1]; cy < pos[1] + src.h; cy++) {
                for (let cx = pos[0]; cx < pos[0] + src.w; cx++) {
                    if (grid[cy][cx]) {
                        localStorage.removeItem(SAVE_KEY);
                        return false;
                    }
                    grid[cy][cx] = true;
                }
            }
        }
        // 步数：非负整数
        if (!Number.isInteger(snap.moves) || snap.moves < 0) {
            localStorage.removeItem(SAVE_KEY);
            return false;
        }

        // ---------- 校验全部通过：切布局 / 难度并恢复局面 ----------
        // 切到快照布局（含按钮高亮与布局选择持久化，与侧栏 selectLayout 行为一致）
        if (li !== layoutIndex) {
            layoutIndex = li;
            localStorage.setItem(LAYOUT_KEY, String(li));
            document.querySelectorAll('.layout-btn').forEach((b, i) => b.classList.toggle('active', i === li));
        }
        // 切到快照难度（含按钮高亮、难度选择持久化与辅助开关刷新，与 selectDifficulty 行为一致）
        if (di !== diffIndex) {
            diffIndex = di;
            safeSet(DIFF_KEY, String(di)); // 难度持久化：续玩恢复上次难度（隐私模式写失败静默，不影响本局恢复）
            document.querySelectorAll('.diff-btn').forEach((b, i) => b.classList.toggle('active', i === di));
            applyDifficultyUi(); // 大师难度：同步置灰侧栏撤销按钮
        }
        loadLayout(layoutIndex); // 重新装载：复位全部局内状态并按快照布局 / 难度刷新纪录显示
        // 把棋子摆到快照局面并同步步数（撤销栈清空：快照之前的历史不再可回退）
        for (let i = 0; i < layout.pieces.length; i++) {
            pieces[i].x = snap.pieces[i][0];
            pieces[i].y = snap.pieces[i][1];
        }
        moves = snap.moves;
        undoStack.length = 0;
        invalidateHint(); // 恢复的棋面与任何旧缓存无关：提示展示与解路径缓存作废
        // 按恢复后的棋面重新求解最优步数作为评级基准（loadLayout 请求的是初始棋面的解，
        // 已随棋面变动过期；旧结果经局代次校验自动丢弃）
        optimalMoves = 0;
        const gen = ++solveGen; // 捕获本局代次：恢复后再换局 / 重开则过期结果丢弃
        requestSolve(encodeBoard(), path => {
            if (gen !== solveGen) return; // 已换局 / 重开：过期结果丢弃
            optimalMoves = path ? path.length : 0;
        });
        updateHud(); // 步数等统计与恢复后的局面同步
        return true;
    } catch (e) {
        // 任何异常（JSON 损坏 / 存储不可用等）：清除快照并按无存档处理，绝不向上抛错
        try { localStorage.removeItem(SAVE_KEY); } catch (e2) { /* 静默 */ }
        return false;
    }
}

/**
 * 侧栏布局按钮点击：高亮切换、持久化选择并重开该布局
 * @param {HTMLButtonElement} btn 被点击的布局按钮（data-index 为布局序号）
 */
function selectLayout(btn) {
    document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    safeSet(LAYOUT_KEY, btn.dataset.index); // 隐私模式写失败静默，不影响本局布局切换
    clearSnapshot(); // 切换布局：旧布局的进行中棋局被放弃，清除其进度快照
    SFX.klLayout(); // 换局专属：木质翻牌音（替代通用点击音，更具换局仪式感）
    loadLayout(parseInt(btn.dataset.index, 10));
}

/**
 * 侧栏难度按钮点击：高亮切换、持久化选择并刷新难度相关界面；
 * 棋面保留不重开（难度只影响提示/撤销辅助），最少步纪录按新难度刷新显示
 * @param {HTMLButtonElement} btn 被点击的难度按钮（data-index 为难度序号）
 */
function selectDifficulty(btn) {
    const idx = parseInt(btn.dataset.index, 10);
    if (idx === diffIndex) return; // 重复点击当前难度：无操作
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    diffIndex = idx;
    safeSet(DIFF_KEY, String(idx)); // 隐私模式写失败静默，不影响本局难度切换
    applyDifficultyUi(); // 大师难度：同步置灰侧栏撤销按钮
    bestMoves = readBest(LAYOUTS[layoutIndex].id, currentDiffId()); // 纪录随难度切换显示
    bestRank = readRank(LAYOUTS[layoutIndex].id, currentDiffId()); // 最佳评级随难度切换显示
    updateHud();
    SFX.uiClick();
}

/**
 * 开始游戏（开始遮罩按钮）：隐藏遮罩并进入 playing，开始计时
 */
function startGame() {
    // 移除按钮焦点，避免随后按空格/回车时误触发按钮
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    startScreen.style.display = 'none';
    state = 'playing';
    SFX.start();
    SFX.bgm.start('klotski'); // 进入对局：起华容道专属古风 BGM（通关/重开时停止）
    goText = { t: 0 }; // 启动"开 演"金字开演字幕：本局的开幕仪式感
    SFX.klGo(); // 古风号角三连音：延迟起奏与通用 start 琶音错峰
}

/**
 * 重开当前布局（结算面板"再来一局"与侧栏"重开"共用）：隐藏全部遮罩重新装载
 */
function restartLayout() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    startScreen.style.display = 'none';
    winScreen.style.display = 'none';
    clearSnapshot(); // 主动重开：放弃当前进度并清除快照
    loadLayout(layoutIndex);
    SFX.bgm.start('klotski'); // 再来一局：重新起 BGM（上一局结束时已停止）
}

/**
 * 切换暂停状态（空格手动暂停/继续）：仅进行中的棋局可暂停；
 * 回合制也需要暂停——用时统计（elapsed）参与评级与纪录，
 * 暂停期间 elapsed 累加与演示步进一并冻结，保证计时公平
 */
function togglePause() {
    if (state !== 'playing') return; // ready/won 阶段无计时需求，不响应暂停
    isPaused = !isPaused;
    hoverPiece = null; // 暂停时清除悬停高亮，避免遮罩下仍显示可动棋子提示
    pauseScreen.style.display = isPaused ? 'block' : 'none'; // 同步暂停面板显隐（DOM 形态与开始/胜利面板一致）
    // BGM 随暂停挂起/恢复，与游戏节奏同步
    if (isPaused) {
        endDrag(); // 拖拽中暂停：立即终止手势并回弹，防止暂停遮罩下残留 drag 在恢复时误走子
        SFX.bgm.pause();
        SFX.uiPause(); // 暂停：下行收束音，标记时间冻结（替代原 uiClick 的敷衍反馈）
    } else {
        SFX.bgm.resume();
        SFX.uiResume(); // 继续：上行启动音，标记重新出发
    }
}

/* ===================== H 键提示求解器 ===================== */

/** 求解器用：棋子类型 → 网格编码字符（同型棋子互换视为同一状态，压缩搜索空间） */
const HINT_CHAR = { cao: 'C', guan: 'G', gen: 'V', sol: 'S' };
/** 求解器用：编码字符 → [宽, 高] */
const HINT_SIZE = { C: [2, 2], G: [2, 1], V: [1, 2], S: [1, 1] };
/** 求解器用：四个滑动方向 [dx, dy] */
const HINT_DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * 使当前提示与解路径缓存失效：棋面发生任何变化（滑动/撤销/换局）后调用，
 * 避免展示与新局面不符的过期建议
 */
function invalidateHint() {
    hintPath = null;
    hint = null;
}

/**
 * 按当前难度刷新本局提示次数配额：
 * 新手=无限次 / 进阶=每局 NORMAL_HINT_QUOTA 次 / 大师=禁用（0 次）
 */
function updateHintQuota() {
    const d = currentDiffId();
    hintLeft = d === 'easy' ? Infinity : d === 'normal' ? NORMAL_HINT_QUOTA : 0;
}

/** Worker 求解器实例（Blob 内联，主线程零阻塞）；创建失败置 solverBroken 降级 */
let solverWorker = null;
/** 求解请求自增 id：Worker 响应按 id 路由到对应回调 */
let solveSeq = 0;
/** 在途求解请求表（id → 回调），Worker 回调按 id 路由到对应请求 */
const pendingSolves = new Map();
/** 求解结果缓存（初始局面编码 → 最短路径）：同一局面的重复求解零计算 */
const solveCache = new Map();
/** 在途求解合并表（初始局面编码 → 等待回调队列）：并发同源请求共享一次计算 */
const inflightSolves = new Map();
/** 解缓存容量上限：超限后停写（不逐出），防止超长会话内存缓慢膨胀 */
const SOLVE_CACHE_LIMIT = 64;
/** Worker 创建失败降级标志：为 true 时所有求解请求直接回调空解，不卡游戏 */
let solverBroken = false;
/** 局代次：loadLayout 时 ++，求解回调比对丢弃换局/重开前的过期结果 */
let solveGen = 0;

/**
 * Worker 主体（toString 后注入 Blob 运行于子线程，禁止引用外部闭包变量）：
 * 收 init 消息取主线程下发的求解常量（COLS/ROWS/EXIT_POS/HINT_* 等，单一来源），
 * 收 solve 消息执行 BFS 求解并回传 { id, path }。
 * BFS 逻辑：棋面编码为 20 格字符串（同型棋子互换视为同一状态去重，
 * 经典布局状态空间约 6.6 万），逐层扩展"任一块四方向滑 1 格"的后继，
 * 访问表记录前驱与首步信息，抵达通关局面后回溯得到完整最短路径
 * @param {Object} ctx Worker 全局 self（提供 onmessage / postMessage）；
 *          亦可注入 mock ctx（如 node 沙盒）用于直接驱动求解逻辑做单元验证
 */
function klotskiSolverMain(ctx) {
    let C = null; // 主线程 init 下发的求解常量容器
    // 通关局面判定：曹操四个占格全部落在出口位（左上角抵达 EXIT_POS）
    const isGoal = s =>
        s[C.EXIT_POS.y * C.COLS + C.EXIT_POS.x] === 'C' &&
        s[C.EXIT_POS.y * C.COLS + C.EXIT_POS.x + 1] === 'C' &&
        s[(C.EXIT_POS.y + 1) * C.COLS + C.EXIT_POS.x] === 'C' &&
        s[(C.EXIT_POS.y + 1) * C.COLS + C.EXIT_POS.x + 1] === 'C';
    /**
     * 从 BFS 访问表回溯指定状态的完整路径，并反转为"从当前局面出发"的步序
     * @param {Map} visit BFS 访问表（键=状态编码，值={ prev, t, x, y, dx, dy }）
     * @param {string} s 目标状态编码（通关局面）
     * @returns {Array} 最短路径 [{ t, x, y, dx, dy }, ...]
     */
    function buildPath(visit, s) {
        const path = [];
        let cur = s;
        while (visit.get(cur)) {
            const info = visit.get(cur);
            path.push({ t: info.t, x: info.x, y: info.y, dx: info.dx, dy: info.dy });
            cur = info.prev;
        }
        path.reverse();
        return path;
    }
    /**
     * BFS 求解：从 start 编码到曹操抵达出口的最短滑动序列
     * @param {string} start 起始局面 20 格编码
     * @returns {Array|null} 最短路径 [{ t, x, y, dx, dy }, ...]（t 为编码字符，
     *          x/y 为滑动棋子原左上角格坐标，dx/dy 为滑动方向）；
     *          超出 HINT_SEARCH_LIMIT 或搜索耗尽无解时返回 null
     */
    function solve(start) {
        // 访问表兼作去重与路径回溯（值 = { prev, t, x, y, dx, dy }）
        const visit = new Map([[start, null]]);
        let frontier = [start];
        let expanded = 0;
        while (frontier.length > 0) {
            const next = [];
            for (const s of frontier) {
                if (isGoal(s)) return buildPath(visit, s);
                if (++expanded > C.HINT_SEARCH_LIMIT) return null; // 状态数超限：放弃求解防卡死
                // 枚举所有块的左上角：矩形内全为同字符即为有效块
                // （行优先扫描保证块的左上角先于块内其他格被枚举，
                //   块内其余格经 seen 去重跳过，相邻同型棋子各自成块、互不吞并）
                const seen = new Set();
                for (let y = 0; y < C.ROWS; y++) {
                    for (let x = 0; x < C.COLS; x++) {
                        const c = s[y * C.COLS + x];
                        if (c === '.' || seen.has(y * C.COLS + x)) continue;
                        const [w, h] = C.HINT_SIZE[c];
                        let solid = true;
                        for (let by = y; by < y + h && solid; by++) {
                            for (let bx = x; bx < x + w; bx++) {
                                if (s[by * C.COLS + bx] !== c) { solid = false; break; }
                            }
                        }
                        // 矩形混入异字符：当前格不是有效块起点，防御性标记后跳过
                        if (!solid) { seen.add(y * C.COLS + x); continue; }
                        // 标记该块覆盖格为已见，避免同一块被重复枚举
                        for (let by = y; by < y + h; by++) {
                            for (let bx = x; bx < x + w; bx++) seen.add(by * C.COLS + bx);
                        }
                        // 生成四方向滑 1 格的后继状态（先清空自身格再判空：
                        // 滑动目标区与原位置的重叠部分是块自身，不算障碍，
                        // 否则除 1×1 兵卒外的所有块都将永远无法滑动）
                        for (const [dx, dy] of C.HINT_DIRS) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx < 0 || ny < 0 || nx + w > C.COLS || ny + h > C.ROWS) continue;
                            // 构造工作副本：先清空自身占据的格，再检查目标矩形是否全空
                            const cells = s.split('');
                            for (let by = y; by < y + h; by++) {
                                for (let bx = x; bx < x + w; bx++) cells[by * C.COLS + bx] = '.';
                            }
                            let free = true;
                            for (let by = ny; by < ny + h && free; by++) {
                                for (let bx = nx; bx < nx + w; bx++) {
                                    if (cells[by * C.COLS + bx] !== '.') { free = false; break; }
                                }
                            }
                            if (!free) continue;
                            // 新位置填入，得到后继状态编码
                            for (let by = ny; by < ny + h; by++) {
                                for (let bx = nx; bx < nx + w; bx++) cells[by * C.COLS + bx] = c;
                            }
                            const ns = cells.join('');
                            if (!visit.has(ns)) {
                                visit.set(ns, { prev: s, t: c, x, y, dx, dy });
                                next.push(ns);
                            }
                        }
                    }
                }
            }
            frontier = next;
        }
        return null; // 搜索耗尽仍无解（华容道布局必有解，此处为兜底防护）
    }
    ctx.onmessage = e => {
        const m = e.data;
        if (m.type === 'init') { C = m.consts; return; } // 主线程下发求解常量
        if (m.type === 'solve') ctx.postMessage({ id: m.id, path: solve(m.start) });
    };
}

/**
 * 惰性创建 Blob 内联 Worker：将 klotskiSolverMain 函数源码注入 Blob 起子线程
 * （单文件自包含，file:// 协议下亦可运行），并下发 init 消息同步求解常量；
 * 创建失败（如极端环境不支持 Worker）或运行期出错（onerror）均置 solverBroken
 * 走降级路径，不阻塞游戏
 * @returns {Worker|null} 可用的 Worker 实例；不可用时返回 null
 */
function ensureSolver() {
    if (solverWorker || solverBroken) return solverWorker;
    try {
        const blob = new Blob(['(' + klotskiSolverMain.toString() + ')(self);'], { type: 'application/javascript' });
        solverWorker = new Worker(URL.createObjectURL(blob));
        // init 下发求解常量：Worker 侧仅此一份定义（主线程常量为单一来源）
        solverWorker.postMessage({ type: 'init', consts: { COLS, ROWS, EXIT_POS, HINT_SEARCH_LIMIT, HINT_CHAR, HINT_SIZE, HINT_DIRS } });
        solverWorker.onmessage = e => {
            const cb = pendingSolves.get(e.data.id);
            if (!cb) return; // 无对应请求（过期响应竞态防御）：丢弃
            pendingSolves.delete(e.data.id);
            cb(e.data.path);
        };
        // 运行期错误兜底（线程内脚本异常等）：与创建失败同样永久降级——
        // 在途请求逐个以 null 回调（包装回调会向 inflight 等待队列群发空解，
        // 评级兜底 C / 提示与演示拒绝求解），随后清空两张请求表、复位提示
        // 在途标记（避免 H 键被永久锁死），置 broken 并释放 Worker 引用，
        // 后续求解请求直接同步回调空解，不再尝试重建
        solverWorker.onerror = () => {
            for (const cb of pendingSolves.values()) cb(null);
            pendingSolves.clear();
            inflightSolves.clear();
            hintPending = false;
            solverBroken = true; // Worker 运行期出错：求解功能降级，不阻塞游戏
            solverWorker = null;
        };
    } catch (e) {
        solverBroken = true; // Worker 不可用：求解功能降级，不阻塞游戏
    }
    return solverWorker;
}

/**
 * 异步请求一次 BFS 求解（主线程零阻塞，结果零浪费），按三态分派：
 * ① 缓存命中——同步回调既有解，零计算零等待（开局评级基准即刻可用、
 *    演示零延迟开播、提示撤销回走的中间局面顺带命中）；
 * ② 在途合并——同局面并发请求挂入等待队列，共享一次 Worker 计算；
 * ③ 未命中——发往 Worker，结果回填缓存后群发全部等待回调。
 * 仅缓存有效解（null 不缓存），保证失败后重试仍会真正求解；
 * Worker 不可用时立即以 null 回调（评级兜底 C / 提示与演示拒绝求解）
 * @param {string} start 起始局面 20 格编码（encodeBoard 产物）
 * @param {Function} cb 回调 (path: Array|null)，path 为最短路径步序或 null（失败/降级）
 */
function requestSolve(start, cb) {
    const cached = solveCache.get(start);
    if (cached) { cb(cached); return; } // 缓存命中：同步回调，不产生任何求解开销
    const waiting = inflightSolves.get(start);
    if (waiting) { waiting.push(cb); return; } // 在途合并：挂入队列共享既有的那次求解
    const w = ensureSolver();
    if (!w) { cb(null); return; } // 降级：直接回调空解
    inflightSolves.set(start, [cb]); // 本请求为该局面的首个求解者，建立等待队列
    const id = ++solveSeq;
    pendingSolves.set(id, path => {
        const queue = inflightSolves.get(start); // 取出全部等待方后群发同一份结果
        inflightSolves.delete(start);
        if (path && solveCache.size < SOLVE_CACHE_LIMIT) solveCache.set(start, path);
        for (const fn of queue) fn(path);
    });
    w.postMessage({ type: 'solve', id, start });
}

/**
 * 将当前棋面编码为 20 格字符串：每格填入所覆盖棋子的类型字符（HINT_CHAR），
 * 空格为 '.'；作为 Worker 求解的输入与"棋面是否已变动"的比对指纹
 * @returns {string} 20 格局面编码
 */
function encodeBoard() {
    const grid = [];
    for (let i = 0; i < COLS * ROWS; i++) grid.push('.');
    for (const p of pieces) {
        const c = HINT_CHAR[p.t];
        for (let y = p.y; y < p.y + p.h; y++) {
            for (let x = p.x; x < p.x + p.w; x++) grid[y * COLS + x] = c;
        }
    }
    return grid.join('');
}

/**
 * 请求一次 H 键提示（按难度差异化）：
 * 大师禁用或配额用尽 → 钝响 + 轻震拒绝；提示展示中重复按 → 仅刷新时长不扣次数；
 * 解缓存可用 → 同步取下一步；否则异步求解（在途重复按静默等待），
 * 回调经局代次 + 棋面编码双校验丢弃过期结果后再展示
 */
function requestHint() {
    if (state !== 'playing' || isPaused) return;
    const diff = currentDiffId();
    if (diff === 'hard' || hintLeft <= 0) {
        SFX.klBlock(); // 大师禁用 / 配额用尽：钝响 + 轻震反馈
        shake = SHAKE_TIME;
        return;
    }
    // 当前提示仍在展示：推荐步骤尚未执行，刷新展示时长即可，不重复扣次数
    if (hint) {
        hint.t = 0;
        SFX.klHint();
        return;
    }
    if (hintPath) { showHintStep(hintPath.shift(), diff); return; } // 缓存命中：同步取下一步
    if (hintPending) return; // 求解在途：重复按键静默等待回调
    const start = encodeBoard(); // 快照当前棋面：回调时比对是否已变动
    const gen = solveGen; // 捕获当前局代次：回调时已换局/切难度则丢弃
    hintPending = true;
    requestSolve(start, path => {
        hintPending = false;
        if (gen !== solveGen) return; // 请求后已换局/重开/切难度：过期结果丢弃
        if (state !== 'playing' || isPaused) return;
        if (encodeBoard() !== start) return; // 棋面已变动：丢弃（可再按 H 重新求解）
        if (!path || path.length === 0) { SFX.klBlock(); return; } // 求解失败：钝响提示
        hintPath = path;
        showHintStep(hintPath.shift(), diff);
    });
}

/**
 * 展示一步提示：按步序定位推荐棋子，高亮滑动方向并扣减配额
 * （解缓存命中与异步求解回调两条路径共用的展示逻辑）
 * @param {{ t: string, x: number, y: number, dx: number, dy: number }} step
 *        解路径中的一步（t 为编码字符，x/y 为棋子左上角格坐标，dx/dy 为滑动方向）
 * @param {string} diff 当前难度 id（进阶难度消耗提示配额）
 */
function showHintStep(step, diff) {
    const piece = pieces.find(p => HINT_CHAR[p.t] === step.t && p.x === step.x && p.y === step.y);
    if (!piece) { hintPath = null; return; } // 缓存与棋面不同步（invalidateHint 已兜底，防御）：重建缓存
    hint = { piece, dx: step.dx, dy: step.dy, t: 0 };
    hintsUsed++; // 评级封顶依据：本局已展示的新提示数（重复按 H 刷新不计数）
    if (diff === 'normal') {
        hintLeft--; // 进阶难度消耗配额并同步侧栏显示
        updateHud();
    }
    SFX.klHint();
    selected = piece; // 选中推荐棋子：方向键可直接跟进执行
}

/* ===================== 最佳解演示系统 ===================== */

/**
 * 启动最佳解演示：重开当前布局回到初始棋面后异步 BFS 求解完整最优路径
 * （按格步计的最短通关序列，各布局均可求解），开演仪式先行、
 * 解就绪后补"最佳步数"飘字，随后按固定节奏逐步自动执行直至通关；
 * 演示进行中再次触发则中断演示、保留当前棋面转入手动操作。
 * 通关走完整庆祝演出，但不写最少步纪录与评级（非玩家成绩）
 */
function startDemo() {
    if (isPaused) return; // 暂停中不响应演示（与键盘暂停屏蔽一致：先恢复再演示）
    if (demoActive) { stopDemo(); return; } // 演示中再次触发：中断并交还控制权
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    startScreen.style.display = 'none';
    winScreen.style.display = 'none';
    clearSnapshot(); // 演示从初始棋面开始：放弃当前进度快照
    loadLayout(layoutIndex); // 重置到初始布局，保证展示的是完整最优解
    state = 'playing'; // 开始遮罩中触发演示也直接开演（与 startGame 同效）
    SFX.bgm.start('klotski'); // 观演同样进入对局氛围：起 BGM（通关时停止）
    // 开演仪式先行（最优解异步求解中，主线程零阻塞）：起手停顿看清初始棋面
    demoActive = true;
    hoverPiece = null; // 演示态清空悬停所指：避免开演瞬间残留上一刻的微光误导观演（写法与 togglePause 一致）
    setCursor('default'); // 同步复位光标为常态，演示中指针不表示可操作
    demoPath = null; // 最优解仍在异步求解：stepDemo 以小步等待回调
    demoTimer = 0.6; // 首步稍作停顿，让玩家先看清初始棋面
    goText = { t: 0 }; // 复用开演字幕："开 演"金字给演示仪式感
    SFX.klGo();
    updateHud();
    const gen = solveGen; // loadLayout 内已 ++，此处捕获当前局代次
    requestSolve(encodeBoard(), path => {
        // 演示已中断 / 已换局 / 已有解（重复回调防御）：过期结果丢弃
        if (!demoActive || gen !== solveGen || demoPath) return;
        if (!path || path.length === 0) {
            SFX.klBlock(); // 求解失败（华容道布局必有解，此处为防御兜底）：钝响 + 轻震
            shake = SHAKE_TIME;
            stopDemo();
            return;
        }
        demoPath = path;
        // 开演飘字：金色标注本次复现的最佳步数（BFS 格步口径，随布局不同）
        floaters.push({
            text: `最佳解 · ${path.length} 步`,
            x: PAD + BOARD_W / 2,
            y: PAD + BOARD_H * 0.32,
            t: 0,
            dur: 1.6,
            color: '#ffd23e'
        });
    });
}

/**
 * 中断演示：清空演示状态并保留当前棋面转入手动操作
 * （棋面为演示走到的中途局面，可正常继续游玩、撤销或重开）
 */
function stopDemo() {
    if (!demoActive) return;
    demoActive = false;
    demoPath = null;
    demoTimer = 0;
    // 绿色飘字告知已交还控制权
    floaters.push({
        text: '演示已中断',
        x: PAD + BOARD_W / 2,
        y: PAD + BOARD_H * 0.32,
        t: 0,
        dur: 1.1,
        color: '#7dff8a'
    });
}

/**
 * 演示步进推进（渲染循环每帧调用）：倒计时归零后从快照弹出下一步，
 * 按编码字符与左上角坐标定位对应棋子并执行 1 格滑动；
 * 最后一步经由 trySlide 内部 checkWin 触发通关演出与"最佳解复现"结算
 * @param {number} dt 距上帧的秒数
 */
function stepDemo(dt) {
    if (!demoActive || state !== 'playing' || isPaused) return; // 暂停中冻结演示步进倒计时
    demoTimer -= dt;
    if (demoTimer > 0) return;
    if (!demoPath) { demoTimer = 0.1; return; } // 最优解异步求解在途：小步等待开演
    const step = demoPath.length > 0 ? demoPath.shift() : null;
    if (!step) { stopDemo(); return; } // 无步可走却未通关（防御兜底）：中断演示
    const piece = pieces.find(p => HINT_CHAR[p.t] === step.t && p.x === step.x && p.y === step.y);
    if (!piece) { stopDemo(); return; } // 快照与棋面失步（理论不发生）：防御性中断
    trySlide(piece, step.dx, step.dy, 1); // 复用统一滑动结算（补间动画/音效/计步/通关检查）
    demoTimer = DEMO_STEP_INTERVAL; // 重置步进倒计时，等待下一拍
}

/* ===================== 特效系统 ===================== */

/**
 * 撒下通关金纸屑：从棋盘顶部一排随机位置生成 CONFETTI_COUNT 片彩色纸屑
 */
function spawnConfetti() {
    // prefers-reduced-motion：纸屑为纯装饰演出，数量减半降低动态密度
    const count = FX.prefersReduced ? Math.ceil(CONFETTI_COUNT / 2) : CONFETTI_COUNT;
    for (let i = 0; i < count; i++) {
        confetti.push({
            x: PAD + Math.random() * BOARD_W,
            y: -10 - Math.random() * 80, // 顶部上方错开出片高度，形成先后飘落
            vx: (Math.random() - 0.5) * 30,
            vy: 40 + Math.random() * 60,
            rot: Math.random() * Math.PI * 2,
            vr: (Math.random() - 0.5) * 6,
            w: 4 + Math.random() * 5,
            h: 6 + Math.random() * 8,
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            sway: Math.random() * Math.PI * 2 // 左右摇摆相位
        });
    }
}

/**
 * 采样一枚棋子的当前视觉轮廓（含拖拽/补间偏移）并压入滑动残影队列
 * @param {object} p 目标棋子
 */
function spawnTrail(p) {
    const pos = pieceDrawPos(p);
    trails.push({
        x: PAD + (pos.x + p.dragOffX) * CELL + 3,
        y: PAD + (pos.y + p.dragOffY) * CELL + 3,
        w: p.w * CELL - 6,
        h: p.h * CELL - 6,
        glow: PIECE_STYLE[p.t].glow,
        life: TRAIL_LIFE
    });
}

/**
 * 落位扬尘：棋子滑入落位瞬间，从底边两角左右交替迸出一撮暖灰尘土，
 * 微微上抛后被重力拉回，营造"啪"一下落地的重量感
 * @param {object} p 目标棋子
 */
function spawnDust(p) {
    const pos = pieceDrawPos(p);
    const bottom = PAD + (pos.y + p.dragOffY + p.h) * CELL - 4; // 底边略上，避免穿入墙体
    const left = PAD + (pos.x + p.dragOffX) * CELL + 6;
    const right = left + p.w * CELL - 12;
    for (let i = 0; i < DUST_COUNT; i++) {
        const fromLeft = i % 2 === 0; // 左右交替迸出，视觉更均衡
        const d = dustPool.obtain(); // 从池中取粒子（满员自动征用最旧，演出永不断流）
        d.x = fromLeft ? left + Math.random() * 14 : right - Math.random() * 14;
        d.y = bottom - Math.random() * 6;
        d.vx = (fromLeft ? -1 : 1) * (30 + Math.random() * 60); // 向外侧抛射
        d.vy = -(20 + Math.random() * 55); // 微微上抛，随后被重力拉回
        d.r = 2 + Math.random() * 2.5;
        d.life = DUST_LIFE * (0.7 + Math.random() * 0.5);
    }
}

/**
 * 临门金星迸发：曹操一步即可入出口的瞬间，沿曹操顶边迸出一圈金色四角星，
 * 带旋转与重力坠落，配合临门脉冲高亮营造"胜利在望"的闪耀感
 * @param {object} cao 曹操棋子
 */
function spawnSparks(cao) {
    const pos = pieceDrawPos(cao);
    const top = PAD + (pos.y + cao.dragOffY) * CELL + 4;
    const left = PAD + (pos.x + cao.dragOffX) * CELL + 4;
    const w = cao.w * CELL - 8;
    // prefers-reduced-motion：金星为纯装饰演出，数量减半降低动态密度
    const count = FX.prefersReduced ? Math.ceil(SPARK_COUNT / 2) : SPARK_COUNT;
    for (let i = 0; i < count; i++) {
        const s = sparkPool.obtain(); // 从池中取粒子（满员自动征用最旧，演出永不断流）
        s.x = left + Math.random() * w; // 沿曹操顶边随机迸出
        s.y = top + Math.random() * 10;
        s.vx = (Math.random() - 0.5) * 130; // 左右四散
        s.vy = -(60 + Math.random() * 90); // 向上抛射后被重力拉回
        s.rot = Math.random() * Math.PI;
        s.vr = (Math.random() - 0.5) * 6; // 旋转速度（弧度/秒）
        s.size = 3 + Math.random() * 3.5;
        s.life = SPARK_LIFE * (0.7 + Math.random() * 0.5);
    }
}

/**
 * 推进全部特效计时器（rAF 每帧调用，won 状态下演出仍需更新）：
 * 滑动补间动画 / 落位挤压弹跳 / 回弹补间 / 棋盘入场浮现 /
 * 滑动残影采样与衰减 / 落位尘土粒子 / 临门金星迸发与推进 / 曹操临门探测 /
 * 逃脱演出推进 / 纸屑延迟撒放与飘落 / 画面震动 / H 键提示倒计时 /
 * 连击窗口倒计时 / 飘字推进 / 开演字幕推进 / 舞台浮尘循环 / 墙体金化趋近 /
 * 通关面板延迟显示 / 用时累计
 * @param {number} dt 距上帧的秒数
 */
function updateEffects(dt) {
    // 逐棋子推进四类动画：入场浮现 / 滑动补间（到时触发落位挤压+扬尘）/
    // 挤压推进 / 回弹推进
    for (const p of pieces) {
        // 入场动画推进：错峰延迟（负值）走完后进入浮现，到时移除
        if (p.enter) {
            p.enter.t += dt;
            if (p.enter.t >= ENTER_DUR) p.enter = null;
        }
        if (p.anim) {
            p.anim.t += dt;
            if (p.anim.t >= SLIDE_DUR) {
                // 落位瞬间：按本次滑动轴向触发挤压弹跳（纵向滑动压扁、横向滑动压窄）
                const axis = p.anim.fy !== p.y ? 'y' : 'x';
                p.anim = null;
                p.squash = { t: 0, axis };
                spawnDust(p); // 落位扬起一撮尘土
                SFX.klSnap(); // 落位吸附"咔哒"，与起滑音形成"滑—哒"节奏
            }
        }
        // 落位挤压推进：到时移除
        if (p.squash) {
            p.squash.t += dt;
            if (p.squash.t >= SQUASH_DUR) p.squash = null;
        }
        // 回弹补间推进：拖拽偏移按 ease-out 收敛回原格，归零后移除
        if (p.bounce) {
            p.bounce.t += dt;
            const k = Math.min(p.bounce.t / BOUNCE_DUR, 1);
            const e = 1 - (1 - k) * (1 - k);
            p.dragOffX = p.bounce.bx * (1 - e);
            p.dragOffY = p.bounce.by * (1 - e);
            if (k >= 1) {
                p.bounce = null;
                p.dragOffX = 0;
                p.dragOffY = 0;
            }
        }
        // 通关欢呼弹跳推进：负延迟错峰等待 → 单峰正弦跳起 → 到时移除
        if (p.celebrate) {
            p.celebrate.t += dt;
            if (p.celebrate.t >= CELEBRATE_DUR) p.celebrate = null;
        }
    }
    // 滑动残影采样：补间/回弹/拖拽中的棋子按固定间隔记录当前轮廓
    trailTimer += dt;
    if (trailTimer >= TRAIL_INTERVAL) {
        trailTimer = 0;
        for (const p of pieces) {
            const dragging = drag && drag.p === p && drag.off > 0.05;
            if (p.anim || p.bounce || dragging) {
                spawnTrail(p);
                if (trails.length > TRAIL_MAX) trails.shift(); // 超限丢弃最旧
            }
        }
    }
    // 残影寿命衰减：到时移除
    for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].life -= dt;
        if (trails[i].life <= 0) trails.splice(i, 1);
    }
    // 尘土粒子推进：池活跃区正向遍历，重力下坠 + 水平空气阻力衰减，sweep 回收死粒零分配
    for (let i = 0; i < dustPool.n; i++) {
        const d = dustPool.items[i];
        d.life -= dt;
        d.vy += DUST_GRAVITY * dt;
        d.vx *= 1 - 2.5 * dt; // 空气阻力：水平速度指数衰减
        d.x += d.vx * dt;
        d.y += d.vy * dt;
    }
    dustPool.sweep();
    // 临门金星推进：池活跃区正向遍历，重力下坠 + 自旋，sweep 回收死粒零分配
    for (let i = 0; i < sparkPool.n; i++) {
        const s = sparkPool.items[i];
        s.life -= dt;
        s.vy += SPARK_GRAVITY * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.rot += s.vr * dt;
    }
    sparkPool.sweep();
    // 曹操临门探测：一步下滑即可抵达出口时点亮临门高亮。
    // 性能取舍：slideRange 内部经 buildGrid 每次新建占用矩阵数组，逐帧调用会
    // 产生每帧小数组分配的 GC 压力；改为零分配的位置指纹比对——任何滑动/拖拽/
    // 撤销/换局都会改变棋子坐标使指纹失配，指纹一致时棋面必然未变、直接复用
    // 上次探测结果，探测时点与结果同逐帧探测完全一致，不引入行为差异
    if (state === 'playing') {
        let fp = 0;
        // 累积全部棋子坐标为单一指纹：每子取 x*5+y+1（值域 1~20 唯一编码一格位置），
        // 10 次乘 31 后约 8.2e14，处于双精度 53 位安全整数范围内，无碰撞风险
        for (const p of pieces) fp = fp * 31 + p.x * 5 + p.y + 1;
        if (fp !== nearExitFp) {
            nearExitFp = fp;
            const cao = pieces.find(p => p.t === 'cao');
            const was = nearExit;
            nearExit = !!cao && cao.x === EXIT_POS.x && cao.y < EXIT_POS.y
                && slideRange(cao, 0, 1) >= EXIT_POS.y - cao.y;
            if (nearExit && !was) {
                SFX.klNear(); // 临门点亮瞬间：轻快双哔提示
                spawnSparks(cao); // 金星迸发：胜利在望的闪耀感
            }
        }
    }
    // 逃脱演出推进：曹操冲出出口下滑渐隐（时长由 drawPiece 与 drawBoard 消费）
    if (escape) escape.t += dt;
    // H 键提示展示倒计时：到时自动熄灭（棋面变动会经 invalidateHint 提前清除）
    if (hint) {
        hint.t += dt;
        if (hint.t >= HINT_DUR) hint = null;
    }
    // 纸屑延迟撒放：逃脱演出先行片刻后再撒，形成"曹操冲出 → 普天同庆"节奏
    if (confettiDelay > 0) {
        confettiDelay -= dt;
        if (confettiDelay <= 0) {
            confettiDelay = 0;
            spawnConfetti();
        }
    }
    // 纸屑：缓慢下落 + 左右摇摆 + 旋转，落出画布底部即移除
    for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vy = Math.min(c.vy + CONFETTI_GRAVITY * dt, CONFETTI_MAX_SPEED);
        c.sway += dt * 2.2;
        c.x += (c.vx + Math.sin(c.sway) * 26) * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
        if (c.y > viewH + 20) confetti.splice(i, 1);
    }
    // 画面震动衰减
    if (shake > 0) shake -= dt;
    // 曹操临门墙体金化：向目标值（临门=1，否则=0）指数趋近，红墙平滑镀金/褪金
    wallBlend += ((nearExit ? 1 : 0) - wallBlend) * Math.min(dt * 6, 1);
    // 连击窗口倒计时：归零断链清零计数（撤销已在 undoMove 内即时清零）
    if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
            comboTimer = 0;
            comboCount = 0;
        }
    }
    // 飘字推进：上浮 + 寿命衰减，到时移除
    for (let i = floaters.length - 1; i >= 0; i--) {
        floaters[i].t += dt;
        if (floaters[i].t >= floaters[i].dur) floaters.splice(i, 1);
    }
    // 开演字幕推进：到时收幕移除
    if (goText) {
        goText.t += dt;
        if (goText.t >= GO_DUR) goText = null;
    }
    // 舞台浮尘：首帧惰性生成（此时画布尺寸已就绪），此后持续上浮循环；
    // prefers-reduced-motion：纯氛围微尘无功能性作用，整体跳过生成
    if (!ambientDustReady) {
        ambientDustReady = true;
        if (!FX.prefersReduced) {
            for (let i = 0; i < AMBIENT_DUST_COUNT; i++) {
                ambientDust.push({
                    x: Math.random() * viewW,
                    y: Math.random() * viewH,
                    r: 0.8 + Math.random() * 1.7, // 半径 0.8~2.5px 的微尘颗粒
                    spd: 6 + Math.random() * 10, // 上浮速度 6~16 px/s
                    phase: Math.random() * Math.PI * 2 // 横摆正弦相位
                });
            }
        }
    }
    for (const d of ambientDust) {
        d.y -= d.spd * dt; // 缓缓上浮
        d.phase += dt;
        d.x += Math.sin(d.phase * 1.3) * 6 * dt; // 轻微正弦横摆
        if (d.y < -4) {
            // 飘出顶部：回绕到底部随机位置，形成永续循环
            d.y = viewH + 4;
            d.x = Math.random() * viewW;
        }
    }
    // 用时累计（仅进行中且未暂停且成就墙未打开；rAF 后台暂停 + dt 封顶 + isPaused 门控，
    // 手动暂停/失焦暂停/切后台/看成就墙均不会虚增用时——回合制的计时同样要求公平）
    if (state === 'playing' && !isPaused && !achPanelOpen) {
        elapsed += dt;
        const sec = Math.floor(elapsed);
        if (sec !== lastShownSec) {
            lastShownSec = sec;
            timeElement.textContent = formatTime(elapsed);
        }
    }
    // 通关面板延迟显示：倒计时结束后填充数据并弹出
    if (winRevealTimer > 0) {
        winRevealTimer -= dt;
        if (winRevealTimer <= 0) {
            winRevealTimer = 0;
            animateCountUp(finalMovesElement, moves, v => String(v)); // 步数滚动落定
            animateCountUp(finalTimeElement, elapsed, formatTime);    // 用时滚动落定
            if (demoWin) {
                // 演示复现结算：金星徽章 + 最佳解说明（不展示评级与新纪录，非玩家成绩）
                newRecordElement.style.display = 'none';
                dailyDoneElement.style.display = 'none'; // 演示不算每日一题成绩
                achUnlockedElement.style.display = 'none'; // 演示不写成就，亦不展示解锁提示
                winRankElement.textContent = '★';
                winRankElement.className = 'rank-badge rank-s';
                winRankDescElement.textContent = `最佳解复现 · ${moves} 步（BFS 最优 ${optimalMoves} 步）`;
            } else {
                newRecordElement.style.display = isNewRecord ? 'block' : 'none';
                // 每日一题完成标记：当日布局的玩家通关在结算面板点亮
                dailyDoneElement.style.display = layoutIndex === dailyIndex() ? 'block' : 'none';
                // 成就解锁提示：本次通关有新成就时绿色展示成就名（顿号连接多个）
                if (freshAchievements.length > 0) {
                    const names = freshAchievements.map(id => {
                        const meta = KLOTSKI_ACHIEVEMENTS.find(a => a.id === id);
                        return meta ? meta.name : id;
                    }).join('、');
                    achUnlockedElement.textContent = '成就解锁：' + names;
                    achUnlockedElement.style.display = 'block';
                } else {
                    achUnlockedElement.style.display = 'none';
                }
                // 评级徽章：大字评级 + 分级配色 class；副标题展示评级依据
                winRankElement.textContent = currentRank;
                winRankElement.className = 'rank-badge rank-' + currentRank.toLowerCase();
                winRankDescElement.textContent = optimalMoves > 0
                    ? `步数 ${moves} / 最优 ${optimalMoves} · 提示 ${hintsUsed} 次`
                    : `提示 ${hintsUsed} 次`;
                if (currentRank === 'S') SFX.klRankS(); // S 级专属：评级揭晓时刻的华丽琶音
            }
            winScreen.style.display = 'block';
        }
    }
}

/**
 * 数字滚动动画：让数值从 0 以 ease-out 曲线滚升到目标值（结算面板步数/用时专用）
 * @param {HTMLElement} el 目标文本元素
 * @param {number} target 目标数值
 * @param {function(number): string} format 数值格式化函数（步数直接转字符串、用时格式化为 mm:ss）
 */
function animateCountUp(el, target, format) {
    const DURATION = 600; // 滚动总时长（毫秒）
    const start = performance.now();
    /**
     * 单帧滚动：按 ease-out cubic 插值刷新文本，未到终点则继续下一帧
     * @param {number} now 当前帧时间戳（毫秒）
     */
    function tick(now) {
        const k = Math.min(1, (now - start) / DURATION);
        const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic：先快后慢落定
        el.textContent = format(Math.round(target * eased));
        if (k < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

/**
 * 将秒数格式化为 mm:ss
 * @param {number} s 总秒数
 * @returns {string} "分:秒" 两位补零字符串
 */
function formatTime(s) {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/* ===================== 绘制 ===================== */

/**
 * 棋盘底座织锦纹理（离屏画布缓存）：深底 + 45° 双向斜纹 + 径向暗角，
 * 加载时构建一次，每帧仅 drawImage 贴图，零重绘开销
 */
const boardTexture = (() => {
    const c = document.createElement('canvas');
    c.width = BOARD_W;
    c.height = BOARD_H;
    const g = c.getContext('2d');
    // 深红木底色
    g.fillStyle = '#1a0f12';
    g.fillRect(0, 0, BOARD_W, BOARD_H);
    // 45° 双向织物斜纹：极低透明度交织出锦缎底纹（与网格线同一色系更协调）
    g.strokeStyle = 'rgba(255, 85, 64, 0.035)';
    g.lineWidth = 1;
    g.beginPath();
    for (let d = -BOARD_H; d < BOARD_W; d += 9) {
        g.moveTo(d, 0); g.lineTo(d + BOARD_H, BOARD_H); // 右下斜纹族
        g.moveTo(d + BOARD_H, 0); g.lineTo(d, BOARD_H); // 左下斜纹族
    }
    g.stroke();
    // 四角暗角：径向渐变让边缘下沉、中央微微抬起，增强棋盘纵深
    const vg = g.createRadialGradient(BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.2, BOARD_W / 2, BOARD_H / 2, BOARD_W * 0.75);
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
    g.fillStyle = vg;
    g.fillRect(0, 0, BOARD_W, BOARD_H);
    return c;
})();

/**
 * 绘制棋盘底座：织锦底纹（离屏缓存贴图）+ 淡色网格线 + 出口目标虚线框 +
 * 出口开口常时呼吸微光 + 临门墙体红金渐变 + 逃脱演出特效（出口金光柱 + 起手爆闪）
 * @param {number} now 当前帧时间戳（毫秒），驱动临门高亮的急促脉冲相位
 */
function drawBoard(now) {
    // 棋盘底板：贴织锦底纹（离屏缓存，替代纯色填充）
    ctx.drawImage(boardTexture, PAD, PAD);
    // 淡色网格线
    ctx.strokeStyle = 'rgba(255, 85, 64, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx < COLS; gx++) {
        ctx.moveTo(PAD + gx * CELL + 0.5, PAD);
        ctx.lineTo(PAD + gx * CELL + 0.5, PAD + BOARD_H);
    }
    for (let gy = 1; gy < ROWS; gy++) {
        ctx.moveTo(PAD, PAD + gy * CELL + 0.5);
        ctx.lineTo(PAD + BOARD_W, PAD + gy * CELL + 0.5);
    }
    ctx.stroke();
    // 出口目标虚线框：曹操的最终落位（底部中央 2×2）；
    // 临门状态下切换为急促金色脉冲 + 底色泛光，提示一步可入出口
    const ex = PAD + EXIT_POS.x * CELL + 4;
    const ey = PAD + EXIT_POS.y * CELL + 4;
    const ew = CELL * 2 - 8;
    const eh = CELL * 2 - 8;
    const pulse = nearExit ? 0.5 + 0.5 * Math.sin(now / 90) : 0; // 急促脉冲相位
    ctx.save();
    if (nearExit) {
        ctx.fillStyle = `rgba(255, 210, 62, ${0.05 + 0.12 * pulse})`;
        ctx.fillRect(ex, ey, ew, eh);
        ctx.shadowColor = 'rgba(255, 210, 62, 0.9)';
        ctx.shadowBlur = 8 + 12 * pulse;
    }
    ctx.strokeStyle = nearExit
        ? `rgba(255, 230, 130, ${0.6 + 0.35 * pulse})`
        : 'rgba(255, 210, 62, 0.45)';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = nearExit ? 2.5 : 2;
    ctx.strokeRect(ex, ey, ew, eh);
    ctx.restore();
    // 墙体边框：上/左/右整边 + 底边两段（中央两格宽留作出口开口）；
    // 曹操临门时墙体由红向金平滑镀金（wallBlend 指数趋近），发光随之增强——
    // 整座棋盘都在为"一步之遥"的胜利预热
    const wg = Math.round(85 + 125 * wallBlend); // 绿通道 85 → 210（红 → 金）
    const wb = Math.round(64 - 2 * wallBlend); // 蓝通道 64 → 62（微调保持暖调）
    ctx.strokeStyle = `rgb(255, ${wg}, ${wb})`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowColor = `rgba(255, ${wg}, ${wb}, 0.6)`;
    ctx.shadowBlur = 10 + 10 * wallBlend * pulse; // 临门时发光随脉冲呼吸增强
    ctx.beginPath();
    const L = PAD, T = PAD, R = PAD + BOARD_W, B = PAD + BOARD_H;
    const EXIT_L = PAD + CELL, EXIT_R = PAD + CELL * 3;
    ctx.moveTo(L, B); ctx.lineTo(L, T); ctx.lineTo(R, T); ctx.lineTo(R, B); // 上左右连笔
    ctx.moveTo(L, B); ctx.lineTo(EXIT_L, B); // 底边左段
    ctx.moveTo(EXIT_R, B); ctx.lineTo(R, B); // 底边右段
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 出口提示：双箭头 + 文字（出口提示区内居中）
    ctx.fillStyle = 'rgba(255, 210, 62, 0.85)';
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▼ ▼ 出口 EXIT ▼ ▼', PAD + BOARD_W / 2, PAD + BOARD_H + EXIT_H / 2);
    // 出口开口常时呼吸微光：金色向上渐变光晕慢速呼吸，引导视线指向通关目标
    const breathe = 0.10 + 0.06 * (0.5 + 0.5 * Math.sin(now / 900)); // 慢呼吸相位（约 5.6s 周期）
    const glowH = CELL * 0.9; // 微光在棋盘内的高度
    const glowGrad = ctx.createLinearGradient(0, PAD + BOARD_H + EXIT_H, 0, PAD + BOARD_H - glowH);
    glowGrad.addColorStop(0, `rgba(255, 210, 62, ${breathe})`);
    glowGrad.addColorStop(1, 'rgba(255, 210, 62, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(PAD + CELL, PAD + BOARD_H - glowH, CELL * 2, glowH + EXIT_H);
    // 逃脱演出：出口开口射出金光柱（自下而上渐隐）+ 起手白金爆闪
    if (escape) {
        const s = Math.min(escape.t / ESCAPE_DUR, 1);
        // 光柱强度：前 0.15s 快速升至峰值，随后缓慢衰减至熄灭
        const beam = s < 0.17 ? s / 0.17 : Math.max(1 - (s - 0.17) / 0.83, 0);
        const flash = escape.t < ESCAPE_FLASH_DUR ? 1 - escape.t / ESCAPE_FLASH_DUR : 0;
        const bx = PAD + CELL;
        const bw = CELL * 2; // 出口开口宽度（底部中央两格）
        ctx.save();
        if (beam > 0) {
            // 金色光柱：从出口开口向上覆盖整个棋盘通道，底部亮顶部透明
            const beamGrad = ctx.createLinearGradient(0, PAD + BOARD_H + EXIT_H, 0, PAD);
            beamGrad.addColorStop(0, `rgba(255, 210, 62, ${0.45 * beam})`);
            beamGrad.addColorStop(1, 'rgba(255, 210, 62, 0)');
            ctx.fillStyle = beamGrad;
            ctx.fillRect(bx, PAD, bw, BOARD_H + EXIT_H);
        }
        if (flash > 0) {
            // 起手爆闪：曹操破门瞬间整个出口开口白金闪光
            ctx.fillStyle = `rgba(255, 245, 210, ${0.85 * flash})`;
            ctx.fillRect(bx, PAD + BOARD_H - 4, bw, EXIT_H + 4);
        }
        ctx.restore();
    }
}

/**
 * 计算棋子的当前绘制位置（格坐标，含补间动画插值）
 * @param {object} p 目标棋子
 * @returns {{x: number, y: number}} 绘制用格坐标（可为小数）
 */
function pieceDrawPos(p) {
    if (p.anim) {
        // 补间插值：从动画起点向当前逻辑位置过渡（ease-out 收尾）
        const k = 1 - Math.pow(1 - Math.min(p.anim.t / SLIDE_DUR, 1), 2);
        return { x: p.anim.fx + (p.x - p.anim.fx) * k, y: p.anim.fy + (p.y - p.anim.fy) * k };
    }
    return { x: p.x, y: p.y };
}

/* ===================== 棋子渐变缓存 ===================== */

/** 棋子渐变对象缓存：键为「类别|类型|尺寸」（创建参数一律使用 translate 后的棋子局部坐标系），值为可复用的 CanvasGradient */
const pieceGradCache = new Map();
/** 渐变缓存容量上限：溢出时整体清空，防止挤压/入场动画的瞬态尺寸使缓存无限膨胀 */
const PIECE_GRAD_CACHE_MAX = 256;

/**
 * 按缓存键取（未命中则创建）棋子渐变对象：
 * 渐变创建参数全部采用棋子局部坐标系（drawPiece 内 translate(x, y) 后），
 * 坐标仅取决于棋子类型与尺寸、与屏上位置无关，故实例可跨帧/跨棋子复用，
 * 消除每棋子每帧多次 createLinearGradient/createRadialGradient 的分配
 * （渲染结果与每次新建逐像素等价：绘制时 CTM 把局部坐标还原为同一直线坐标）
 * @param {string} key 缓存键：渐变类别 + 棋子类型 + 尺寸参数
 * @param {function(): CanvasGradient} make 未命中时执行一次的渐变创建工厂
 * @returns {CanvasGradient} 可复用的渐变对象
 */
function getCachedPieceGrad(key, make) {
    let g = pieceGradCache.get(key);
    if (!g) {
        // 容量上限兜底：清空仅导致对象重建，无任何视觉差异
        if (pieceGradCache.size >= PIECE_GRAD_CACHE_MAX) pieceGradCache.clear();
        g = make();
        pieceGradCache.set(key, g);
    }
    return g;
}

/**
 * 绘制单个棋子：圆角矩形 + 垂直渐变 + 霓虹描边发光 + 精细纹理装饰（确定性木质纹理线 /
 * 对角高光带 / 顶部受光带与底部·右侧内阴影 / 曹操锦缎菱格底纹、鎏金双线框、渐变铆钉、
 * 描边王冠、鎏金文字；关羽绦带纹、武将束带扣、兵卒圆环徽章）+ 浮雕文字；入场期间错峰
 * 缩放淡入；逃脱演出中曹操冲出出口下滑渐隐；悬停时白色微光描边；选中时附加呼吸光圈
 * （拖拽/动画期间使用实时绘制坐标）；整个绘制段在 translate(x, y) 的棋子局部坐标系内
 * 完成，各类渐变按「类型+尺寸」缓存复用
 * @param {object} p 目标棋子
 * @param {number} now 当前帧时间戳（毫秒），驱动选中呼吸相位
 */
function drawPiece(p, now) {
    // 入场错峰：延迟未到（负进度）时棋子尚未登场，直接跳过绘制
    if (p.enter && p.enter.t < 0) return;
    const pos = pieceDrawPos(p);
    const style = PIECE_STYLE[p.t];
    const px = PAD + (pos.x + p.dragOffX) * CELL;
    const py = PAD + (pos.y + p.dragOffY) * CELL;
    let w = p.w * CELL - 6;
    let h = p.h * CELL - 6;
    let x = px + 3;
    let y = py + 3;
    const r = 10;
    // 落位挤压：按滑动轴向做小幅压缩/拉伸（中心锚点），随时间弹性回正
    if (p.squash) {
        const s = Math.min(p.squash.t / SQUASH_DUR, 1);
        const a = Math.sin(s * Math.PI) * (1 - s * 0.35); // 冲击量：中段峰值、随进度衰减
        const sw = p.squash.axis === 'y' ? 1 + 0.10 * a : 1 - 0.12 * a;
        const sh = p.squash.axis === 'y' ? 1 - 0.12 * a : 1 + 0.10 * a;
        const dw = w * sw;
        const dh = h * sh;
        x -= (dw - w) / 2;
        y -= (dh - h) / 2;
        w = dw;
        h = dh;
    }
    // 全局透明度：入场淡入 / 逃脱渐隐共用，在绘制前统一应用
    let alpha = 1;
    // 入场浮现：ease-out cubic 缩放 0.55 → 1，前四成进度完成淡入
    if (p.enter) {
        const s = Math.min(p.enter.t / ENTER_DUR, 1);
        const e = 1 - Math.pow(1 - s, 3);
        const scale = 0.55 + 0.45 * e;
        const dw = w * scale;
        const dh = h * scale;
        x -= (dw - w) / 2;
        y -= (dh - h) / 2;
        w = dw;
        h = dh;
        alpha *= Math.min(s / 0.4, 1);
    }
    // 逃脱演出：曹操 ease-in 加速下滑冲出出口，后段渐隐至消失
    if (escape && p.t === 'cao') {
        const s = Math.min(escape.t / ESCAPE_DUR, 1);
        y += s * s * ESCAPE_SLIDE; // ease-in：先蓄力后加速，模拟破门冲刺
        alpha *= 1 - Math.min(s / 0.75, 1); // 前 3/4 进度完成渐隐
    }
    // 通关欢呼弹跳：负延迟错峰等待后按单峰正弦跳起再落回（群子依次庆祝）
    if (p.celebrate && p.celebrate.t > 0) {
        const cp = Math.min(p.celebrate.t / CELEBRATE_DUR, 1);
        y -= Math.sin(cp * Math.PI) * 9; // 正弦单峰：跳起 9px 后落回原位
    }

    // 本体：垂直渐变圆角矩形 + 外发光
    // （此处起整体进入棋子局部坐标系：translate(x, y) 后所有绘制/渐变参数均用局部坐标，
    //   使渐变可按「类型+尺寸」缓存复用；restore 于函数末尾统一闭合）
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(x, y);
    ctx.save(); // 阴影状态只覆盖本体填充段
    ctx.shadowColor = `rgba(${style.glow}, 0.55)`;
    ctx.shadowBlur = 12;
    const grad = getCachedPieceGrad('body|' + p.t + '|' + h, () => {
        const g = ctx.createLinearGradient(0, 0, 0, h); // 纵贯棋子全高（局部坐标）
        g.addColorStop(0, style.top);
        g.addColorStop(1, style.bottom);
        return g;
    });
    ctx.fillStyle = grad;
    roundRect(0, 0, w, h, r);
    ctx.fill();
    ctx.restore();
    // 内侧高光描边
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    roundRect(2, 2, w - 4, h - 4, r - 3);
    ctx.stroke();

    // 中心坐标提前计算：装饰纹样与文字排布共用（局部坐标系下的中心）
    const cx = w / 2;
    const cy = h / 2;

    // 立体质感装饰层：木质纹理 + 对角高光带 + 边缘光影 + 类型专属纹样（裁剪在本体内绘制）
    ctx.save();
    roundRect(0, 0, w, h, r);
    ctx.clip();
    // 木质纹理：基于棋子名的确定性伪随机水平波浪纹线（深浅交错），同一棋子每帧一致不闪烁
    let wseed = 7;
    for (let i = 0; i < p.n.length; i++) wseed = (wseed * 31 + p.n.charCodeAt(i)) | 0;
    const wrand = () => {
        wseed = (wseed * 9301 + 49297) % 233280;
        return wseed / 233280;
    };
    // 纹线数量按棋子逻辑高度自适应（用 p.h 而非变形后的 h，squash 时不会跳变）
    const grainCount = 4 + Math.floor((p.h * CELL) / 50);
    ctx.lineWidth = 1;
    for (let i = 0; i < grainCount; i++) {
        const gy = 10 + wrand() * (h - 20); // 避开上下边缘
        ctx.beginPath();
        ctx.moveTo(4, gy);
        const seg = (w - 8) / 4; // 四段微波浪拼出天然木纹的起伏
        for (let sx = seg; sx <= w - 7.5; sx += seg) {
            ctx.lineTo(4 + sx, gy + (wrand() - 0.5) * 3);
        }
        ctx.strokeStyle = i % 2 ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
        ctx.stroke();
    }
    // 曹操锦缎底纹：45° 双向细密斜线织出的暗金菱格（织锦质感，铺满本体）
    if (p.t === 'cao') {
        ctx.strokeStyle = 'rgba(255, 215, 120, 0.07)';
        ctx.beginPath();
        const gap = 11;
        for (let d = -h; d < w; d += gap) {
            ctx.moveTo(d, 0);
            ctx.lineTo(d + h, h); // 左上→右下线族
            ctx.moveTo(d + h, 0);
            ctx.lineTo(d, h); // 右上→左下线族
        }
        ctx.stroke();
    }
    // 对角高光带：左上→右下的白色渐隐斜光，模拟釉面棋子的反光质感
    const sheen = getCachedPieceGrad('sheen|' + w + '|' + h, () => {
        const g = ctx.createLinearGradient(0, 0, w, h); // 本体对角线（局部坐标）
        g.addColorStop(0, 'rgba(255, 255, 255, 0.30)');
        g.addColorStop(0.42, 'rgba(255, 255, 255, 0.06)');
        g.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        return g;
    });
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    // 顶部受光带：左上光源假设下的顶部微亮渐变（与底部阴影呼应出体积）
    const topLight = getCachedPieceGrad('toplight', () => {
        const g = ctx.createLinearGradient(0, 0, 0, 8); // 固定 8px 受光带（局部坐标，与棋子尺寸无关）
        g.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
        g.addColorStop(1, 'rgba(255, 255, 255, 0)');
        return g;
    });
    ctx.fillStyle = topLight;
    ctx.fillRect(0, 0, w, 8);
    // 底部内阴影带：下边缘暗色渐变，增强棋子的厚度与体量感
    const under = getCachedPieceGrad('under|' + h, () => {
        const g = ctx.createLinearGradient(0, h - 14, 0, h); // 固定 14px 暗带（局部坐标）
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
        return g;
    });
    ctx.fillStyle = under;
    ctx.fillRect(0, h - 14, w, 14);
    // 右侧内阴影带：与底部呼应，补全左上光源下的右侧转角暗面
    const side = getCachedPieceGrad('side|' + w, () => {
        const g = ctx.createLinearGradient(w - 8, 0, w, 0); // 固定 8px 暗带（局部坐标）
        g.addColorStop(0, 'rgba(0, 0, 0, 0)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.12)');
        return g;
    });
    ctx.fillStyle = side;
    ctx.fillRect(w - 8, 0, 8, h);
    // 类型专属纹样：关羽两端绦带 / 武将上下束带扣 / 兵卒字下徽章
    if (p.t === 'guan') {
        // 关羽：两端绦带纹——条纹主体 + 中央缎面高光线 + 上下菱形端饰（美髯公的战袍纹饰）
        for (const bx of [12, w - 16]) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
            ctx.fillRect(bx, 10, 4, h - 20);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
            ctx.fillRect(bx + 1.5, 12, 1, h - 24); // 缎面中央高光线
            for (const dy of [10, h - 10]) {
                ctx.save();
                ctx.translate(bx + 2, dy);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
                ctx.fillRect(-2.4, -2.4, 4.8, 4.8); // 上下菱形端饰
                ctx.restore();
            }
        }
    } else if (p.w === 1 && p.h === 2) {
        // 武将：上下对称束带——横条纹带 + 居中方形带扣（甲胄束带的意象）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.fillRect(12, 9, w - 24, 3);
        ctx.fillRect(12, h - 12, w - 24, 3);
        for (const by of [10.5, h - 10.5]) { // 带扣压在条纹中线
            ctx.fillStyle = 'rgba(4, 38, 63, 0.42)';
            ctx.fillRect(cx - 4, by - 3.5, 8, 7); // 扣体
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
            ctx.strokeRect(cx - 1.5, by - 1.5, 3, 3); // 扣孔亮边
        }
    } else if (p.w === 1 && p.h === 1) {
        // 兵卒：字下徽章——旋转菱形核心 + 细圆环包边（士卒的胸前徽章）
        ctx.save();
        ctx.translate(cx, cy + 20);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(42, 47, 85, 0.4)';
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
        ctx.strokeStyle = 'rgba(42, 47, 85, 0.30)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy + 20, 7, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    // 曹操专属装饰：鎏金双线框 + 渐变铆钉 + 描边王冠徽记（一代枭雄的仪式感）
    if (p.t === 'cao') {
        // 外层深金粗框 + 内层亮金细框：双层勾边的锦盒描金工艺
        ctx.strokeStyle = 'rgba(138, 90, 0, 0.55)';
        ctx.lineWidth = 1.5;
        roundRect(6, 6, w - 12, h - 12, r - 4);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(216, 164, 65, 0.30)';
        ctx.lineWidth = 0.75;
        roundRect(9.5, 9.5, w - 19, h - 19, r - 6);
        ctx.stroke();
        // 四角铆钉：径向渐变球体 + 左上高光点（金属圆钉的立体感）
        const rv = 10; // 铆钉中心距各角的内缩距离
        for (const [rx, ry] of [[rv, rv], [w - rv, rv], [rv, h - rv], [w - rv, h - rv]]) {
            ctx.save();
            ctx.translate(rx, ry); // 铆钉局部原点：渐变参数与铆钉尺寸固定，可全量缓存复用
            const rg = getCachedPieceGrad('rivet', () => {
                const g = ctx.createRadialGradient(-1, -1, 0.4, 0, 0, 2.6); // 偏左上受光（局部坐标）
                g.addColorStop(0, '#e0aa4a'); // 左上受光亮金
                g.addColorStop(1, '#774b00'); // 右下暗金
                return g;
            });
            ctx.fillStyle = rg;
            ctx.beginPath();
            ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 240, 200, 0.8)';
            ctx.beginPath();
            ctx.arc(-0.9, -0.9, 0.8, 0, Math.PI * 2); // 高光点
            ctx.fill();
            ctx.restore();
        }
        // 王冠徽记：金色渐变冠体 + 深金勾边 + 底座横条 + 中央圆珠高光，悬于主字上方
        const crownY = cy - 30; // 王冠底座基线
        const crownW = 44; // 王冠宽度
        ctx.save();
        ctx.translate(cx, crownY); // 王冠局部原点：渐变仅覆盖冠体固定 19px 高度，与棋子尺寸无关
        const cg = getCachedPieceGrad('crown', () => {
            const g = ctx.createLinearGradient(0, -14, 0, 5); // 冠尖到冠底（局部坐标）
            g.addColorStop(0, '#eec25e'); // 冠尖亮金
            g.addColorStop(1, '#9a6200'); // 冠底暗金
            return g;
        });
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(-crownW / 2, 0);
        ctx.lineTo(-crownW / 2, -10); // 左齿外沿
        ctx.lineTo(-crownW / 6, -3); // 左齿内谷
        ctx.lineTo(0, -13); // 中齿尖
        ctx.lineTo(crownW / 6, -3); // 右齿内谷
        ctx.lineTo(crownW / 2, -10); // 右齿外沿
        ctx.lineTo(crownW / 2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(96, 58, 0, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke(); // 冠体深金勾边
        ctx.fillStyle = cg;
        ctx.fillRect(-crownW / 2, 0, crownW, 4); // 底座横条
        ctx.strokeRect(-crownW / 2, 0, crownW, 4);
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(0, -15, 2.5, 0, Math.PI * 2); // 中央齿尖圆珠
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 245, 215, 0.9)';
        ctx.beginPath();
        ctx.arc(-0.8, -15.8, 0.8, 0, Math.PI * 2); // 圆珠高光点
        ctx.fill();
        ctx.restore();
    }

    // 棋子名文字：按形状决定排布（曹操大字横排 / 关羽横排 / 武将竖排 / 兵单字）；
    // paintLabel 内先画深色偏移底字再叠主字，营造浮雕立体感
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (p.w === 2 && p.h === 2) {
        paintLabel(p.n, cx, cy + 2, 'bold 37px "Microsoft YaHei", sans-serif', style.text, 'rgba(255, 215, 130, 0.55)'); // 曹操主字鎏金勾边
    } else if (p.w === 2 && p.h === 1) {
        paintLabel(p.n, cx, cy + 1, 'bold 28px "Microsoft YaHei", sans-serif', style.text);
    } else if (p.h === 2) {
        // 武将：竖排两字（每字居各自半格）
        const vFont = 'bold 26px "Microsoft YaHei", sans-serif';
        paintLabel(p.n[0], cx, cy - CELL / 2 + 2, vFont, style.text);
        paintLabel(p.n[1], cx, cy + CELL / 2 + 2, vFont, style.text);
    } else {
        paintLabel(p.n, cx, cy + 1, 'bold 28px "Microsoft YaHei", sans-serif', style.text);
    }

    // 悬停态：白色微光描边（未选中时的可拖拽暗示），拖拽进行中不显示
    if (hoverPiece === p && selected !== p && !drag) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
        ctx.shadowBlur = 7;
        roundRect(-1.5, -1.5, w + 3, h + 3, r + 1);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    // 选中态：金色呼吸光圈（棋子可拖拽期间同样高亮）
    if (selected === p) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 240);
        ctx.strokeStyle = `rgba(255, 210, 62, ${0.45 + 0.4 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(255, 210, 62, 0.8)';
        ctx.shadowBlur = 6 + 8 * pulse;
        roundRect(-3, -3, w + 6, h + 6, r + 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    ctx.restore(); // 闭合棋子局部坐标系（translate 一并还原）
    // 复位全局透明度（与原实现保持一致的函数末状态）
    ctx.globalAlpha = 1;
}

/**
 * 绘制带立体感的棋子文字：先画深色偏移底字再叠主字，营造浮雕立体感；
 * 可选传入描边色，在主字之下先描一圈（鎏金勾边效果）
 * @param {string} text 文字内容（单字或词）
 * @param {number} cx 文字中心 x 坐标
 * @param {number} cy 文字中心 y 坐标
 * @param {string} font 字体设置字符串（含字号与字族）
 * @param {string} color 主字颜色
 * @param {string} [strokeColor] 可选描边色（如曹操的鎏金勾边），不传则无描边
 */
function paintLabel(text, cx, cy, font, color, strokeColor) {
    ctx.font = font;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'; // 深色偏移底字：立体感的来源
    ctx.fillText(text, cx + 2, cy + 3);
    if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1;
        ctx.strokeText(text, cx, cy); // 主字勾边：鎏金/亮边工艺
    }
    ctx.fillStyle = color; // 主字覆盖其上
    ctx.fillText(text, cx, cy);
}

/**
 * 以当前路径画圆角矩形（只构建路径，填充/描边由调用方完成）
 * @param {number} x 左上角像素 x
 * @param {number} y 左上角像素 y
 * @param {number} w 宽度
 * @param {number} h 高度
 * @param {number} r 圆角半径
 */
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * 绘制滑动残影层：棋子滑动/拖拽过程中留下的渐隐发光轮廓（位于棋子层之下）
 */
function drawTrails() {
    for (const tr of trails) {
        const a = tr.life / TRAIL_LIFE; // 剩余寿命比例 → 透明度系数
        ctx.fillStyle = `rgba(${tr.glow}, ${0.10 * a})`;
        ctx.strokeStyle = `rgba(${tr.glow}, ${0.30 * a})`;
        ctx.lineWidth = 2;
        roundRect(tr.x, tr.y, tr.w, tr.h, 10);
        ctx.fill();
        ctx.stroke();
    }
}

/**
 * 绘制滑行落位扬起的尘土粒子层：暖灰白小圆点，随寿命渐隐消散（位于棋子层之上）
 */
function drawDust() {
    for (let i = 0; i < dustPool.n; i++) {
        const d = dustPool.items[i];
        const a = Math.min(d.life / DUST_LIFE, 1); // 剩余寿命比例 → 透明度系数
        ctx.fillStyle = `rgba(212, 196, 176, ${0.4 * a})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 绘制临门金色星星粒子层：四角星（纵横向细菱形叠成），随寿命渐隐并自旋
 * （位于尘土层与纸屑层之间）
 */
function drawSparks() {
    for (let i = 0; i < sparkPool.n; i++) {
        const s = sparkPool.items[i];
        const a = Math.min(s.life / SPARK_LIFE, 1); // 剩余寿命比例 → 透明度系数
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.fillStyle = `rgba(255, 224, 100, ${0.9 * a})`;
        ctx.beginPath();
        // 纵向细菱形
        ctx.moveTo(0, -s.size * 2);
        ctx.lineTo(s.size * 0.55, 0);
        ctx.lineTo(0, s.size * 2);
        ctx.lineTo(-s.size * 0.55, 0);
        ctx.closePath();
        // 横向细菱形（与纵向正交，叠成四角星）
        ctx.moveTo(-s.size * 2, 0);
        ctx.lineTo(0, s.size * 0.55);
        ctx.lineTo(s.size * 2, 0);
        ctx.lineTo(0, -s.size * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

/**
 * 绘制通关纸屑层：随旋转角度飘落的小矩形彩片
 */
function drawConfetti() {
    for (const c of confetti) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
    }
}

/**
 * 绘制一枚脉动发光的三角箭头（新手方向提示与 H 键推荐方向共用）
 * @param {number} ax 箭头锚点像素 x
 * @param {number} ay 箭头锚点像素 y
 * @param {number} dx 方向水平分量
 * @param {number} dy 方向垂直分量
 * @param {Array} rgb 发光色 [r, g, b]（供 rgba 模板拼接）
 * @param {number} pulse 脉动系数（0~1，驱动透明度与光晕强度）
 */
function drawPulseArrow(ax, ay, dx, dy, rgb, pulse) {
    const s = 9; // 箭头尺寸（像素）
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx)); // 三角形默认指向 +x，旋转对齐滑动方向
    ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${0.4 + 0.4 * pulse})`;
    ctx.shadowColor = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.8)`;
    ctx.shadowBlur = 6 + 6 * pulse;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, s * 0.8);
    ctx.lineTo(-s * 0.7, -s * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/**
 * 新手难度辅助提示：为选中棋子绘制可滑动方向上的绿色脉动箭头
 * （指向棋子外沿的空位，该方向锁死时不画）；
 * 仅新手难度且进行中、无拖拽手势时绘制
 * @param {number} now 当前帧时间戳（毫秒），驱动箭头呼吸脉动相位
 */
function drawMoveHints(now) {
    if (currentDiffId() !== 'easy' || state !== 'playing' || !selected || drag) return;
    const pulse = 0.55 + 0.45 * Math.sin(now / 300);
    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const cx = PAD + (selected.x + selected.w / 2) * CELL;
    const cy = PAD + (selected.y + selected.h / 2) * CELL;
    for (const [dx, dy] of dirs) {
        if (slideRange(selected, dx, dy) <= 0) continue; // 该方向锁死：不画箭头
        // 箭头锚点：棋子中心沿方向外移半格余，落在紧邻的可滑空位内
        const ax = cx + dx * (selected.w / 2 + 0.24) * CELL;
        const ay = cy + dy * (selected.h / 2 + 0.24) * CELL;
        drawPulseArrow(ax, ay, dx, dy, [125, 255, 138], pulse);
    }
}

/**
 * H 键提示层：为推荐棋子绘制青色脉冲光圈与滑动方向箭头
 * （脉冲节奏比新手绿箭头更急促，便于区分两类提示）
 * @param {number} now 当前帧时间戳（毫秒），驱动光圈脉动相位
 */
function drawHint(now) {
    if (!hint || state !== 'playing') return;
    const pulse = 0.55 + 0.45 * Math.sin(now / 160); // 更急促的脉冲，与新手绿箭头区分
    const p = hint.piece;
    // 青色光圈包裹推荐棋子
    ctx.strokeStyle = `rgba(53, 224, 255, ${0.5 + 0.45 * pulse})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(53, 224, 255, 0.9)';
    ctx.shadowBlur = 8 + 10 * pulse;
    roundRect(PAD + p.x * CELL + 1, PAD + p.y * CELL + 1, p.w * CELL - 2, p.h * CELL - 2, 12);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 方向箭头：锚点公式同新手方向提示（中心沿方向外移半格余）
    const ax = PAD + (p.x + p.w / 2) * CELL + hint.dx * (p.w / 2 + 0.24) * CELL;
    const ay = PAD + (p.y + p.h / 2) * CELL + hint.dy * (p.h / 2 + 0.24) * CELL;
    drawPulseArrow(ax, ay, hint.dx, hint.dy, [53, 224, 255], pulse);
}

/**
 * 绘制一帧完整画面：底板 → 网格 → 出口提示 → 拖拽落点虚影 → 滑动残影 →
 * 棋子（震动偏移包裹）→ 新手方向提示箭头 → H 键提示层 → 尘土粒子 →
 * 临门金星 → 纸屑 → 飘字/开演字幕 →（恢复变换后）舞台浮尘
 * @param {number} now 当前帧时间戳（毫秒），驱动选中呼吸相位
 */
function draw(now) {
    ctx.fillStyle = '#1a0f12';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    // 撞墙震动：随机偏移，振幅随剩余时间线性衰减
    if (shake > 0) {
        const amp = (shake / SHAKE_TIME) * 4;
        ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
    }
    drawBoard(now);
    drawDragGhost(); // 拖拽落点金色虚影：预示松手后的吸附位置
    drawTrails();
    for (const p of pieces) drawPiece(p, now);
    drawMoveHints(now); // 新手难度：选中棋子的可滑方向提示
    drawHint(now); // H 键提示：推荐棋子光圈 + 滑动方向箭头
    drawDust();
    drawSparks(); // 临门金星：四角星迸发
    drawConfetti();
    drawFloaters(); // 连击里程碑飘字
    drawGoText(); // 开局"开 演"金字字幕
    ctx.restore();
    drawAmbientDust(); // 舞台浮尘：绘制在最上层（不受震动偏移影响的全画布微尘）
    // ---- 暂停遮罩：压暗 + 提示（空格手动暂停与失焦自动暂停共用同一标记）；
    //      回合制也需要暂停——用时统计参与评级，遮罩上明示"计时已冻结" ----
    if (isPaused) {
        ctx.fillStyle = 'rgba(10, 5, 6, 0.58)';
        // 四周外扩覆盖，兼容震动偏移；置于浮尘之上再压暗，确保提示可读
        ctx.fillRect(-20, -20, viewW + 40, viewH + 40);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23e';
        ctx.font = '13px "Press Start 2P", monospace';
        ctx.fillText('PAUSED', viewW / 2, viewH / 2 - 16);
        ctx.fillStyle = '#d8b8b8';
        ctx.font = '12px "Microsoft YaHei", sans-serif';
        ctx.fillText('已暂停 · 按空格或点击继续（计时已冻结）', viewW / 2, viewH / 2 + 16);
    }
}

/**
 * 绘制拖拽落点虚影：拖拽超过半格后，在松手吸附的目标格画金色低透虚线框，
 * 预先展示棋子将去的位置（吸附预告，降低拖拽的不确定感）
 */
function drawDragGhost() {
    if (!drag || !drag.dir || drag.off <= 0.05) return;
    const n = Math.round(drag.off);
    if (n < 1) return; // 未过半格：松手会回弹，不画落点
    const p = drag.p;
    const gx = PAD + (p.x + drag.dir[0] * n) * CELL;
    const gy = PAD + (p.y + drag.dir[1] * n) * CELL;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 62, 0.45)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]); // 虚线边框：与实体棋子形成"虚位以待"的对比
    roundRect(gx + 3, gy + 3, p.w * CELL - 6, p.h * CELL - 6, 10);
    ctx.stroke();
    ctx.restore();
}

/**
 * 绘制连击里程碑飘字：弹性放大入场 + 上浮 + 淡出，
 * 逐档配色（绿 → 金 → 橙红）强化连击段位升格的爽快感
 */
function drawFloaters() {
    for (const f of floaters) {
        const pop = 0.6 + 0.4 * Math.min(f.t / 0.18, 1); // 弹性放大：0.18s 内从 0.6 → 1
        const p = f.t / f.dur;
        const alpha = f.t < 0.15 ? f.t / 0.15 : 1 - Math.max((p - 0.55) / 0.45, 0); // 短促淡入 + 后段淡出
        ctx.save();
        ctx.globalAlpha = Math.max(alpha, 0);
        ctx.fillStyle = f.color;
        ctx.font = `bold ${Math.round(22 * pop)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.fillText(f.text, f.x, f.y - 26 * p); // 上浮：随进度抬升 26px
        ctx.restore();
    }
}

/**
 * 绘制开局"开 演"金字字幕：弹性缩放入场（0.5 → 1.15 → 1 的回弹），
 * 短促淡入后缓慢淡出，为本局开启赋予开幕仪式感
 */
function drawGoText() {
    if (!goText) return;
    const t = goText.t;
    // 弹性缩放：前 0.25s 冲过头到 1.15，随后回落到 1
    const scale = t < 0.25 ? 0.5 + 0.65 * (t / 0.25) : 1.15 - 0.15 * Math.min((t - 0.25) / 0.35, 1);
    const alpha = t < 0.12 ? t / 0.12 : 1 - Math.max((t - 0.6) / (GO_DUR - 0.6), 0); // 快淡入 + 后 40% 淡出
    ctx.save();
    ctx.globalAlpha = Math.max(alpha, 0);
    ctx.translate(viewW / 2, PAD + BOARD_H / 2);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffd23e';
    ctx.font = 'bold 44px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 210, 62, 0.8)';
    ctx.shadowBlur = 18;
    ctx.fillText('开    演', 0, 0); // 字间留白营造戏台匾额的仪式感
    ctx.restore();
}

/**
 * 绘制舞台浮尘：暖白微尘带呼吸透明度缓缓上浮（厅内空气的"活气"），
 * 绘制于 restore 之后——覆盖全画布且不受震动偏移影响，模拟镜头外的空气层
 */
function drawAmbientDust() {
    for (const d of ambientDust) {
        const tw = 0.5 + 0.5 * Math.sin(d.phase * 2.1); // 呼吸相位
        ctx.fillStyle = `rgba(255, 224, 170, ${0.05 + 0.07 * tw})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ===================== 拖拽输入 ===================== */

/** 当前拖拽手势状态：{ p, sx, sy, dir, k, off, locked }，null 表示无手势 */
let drag = null;

/* ---------- 舞台几何缓存：避免每次指针事件（含悬停 pointermove）都强制布局读取 ---------- */

/** 画布 CSS 几何缓存（getBoundingClientRect 结果）：指针坐标换算时复用，null 表示尚未读取 */
let stageRect = null;
/** 缓存刷新排队标记：几何变化事件可能连续触发，只排一次刷新 */
let stageRectRefreshQueued = false;

/**
 * 重新读取画布 CSS 几何（全文件唯一 getBoundingClientRect 调用点）：
 * klotski.html 页尾 fitStage 会对舞台做等比 CSS 缩放，rect 随窗口/全屏变化，须以本函数刷新
 */
function refreshStageRect() {
    stageRect = canvas.getBoundingClientRect();
    stageRectRefreshQueued = false;
}

/**
 * 舞台几何可能变化（窗口缩放、全屏切换、加载重排）时安排一次缓存刷新：
 * klotski.js 先于页尾 fitStage 内联脚本加载，同一事件的监听先于 fitStage 执行，
 * 故用 rAF 排队——rAF 回调晚于本轮所有 setTimeout（arcade:fs 消息即以 setTimeout 排队 fitStage），
 * 确保读到缩放完成后的几何
 */
function queueStageRectRefresh() {
    if (stageRectRefreshQueued) return;
    stageRectRefreshQueued = true;
    requestAnimationFrame(refreshStageRect);
}

// fitStage 全部触发点对应的缓存失效：窗口缩放 / 全屏切换 / 页面加载 / 字体就绪重排 / 游戏厅全屏消息
window.addEventListener('resize', queueStageRectRefresh);
document.addEventListener('fullscreenchange', queueStageRectRefresh);
document.addEventListener('webkitfullscreenchange', queueStageRectRefresh);
window.addEventListener('load', queueStageRectRefresh);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueStageRectRefresh);
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'arcade:fs') queueStageRectRefresh();
});

/* ---------- 画布光标：值变化才写 DOM，避免 pointermove 每次移动都赋值 ---------- */

/** 上一次写入画布的光标样式字符串：与目标值相同则跳过赋值 */
let lastCursor = '';

/**
 * 设置画布光标：与上次值相同则不写 DOM，消除悬停跟踪期的高频样式赋值开销
 * @param {string} value 目标光标样式（default / grab / grabbing）
 */
function setCursor(value) {
    if (value === lastCursor) return;
    lastCursor = value;
    canvas.style.cursor = value;
}

/**
 * 将指针事件坐标换算为画布内逻辑坐标
 * （DPR 适配/全屏缩放时 CSS 显示尺寸 ≠ 画布分辨率，
 * 分子用逻辑宽高而非像素属性，保证换算结果落在逻辑坐标系内；
 * 矩形尺寸读取自缓存 stageRect，pointerdown 与几何变化事件负责刷新）
 * @param {PointerEvent} e 指针事件
 * @returns {{x: number, y: number}} 画布内逻辑坐标
 */
function toCanvasPos(e) {
    if (!stageRect) refreshStageRect(); // 首个指针事件（如悬停先于任何按下/加载回调）时惰性读取
    return {
        x: (e.clientX - stageRect.left) * viewW / stageRect.width,
        y: (e.clientY - stageRect.top) * viewH / stageRect.height
    };
}

/**
 * 指针按下：选中命中的棋子并准备拖拽（未超过阈值前不产生位移）
 * @param {PointerEvent} e 指针按下事件
 */
canvas.addEventListener('pointerdown', e => {
    refreshStageRect(); // 手势起点以最新舞台几何换算，兜底各类几何变化事件未覆盖的时机
    if (state !== 'playing') return;
    // 暂停中：任意点击画布恢复（计时随之解冻），本次点击不作为选子/拖拽输入
    if (isPaused) { togglePause(); return; }
    if (demoActive) return; // 演示进行中：忽略指针操作，防止拖拽打断自动走子
    e.preventDefault();
    const pos = toCanvasPos(e);
    const p = pieceAt(pos.x, pos.y);
    if (!p) return;
    selected = p;
    if (p.t === 'cao') SFX.klSelectCao(); // 曹操专属：庄重低音双响
    else SFX.klSelect();
    setCursor('grabbing'); // 拖拽中切换抓取手型
    p.anim = null; // 打断进行中的补间，避免拖拽起点错位
    p.bounce = null; // 打断回弹补间，避免覆盖跟手位移
    drag = { p, sx: pos.x, sy: pos.y, dir: null, k: 0, off: 0, locked: false };
    canvas.setPointerCapture(e.pointerId);
});

// 暂停面板本体点击恢复：面板悬浮于画布之上会拦截 pointerdown（不再落到上方 canvas 监听），
// 单独转发 togglePause，保持「画布点击即恢复」体验与 DOM 化之前一致
pauseScreen.addEventListener('pointerdown', () => togglePause());

/**
 * 指针移动：首次超过阈值时确定主滑动方向并探测可滑格数；
 * 此后将指针沿滑动轴的正向投影（0~k 格）实时映射为跟手位移
 * @param {PointerEvent} e 指针移动事件
 */
canvas.addEventListener('pointermove', e => {
    const pos = toCanvasPos(e);
    // 悬停追踪：未拖拽时记录指针所指棋子，驱动微光描边与手型光标切换；
    // 演示进行中指针输入被整体屏蔽，跳过 hover 设置（并清空所指），
    // 避免演示棋子集上出现误导性的白色微光与手型光标
    if (!drag) {
        hoverPiece = state === 'playing' && !isPaused && !demoActive ? pieceAt(pos.x, pos.y) : null;
        setCursor(hoverPiece ? 'grab' : 'default');
    }
    if (!drag || drag.locked) return;
    const dxp = pos.x - drag.sx;
    const dyp = pos.y - drag.sy;
    // 方向未定：超过判定阈值后按位移更大的轴确定主方向
    if (!drag.dir) {
        if (Math.hypot(dxp, dyp) < DRAG_THRESHOLD) return;
        drag.dir = Math.abs(dxp) >= Math.abs(dyp)
            ? [Math.sign(dxp) || 1, 0]
            : [0, Math.sign(dyp) || 1];
        drag.k = slideRange(drag.p, drag.dir[0], drag.dir[1]);
        if (drag.k <= 0) {
            // 该方向被锁死：播钝响并结束手势（保持锁定防止反复触发）
            drag.locked = true;
            SFX.klBlock();
            shake = SHAKE_TIME;
            endDrag();
            return;
        }
    }
    // 正向投影格数：反向拖动时投影为负，clamp 到 0（块原地不动）
    const along = drag.dir[0] !== 0 ? dxp * drag.dir[0] : dyp * drag.dir[1];
    drag.off = Math.max(0, Math.min(along / CELL, drag.k));
    drag.p.dragOffX = drag.dir[0] * drag.off;
    drag.p.dragOffY = drag.dir[1] * drag.off;
});

/**
 * 指针抬起：位移吸附到最近整数格——滑过至少半格才算有效滑动
 * （结算步数 / 撤销栈 / 音效 / 通关检查），否则回弹原地
 */
canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const p = d.p;
    const n = Math.round(d.off);
    p.dragOffX = 0;
    p.dragOffY = 0;
    setCursor('grab'); // 松手恢复悬停手型（随后 pointermove 会按所指刷新）
    if (n >= 1) {
        // 有效滑动：直接结算（跳过 trySlide 的可滑复查——off 已被 k 限制）；
        // 补间起点取松手时的视觉偏移位置，避免先弹回原格的视觉跳变
        startSlideAnim(p, p.x + d.off * d.dir[0], p.y + d.off * d.dir[1]);
        p.x += d.dir[0] * n;
        p.y += d.dir[1] * n;
        moves += n;
        undoStack.push({ piece: p, dx: d.dir[0], dy: d.dir[1], steps: n });
        invalidateHint(); // 棋面已变：提示展示与解路径缓存作废
        if (p.t === 'cao') SFX.klMoveCao(n); // 曹操专属：低音区厚重滑音
        else SFX.klMove(n); // 音高随滑动格数递增，连滑越远越高昂
        registerCombo(); // 连击推进：窗口内连续滑动，命中里程碑触发飘字音效
        checkTense(); // 逼近纪录检查：临门两步内的心跳提示
        updateHud();
        checkWin();
    } else if (d.off > 0.12) {
        // 拖了但未过半格：转入回弹补间平滑归位 + 弹性回弹音
        p.bounce = { t: 0, bx: d.off * d.dir[0], by: d.off * d.dir[1] };
        SFX.klBounce();
    }
});

/**
 * 指针离开画布（捕获中触发取消）：按抬起逻辑结算，防止手势悬挂
 */
canvas.addEventListener('pointercancel', () => { if (drag) endDrag(); });

/**
 * 指针离开画布：清空悬停所指并复位光标（拖拽捕获中不会触发，无需顾虑手势）
 */
canvas.addEventListener('pointerleave', () => {
    hoverPiece = null;
    if (!drag) setCursor('default');
});

/**
 * 结束当前拖拽手势：已有可见偏移时转入回弹补间平滑归位，否则直接清空
 */
function endDrag() {
    if (!drag) return;
    const p = drag.p;
    if (drag.off > 0.12) {
        // 已拖出可见距离：按当前方向转入回弹补间 + 弹性回弹音
        const dir = drag.dir || [0, 0];
        p.bounce = { t: 0, bx: drag.off * dir[0], by: drag.off * dir[1] };
        SFX.klBounce();
    }
    p.dragOffX = 0;
    p.dragOffY = 0;
    drag = null;
}

/* ===================== 键盘输入 ===================== */

/**
 * 全局键盘控制：空格暂停/继续 / 方向键 / WASD 推动选中棋子（默认曹操）/ U 撤销 /
 * R 重开 / H 提示 / P 演示最佳解 / 数字键 1~6 切换布局，并阻止方向键滚动页面；
 * 暂停中仅空格（恢复）与 R（重开）可用；演示进行中屏蔽其余全部输入（P 中断 / R 重开仍可用）
 * @param {KeyboardEvent} e 键盘事件
 */
document.addEventListener('keydown', e => {
    // 成就墙快捷键：V 键任意状态开合 / Esc 仅在开着时关闭；墙打开期间吞掉其余全部按键，
    // 防止墙后误走子/撤销/暂停/切布局（指针事件已由全屏遮罩拦截，键盘由此守卫兜底）
    if ((e.key === 'v' || e.key === 'V') && !e.repeat) {
        e.preventDefault();
        toggleAchPanel();
        return;
    }
    if (e.key === 'Escape' && achPanelOpen) {
        e.preventDefault();
        toggleAchPanel();
        return;
    }
    if (achPanelOpen) return; // 成就墙打开期间：除 V/Esc 外一律忽略
    // 空格手动暂停/继续：P 键已被演示系统占用，故空格承担暂停（开始/重开/演示按钮
    // 点击后均已 blur 焦点，空格不会误触发按钮）；回合制也需要暂停——用时统计
    // 参与评级与纪录，暂停期间冻结计时保证纪录公平
    if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) togglePause(); // 防长按连发：系统按键重复率下反复切换暂停
        return;
    }
    // 暂停中：除 R 重开（装载新局并复位暂停标记）外一律忽略，
    // 防止暂停期间误走子/撤销/提示/演示/切布局
    if (isPaused) {
        if (!e.repeat && (e.key === 'r' || e.key === 'R')) restartLayout(); // 防长按反复重开
        return;
    }
    // P 键开关演示：未演示时启动，演示中再按即中断（startDemo 内部处理开关语义）；
    // 原 D 键职责让位于 WASD 右移，保持左手操作完整
    if ((e.key === 'p' || e.key === 'P') && !e.repeat) { // !e.repeat 防长按连发反复开关演示
        e.preventDefault();
        startDemo();
        return;
    }
    if (demoActive) return; // 演示进行中：方向键/WASD/U/H/数字键一律忽略，防误触干扰自动走子
    const dirMap = {
        // 方向键与 WASD 双通道支持（左手操作），大小写均匹配以兼容大写锁定
        ArrowUp: [0, -1], ArrowDown: [0, 1],
        ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], W: [0, -1], s: [0, 1], S: [0, 1],
        a: [-1, 0], A: [-1, 0], d: [1, 0], D: [1, 0]
    };
    if (dirMap[e.key]) {
        e.preventDefault();
        if (state !== 'playing') return;
        const [dx, dy] = dirMap[e.key];
        trySlide(selected, dx, dy, 1);
        return;
    }
    if (e.repeat) return; // 撤销/重开/提示/切布局屏蔽长按连发（方向键按住连滑保留系统重复节奏）
    if (e.key === 'u' || e.key === 'U') {
        undoMove();
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        restartLayout();
        return;
    }
    if (e.key === 'h' || e.key === 'H') {
        requestHint();
        return;
    }
    // 数字键 1~6 切换布局（实际可按 LAYOUTS.length 上限，ready 状态下同样允许，切换后保持遮罩）
    if (e.key >= '1' && e.key <= String(LAYOUTS.length)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx !== layoutIndex) {
            selectLayout(document.querySelectorAll('.layout-btn')[idx]);
        }
    }
});

// 窗口失焦自动暂停：华容道虽为回合制，但用时统计（elapsed）参与评级与纪录，
// 离开窗口期间必须冻结计时，防止切窗挂机虚增用时（rAF 后台标签页暂停 + dt 封顶
// 已覆盖切标签场景，此处显式暂停额外覆盖"切换应用窗口但页面仍在前台"的情况）
window.addEventListener('blur', () => {
    endDrag(); // 清理进行中的拖拽手势：切窗后指针按住态丢失（浏览器不会补发 pointerup），
               // 残留的 drag 会在返回后随指针移动继续更新位移，恢复点击时被误结算为走子
    if (state === 'playing' && !isPaused) {
        isPaused = true;
        pauseScreen.style.display = 'block'; // 失焦自动暂停同步显示暂停面板
        SFX.bgm.pause(); // 失焦自动暂停同步挂起 BGM（恢复走 togglePause 的 resume 分支）
    }
});

/* ===================== CRT 全屏开关音效 ===================== */

// 独立打开：监听全屏切换，进入全屏响 CRT 开机音、退出响关机音（模拟机台通电质感）
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});

// iframe 嵌入（?embed=1）：fullscreenchange 不穿越文档边界，全屏态由父页大厅持有
// 并广播 arcade:fs 消息，此处同样接入 CRT 开关机音，保证两种打开方式行为一致
// 触发点 a：父页游戏厅关闭 iframe 覆盖层前下发 arcade:save 消息 → 立即镜像当前局进度
// （saveSnapshot 内部自行区分：进行中保存，未开始 / 已通关则清除快照）
window.addEventListener('message', e => {
    const d = e.data;
    if (d && d.type === 'arcade:fs') {
        if (d.fs) SFX.crtOn();
        else SFX.crtOff();
    }
    if (d && d.type === 'arcade:save') saveSnapshot(); // 返回大厅前的进度镜像
});

// 触发点 b：左上角「← 游戏厅」返回链接 —— 跳转前先保存快照，再放行默认导航
// （绝不 preventDefault，不阻断返回大厅的原生跳转行为）
document.querySelector('.back-link').addEventListener('click', () => {
    saveSnapshot();
});

// 触发点 c：页面卸载兜底（关闭标签页 / 刷新 / 链接跳转 / iframe 被移除均触发）
// —— 进行中保存快照；未开始 / 已通关则由 saveSnapshot 清除
window.addEventListener('pagehide', () => {
    saveSnapshot();
});

/* ===================== 主循环与初始化 ===================== */

/** 上一渲染帧时间戳，用于计算 delta */
let lastRender = performance.now();

/**
 * 渲染主循环（rAF 驱动）：推进计时/动画/纸屑/震动等全部计时器后重绘画面
 * @param {number} now 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
 */
function renderLoop(now) {
    const dt = Math.min((now - lastRender) / 1000, 0.05);
    lastRender = now;
    updateEffects(dt);
    stepDemo(dt); // 演示模式推进：按固定节奏执行最佳解的下一步
    draw(now);
    requestAnimationFrame(renderLoop);
}

// 步数跳动反馈依赖 transform，而 span 默认 inline 不受 transform 影响，转为行内块
moveElement.style.display = 'inline-block';

// 布局恢复：按上次持久化的选择装载棋盘（默认横刀立马，序号 0；
// ready 状态下仅作遮罩背后的静态展示，不计时不受输入）
const savedLayoutIndex = parseInt(safeGet(LAYOUT_KEY), 10); // 隐私模式读失败得 NaN，走默认布局
if (!Number.isNaN(savedLayoutIndex) && savedLayoutIndex >= 0 && savedLayoutIndex < LAYOUTS.length) {
    layoutIndex = savedLayoutIndex;
}
// 每日一题：今日尚未完成时进页自动选中今日布局（已完成则尊重上次选择）
if (readDailyDone() === 0) {
    layoutIndex = dailyIndex();
}
// 今日布局按钮打上「今」角标（日期→布局映射会话内恒定，标记一次即可）
document.querySelectorAll('.layout-btn')[dailyIndex()].classList.add('daily');
// 先清空 HTML 默认高亮再点亮恢复项，避免上次选择非首个时出现双高亮
document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
document.querySelectorAll('.layout-btn')[layoutIndex].classList.add('active');
updateDailyLine(); // 开始遮罩每日一题信息行：今日题目名 + 完成状态
// 难度恢复：按上次持久化的选择点亮按钮（默认进阶，序号 1）并应用辅助开关
const savedDiffIndex = parseInt(safeGet(DIFF_KEY), 10); // 隐私模式读失败得 NaN，走默认难度
if (!Number.isNaN(savedDiffIndex) && savedDiffIndex >= 0 && savedDiffIndex < DIFF_IDS.length) {
    diffIndex = savedDiffIndex;
}
document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
document.querySelectorAll('.diff-btn')[diffIndex].classList.add('active');
applyDifficultyUi();
loadLayout(layoutIndex);
// 进度镜像快照恢复：核心状态创建后、默认开新局之前执行。
// 旧版内部进度键（klotskiProgress）已被统一契约键取代，顺手清除避免残留；
// 恢复成功 → 已切到快照布局并摆好棋面 / 步数，直接调 startGame 进入可玩状态
// （回合制无需暂停遮罩），并在棋盘上飘字提示"已恢复上次进度"；
// 恢复失败（无快照 / 快照非法已清除）→ 保持原有默认新开局流程（开始遮罩等待玩家）
try { localStorage.removeItem('klotskiProgress'); } catch (e) { /* 存储不可用时静默跳过 */ }
if (restoreSnapshot()) {
    startGame(); // 复用开局入口：隐藏开始遮罩 + 进入 playing + 起 BGM + 开演字幕
    floaters.push({ // 棋盘中央飘字：告知玩家当前局面为上次进度续玩
        text: '已恢复上次进度',
        x: PAD + BOARD_W / 2,
        y: PAD + BOARD_H * 0.32,
        t: 0,
        dur: 1.6,
        color: '#ffd23e'
    });
}

// 启动渲染循环
requestAnimationFrame(renderLoop);

// 游玩时长统计上报（返回大厅/关页时结算）+ 键帽实时高亮（按住时点亮说明面板键帽）
FX.playtime.init('klotski');
FX.KeyLight.init();
