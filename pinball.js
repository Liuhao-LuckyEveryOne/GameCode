'use strict';
/* ======================================================================
 * 3D弹球 (PINBALL) —— 像素街机厅游戏逻辑
 * 500×660 画布 · 伪 3D 透视投影台面（远小近大）· 四档难度（重力+挡板长度+倍率，含无敌档）
 * 核心机制：世界坐标 2D 物理（重力 / 线段墙反弹 / 弹柱加速 / 弹射器击飞 /
 *          挡板拍击带角速度传递），渲染时经透视投影产生纵深感；
 *          1/120 秒固定步长物理累加器（单帧最多 5 步，防追帧螺旋），缓解高速穿透与手感漂移；
 *          三颗球，同场最多 3 球（多球奖励），全部落底才失球（画面震动 + 红色警报失球演出）；
 *          无敌档球离出台面（落底或异常逃逸）时新球从初始位置以随机斜向角度自动落下继续；
 *          目标灯：击中点亮得分，全部点亮触发清板奖励（加分 + 重置灯 + 武装 Jackpot + 掉落多球）；
 *          Jackpot：清板后下一次击中中央弹柱触发大奖（5000×倍率 + JACKPOT 金色大字演出）；
 *          最高分 localStorage 持久化（破纪录瞬间专属音效 + 全屏庆祝特效）；
 *          成就系统三条（localStorage：arcade_ach_pinball），V 键切换成就面板；
 *          空格按住蓄力、松开发射（力度决定初速，蓄力期间播放充电音）/暂停；P 暂停；切出窗口自动暂停
 * 视听特效：球速拖尾残影（渐隐蓝光）· 弹球台面投影阴影 · 弹射器/弹柱/目标灯命中火花粒子（跟随台面震动）·
 *          挡板大力击球火花 + 白色发光描边渐隐 + 短促震颤 · 蓄力发射充能环（青色充能 → 满力金色）·
 *          失球深渊坠落演出（深渊口火花喷发 + 双环冲击波 + 坠落烧红球体 +
 *          随机抖动警告大字 + 红色警报）+ 得分飘字 · JACKPOT 金色大字演出
 * 依赖：audio.js 全局音效库 SFX（通用开始/结束/点击音 + PINBALL 专属音效）
 * ==================================================================== */

/* ===================== 常量与世界参数 ===================== */

/** 台面世界宽度（世界坐标单位） */
const WORLD_W = 400;
/** 台面世界高度（世界坐标单位，球心越过 WORLD_H + DRAIN_DEPTH 判定落底失球） */
const WORLD_H = 560;
/** 落底判定深度：球心低于台底该距离即失球 */
const DRAIN_DEPTH = 40;
/** 弹球半径（世界坐标单位） */
const BALL_R = 9;
/** 球速上限（世界坐标单位/秒），防止高速穿透墙体 */
const MAX_SPEED = 980;
/** 物理子步单步最大位移（世界坐标单位），高速时拆分步进防穿透 */
const SUBSTEP_LEN = 6;
/** 单帧物理子步数上限 */
const MAX_SUBSTEPS = 12;
/** 墙体反弹恢复系数（0~1，越小越"吃"能量） */
const WALL_RESTITUTION = 0.5;
/** 挡板反弹恢复系数 */
const FLIP_RESTITUTION = 0.4;
/** 挡板摆动角速度（弧度/秒），决定拍击力度 */
const FLIP_SPEED = 18;
/** 挡板收拢角度（弧度，屏幕坐标 y 向下，正值 = 尖端朝下） */
const FLIP_REST = 0.52;
/** 挡板拍起角度（弧度，负值 = 尖端翘起） */
const FLIP_ACTIVE = -0.5;
/** 挡板半厚度（世界坐标单位，碰撞按胶囊体处理） */
const FLIP_HALF = 5;
/** 墙体半厚度（世界坐标单位） */
const WALL_HALF = 4;
/** 弹柱撞击后球的法向击出速度（世界坐标单位/秒） */
const BUMPER_KICK = 470;
/** 弹射器击球最低反弹速度（世界坐标单位/秒） */
const SLING_KICK = 560;
/** 弹柱基础得分（×难度倍率） */
const BUMPER_SCORE = 60;
/** 弹射器基础得分（×难度倍率） */
const SLING_SCORE = 25;
/** 单局总球数（含首发） */
const TOTAL_BALLS = 3;
/** 失球演出总时长（秒）：坠落 + 震动 + 红色警报 + 提示文字 */
const LOST_FX_TIME = 1.1;
/** 蓄力发射从 0 充满到 1 所需时长（秒） */
const CHARGE_TIME = 0.9;
/** 蓄力充电音播放间隔（毫秒）：蓄力期间按此节奏循环播放音调随进度爬升的充电音 */
const CHARGE_SFX_INTERVAL = 80;

/* 固定步长物理参数 */

/** 物理固定步长（秒）：主循环按此粒度推进物理，保证不同刷新率下手感一致 */
const FIXED_DT = 1 / 120;
/** 单帧最多推进的物理步数上限：卡顿时丢弃多余时间，防止"追帧螺旋"越跑越慢 */
const MAX_STEPS_PER_FRAME = 5;

/* 目标灯 / 清板 / Jackpot / 多球 / 挡板发光参数 */

/** 目标灯基础得分（×难度倍率） */
const TARGET_SCORE = 150;
/** 目标灯击中后球的法向击出速度（世界坐标单位/秒） */
const TARGET_KICK = 320;
/** 目标灯碰撞冷却（秒），防同一目标被连续触发刷分 */
const TARGET_COOL = 0.1;
/** 目标灯命中闪光时长（秒） */
const TARGET_FLASH = 0.25;
/** 清板奖励得分（×难度倍率） */
const CLEAR_SCORE = 2000;
/** JACKPOT 基础得分（×难度倍率） */
const JACKPOT_SCORE = 5000;
/** JACKPOT 大字演出总时长（秒）：放大 + 淡出 */
const JACKPOT_FX_TIME = 1.4;
/** 同场弹球数量上限：多球奖励掉球数受此约束 */
const MAX_BALLS = 3;
/** 挡板击球白色发光描边总时长（秒），发光随剩余时长线性渐隐 */
const FLIP_GLOW_TIME = 0.2;

/* 球-球碰撞 / 连击倍率参数 */

/** 球-球碰撞恢复系数（0~1）：法向相对速度按此比例反弹交换，1 为完全弹性碰撞 */
const BALL_RESTITUTION = 0.92;
/** 球-球碰撞触发反馈（火花+音效+计分）的法向接近速度下限（世界坐标单位/秒），慢速搭接仅静默分离不刷分 */
const BALL_HIT_MIN_VN = 60;
/** 球-球碰撞基础得分（×难度倍率×连击倍率） */
const BALL_HIT_SCORE = 30;
/** 连击窗口时长（秒）：窗口内任意一次得分都会刷新计时，超时连击静默归零 */
const COMBO_WINDOW = 2;
/** 每累计几次得分提升一级连击倍率 */
const COMBO_STEP = 3;
/** 连击倍率封顶（×1 起步，每级 +1，最高 ×COMBO_MAX_MULT） */
const COMBO_MAX_MULT = 5;

/* 视图（透视投影）参数 */

/** 画布宽度（像素） */
const VIEW_W = 500;
/** 画布高度（像素） */
const VIEW_H = 660;
/** 台面水平中心线在画布上的 x（像素） */
const VIEW_CX = 250;
/** 透视水平放大系数（台面底边宽 = WORLD_W × XS） */
const XS = 1.15;
/** 台面最远端（世界 y=0）在画布上的 y（像素） */
const VIEW_TOP = 36;
/** 台面最近端（世界 y=WORLD_H）在画布上的 y（像素） */
const VIEW_BOTTOM = 640;
/** 最远端透视缩放比例（远小近大的"小"） */
const PERSP_MIN = 0.5;

/* ===================== 游戏状态 ===================== */

/** 游戏状态机：start 开始画面 / ready 待发射 / play 进行中 / lost 失球演出 / over 结束 */
let state = 'start';
/** 当前分数 */
let score = 0;
/** 历史最高分（localStorage 持久化，键 pinballHighScore；存储不可用时兜底为 0） */
let highScore = 0; // 存储不可用（隐私模式/禁用站点数据）时的兜底默认值
try {
    highScore = parseInt(localStorage.getItem('pinballHighScore') || '0', 10);
} catch (e) { /* 存储不可用：静默保持兜底 0，不中断初始化 */ }
/** 最高分脏标记：破纪录时置位，由结算/既有存档钩子统一落盘（避免物理碰撞热路径每次得分同步写 localStorage） */
let highScoreDirty = false;
/** 剩余球数（含当前在场） */
let lives = TOTAL_BALLS;
/** 计分倍率，由难度选择决定：无敌 1 / 简单 1 / 中等 2 / 困难 3 */
let mult = 2;
/** 重力加速度（世界坐标单位/秒²），由难度选择决定 */
let gravity = 780;
/** 挡板长度（世界坐标单位），由难度选择决定 */
let flipperLen = 74;
/** 是否无敌模式（仅无敌档为 true）：球离出台面不丢球、不减球数，新球回到初始位置以随机斜向角度自动落下继续 */
let invincibleMode = false;
/** 难度选择存档键（localStorage），页面加载时恢复上一次选择 */
const DIFFICULTY_KEY = 'pinballDifficulty';
/** 进度快照存档键（localStorage）：返回游戏厅 / 收到 arcade:save 消息 / 关页时保存当前局进度，游戏结束即清除 */
const SAVE_KEY = 'arcade_save_pinball';
/** 本局是否刷新了历史最高分（结算面板据此显示"新纪录"提示） */
let isNewRecord = false;
/** 是否处于暂停状态 */
let isPaused = false;
/**
 * 创建一颗弹球对象
 * @param {number} x 初始世界坐标 x
 * @param {number} y 初始世界坐标 y
 * @param {number} [vx=0] 初始水平速度（世界坐标单位/秒）
 * @param {number} [vy=0] 初始垂直速度（世界坐标单位/秒）
 * @returns {{x:number,y:number,vx:number,vy:number,trail:Array<{x:number,y:number}>}} 弹球对象（含每球独立拖尾采样数组）
 */
function makeBall(x, y, vx = 0, vy = 0) {
    return { x, y, vx, vy, trail: [] };
}

/** 场上弹球列表（世界坐标与速度 + 每球独立拖尾），多球奖励时最多 MAX_BALLS 颗 */
const balls = [makeBall(WORLD_W / 2, 26)];
/** 失球演出中的坠落球引用：balls 已清空后用于继续坠落渲染，其余状态下为 null */
let lostBall = null;
/** 固定步长物理累加器（秒）：rAF 帧时长被拆解为整数个 FIXED_DT 物理步推进 */
let accumulator = 0;
/** 上次蓄力充电音播放时间戳（毫秒），用于 80ms 节流 */
let lastChargeSfx = 0;
/** 得分飘字数组 { x, y, txt, t }（世界坐标 + 生命周期进度 0~1） */
const floatTexts = [];

/** 命中火花粒子池 { x, y, vx, vy, life, maxLife, color, size }（世界坐标）：预分配零分配复用，满员自动征用最旧粒子 */
const sparkPool = new FX.Pool(160, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2 }));
/** 火花粒子重力（世界坐标单位/秒²，约台面重力 0.6 倍手感） */
const SPARK_GRAVITY = 470;
/** 球拖尾最大采样点数 */
const TRAIL_MAX = 7;

/**
 * 在指定位置喷出一组命中火花粒子
 * @param {number} px 粒子出生点世界坐标 x
 * @param {number} py 粒子出生点世界坐标 y
 * @param {string} color 粒子颜色
 * @param {number} count 粒子数量
 * @param {number} [speed=190] 散射初速（世界坐标单位/秒）
 */
function spawnSparks(px, py, color, count, speed = 190) {
    if (FX.prefersReduced) return; // 减少动态偏好：跳过粒子生成（球阴影/灯状态等静态视觉不受影响）
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2; // 均匀环向散射
        const spd = speed * (0.4 + Math.random() * 0.8);
        const p = sparkPool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = px;
        p.y = py;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 50; // 轻微上抛
        p.life = 0.25 + Math.random() * 0.25; // 0.25 ~ 0.5 秒寿命
        p.maxLife = p.life;
        p.color = color;
        p.size = 2 + Math.random() * 2;
    }
}

/**
 * 推进火花粒子物理：重力 + 位移 + 寿命（池活跃区正向遍历，sweep 回收死粒零分配）
 * @param {number} dt 帧时间步长（秒）
 */
function updateSparks(dt) {
    for (let i = 0; i < sparkPool.n; i++) {
        const p = sparkPool.items[i];
        p.life -= dt;
        p.vy += SPARK_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    sparkPool.sweep();
}
/** 上一帧时间戳（毫秒，rAF 传入） */
let lastTime = 0;
/** 上次墙壁碰撞音时间戳（毫秒），用于节流防止连续碰撞爆音 */
let lastWallSfx = 0;
/** 失球演出计时（秒），state === 'lost' 时推进 */
let loseTimer = 0;
/** 挡板大力击球震颤剩余时长（秒），> 0 时画面轻微抖动 */
let hitShake = 0;
/** 蓄力发射进度 0~1（ready 状态按住空格时推进，1 为满力） */
let charge = 0;
/** 是否正在蓄力（按下空格起，松开或切窗取消） */
let charging = false;
/** 清板奖励武装标记：true 时击中中央弹柱触发 Jackpot 大奖（clearBoard 置位、triggerJackpot 复位） */
let jackpotArmed = false;
/** JACKPOT 大字演出剩余时长（秒），> 0 时在画布中央绘制放大渐隐的金色 JACKPOT 字样 */
let jackpotFxTimer = 0;
/** 连击累计次数：连击窗口内每次得分 +1，窗口超时或末球落底时清零 */
let comboHits = 0;
/** 连击窗口剩余时长（秒），> 0 表示连击仍在有效期内 */
let comboTimer = 0;
/** 当前连击倍率（×1~×COMBO_MAX_MULT），在 addScore 内与原始分乘算 */
let comboMult = 1;

/* ===================== 成就系统（v2：对齐 snake 机台的 DOM 成就墙） ===================== */
// 结构说明：ACHIEVEMENTS 为 8 条成就定义（普通/稀有/史诗/传说四档稀有度）；
// achStore.best 按维度（score/combo/mult/balls）记录历史最佳并持久化，游玩峰值实时上报；
// 达到 target 即解锁 → 右上角 toast 堆叠提示 + 音效，史诗/传说追加金色烟花庆典；
// 成就墙（#achWall）打开期间局面冻结：主循环与失球演出均以 achPanelOpen 为闸门短路
//（与手动暂停 isPaused 相互独立——墙面关闭不改动暂停态，二者可叠加且互不干扰）。
/** localStorage 存档键：v2 结构 { unlocked: {id:时间戳}, best: {维度:最佳值} }（沿用旧键名，旧档自动迁移） */
const ACH_KEY = 'arcade_ach_pinball';
/** 稀有度 → 中文标签映射：卡片右上角徽章与 toast 副标题共用 */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
/** 历史最佳默认值：mult/balls 从 1 起步（连击倍率与同场球数基数），其余维度从 0 累计 */
const BEST_DEFAULTS = { score: 0, combo: 0, mult: 1, balls: 1 };
/**
 * 成就定义清单（8 条）：id 为存档标识——旧三条（jackpot/multiball3/score20k）id 原样保留，
 * 老玩家存档迁移后成就不丢失；stat/target 用于卡片历史最佳进度条（事件型成就不设维度）
 * @type {Array<{id:string,name:string,icon:string,rarity:string,cat:string,desc:string,stat?:string,target?:number}>}
 */
const ACHIEVEMENTS = [
    { id: 'score20k',   name: '两万分俱乐部', icon: '🎯', rarity: 'common',    cat: '得分', desc: '单局得分达到 20,000',   stat: 'score', target: 20000 },
    { id: 'score100k',  name: '十万俱乐部',   icon: '💠', rarity: 'epic',      cat: '得分', desc: '单局得分达到 100,000', stat: 'score', target: 100000 },
    { id: 'score500k',  name: '五十万传奇',   icon: '👑', rarity: 'legendary', cat: '得分', desc: '单局得分达到 500,000', stat: 'score', target: 500000 },
    { id: 'combo30',    name: '连击三十',     icon: '🔥', rarity: 'common',    cat: '技巧', desc: '连击计数达到 30 次',    stat: 'combo', target: 30 },
    { id: 'combo100',   name: '连击破百',     icon: '⚡', rarity: 'epic',      cat: '技巧', desc: '连击计数达到 100 次',   stat: 'combo', target: 100 },
    { id: 'mult5',      name: '倍率全开',     icon: '✖️', rarity: 'common',    cat: '技巧', desc: '连击倍率提升至 ×5',     stat: 'mult',  target: 5 },
    { id: 'jackpot',    name: '头奖时刻',     icon: '🎰', rarity: 'rare',      cat: '收集', desc: '触发一次 JACKPOT 大奖' },
    { id: 'multiball3', name: '三球齐飞',     icon: '🎱', rarity: 'rare',      cat: '收集', desc: '同场保持 3 颗弹球',     stat: 'balls', target: 3 }
];
/** 本局实时峰值收集器：开局清零，随游玩经 trackRunStat 持续刷新 */
const runStats = { score: 0, combo: 0, mult: 1, balls: 1 };
/**
 * 成就存档 v2：unlocked 值为解锁时间戳（0 = 旧档迁移，仅存「已达成」语义），best 为历史最佳；
 * 启动时从 localStorage 读取（存档损坏时按全新档案处理）
 * @type {{unlocked: Object<string, number>, best: Object<string, number>}}
 */
const achStore = loadAchStore();
/** 成就墙是否打开：true 时主循环与失球演出短路冻结（见 loop / toggleAchPanel） */
let achPanelOpen = false;

/* ===================== 台面元素 ===================== */

/**
 * 墙体线段集合（世界坐标），sling 为 true 的线段是弹射器：
 * 球撞击时以固定强力击出并得分
 * @type {Array<{x1:number,y1:number,x2:number,y2:number,sling?:boolean,cool:number,flash:number}>}
 */
const walls = [
    { x1: 70, y1: 10, x2: 330, y2: 10, cool: 0, flash: 0 },            // 顶部横墙
    { x1: 0, y1: 90, x2: 70, y2: 10, cool: 0, flash: 0 },              // 左上斜角（导流球入台面）
    { x1: 400, y1: 90, x2: 330, y2: 10, cool: 0, flash: 0 },           // 右上斜角
    { x1: 0, y1: 90, x2: 0, y2: 360, cool: 0, flash: 0 },              // 左墙
    { x1: 400, y1: 90, x2: 400, y2: 360, cool: 0, flash: 0 },          // 右墙
    { x1: 0, y1: 360, x2: 88, y2: 452, sling: true, cool: 0, flash: 0 },    // 左弹射器斜边
    { x1: 400, y1: 360, x2: 312, y2: 452, sling: true, cool: 0, flash: 0 }  // 右弹射器斜边
];

/**
 * 弹柱集合（世界坐标圆），球撞击时加速反弹并得分
 * @type {Array<{x:number,y:number,r:number,flash:number,cool:number}>}
 */
const bumpers = [
    { x: 120, y: 150, r: 26, flash: 0, cool: 0 },
    { x: 280, y: 150, r: 26, flash: 0, cool: 0 },
    { x: 200, y: 240, r: 26, flash: 0, cool: 0 }
];

/**
 * 挡板集合：side=1 左挡板（指向台面中心为 +x），side=-1 右挡板（镜像）；
 * angle 为相对水平基线的摆角，prev 为上一帧角度（用于求角速度传递给球）；
 * glow 为击球白色发光描边剩余时长（秒），> 0 时渲染发光并在 updateTimers 中衰减
 * @type {Array<{side:number,ax:number,ay:number,len:number,angle:number,prev:number,pressed:boolean,glow:number}>}
 */
const flippers = [
    { side: 1, ax: 96, ay: 460, len: 74, angle: FLIP_REST, prev: FLIP_REST, pressed: false, glow: 0 },
    { side: -1, ax: 304, ay: 460, len: 74, angle: FLIP_REST, prev: FLIP_REST, pressed: false, glow: 0 }
];

/**
 * 目标灯集合（世界坐标圆）：未点亮时被球击中即点亮并得分，
 * 全部点亮触发清板奖励（clearBoard：加分 + 武装 Jackpot + 掉落多球）后重置为未点亮
 * @type {Array<{x:number,y:number,r:number,lit:boolean,cool:number,flash:number}>}
 */
const targets = [
    { x: 200, y: 95, r: 12, lit: false, cool: 0, flash: 0 },   // 顶部中央目标（顶墙下方）
    { x: 60, y: 210, r: 12, lit: false, cool: 0, flash: 0 },   // 左侧目标
    { x: 340, y: 210, r: 12, lit: false, cool: 0, flash: 0 },  // 右侧目标
    { x: 200, y: 320, r: 12, lit: false, cool: 0, flash: 0 }   // 中央目标（中央弹柱下方）
];

/** 顶部 marquee 装饰灯珠（世界坐标，渲染时 chase 流水点亮） */
const lampPts = [];
(function buildLamps() {
    // 沿左上斜角 / 顶部横墙 / 右上斜角等分取点（不含端点）
    const spread = (x1, y1, x2, y2, n) => {
        for (let i = 1; i < n; i++) lampPts.push({ x: x1 + (x2 - x1) * i / n, y: y1 + (y2 - y1) * i / n });
    };
    spread(0, 90, 70, 10, 4);
    spread(70, 10, 330, 10, 6);
    spread(330, 10, 400, 90, 4);
})();

/* ===================== DOM 引用 ===================== */

/** 游戏画布 */
const canvas = document.getElementById('game');
// DPR 高清适配：按 devicePixelRatio 放大物理分辨率并锁定 CSS 逻辑坐标系
//（#game 的 CSS 尺寸固定 500×660；重复调用安全，resize 时重建）
const canvasView = FX.setupCanvas(canvas, 2);
/** 2D 绘图上下文（setupCanvas 内部已 setTransform(dpr, dpr) 预缩放，绘制代码仍用 CSS 像素坐标） */
const ctx = canvasView.ctx;
/** 画布当前设备像素比：draw() 复位震动偏移时按此恢复 DPR 变换（resize 时更新） */
let viewDpr = canvasView.dpr;
/** 剩余球数画布（侧栏 BALLS 面板） */
const ballsCanvas = document.getElementById('ballsCanvas');
/** 剩余球数画布上下文 */
const ballsCtx = ballsCanvas.getContext('2d');
/** 分数显示元素 */
const scoreElement = document.getElementById('scoreVal');
/** 倍率显示元素 */
const multElement = document.getElementById('multVal');
/** 最高分显示元素 */
const highElement = document.getElementById('highVal');
/** 开始遮罩（含难度选择） */
const startScreen = document.getElementById('startScreen');
/** 游戏结束遮罩 */
const gameOverScreen = document.getElementById('gameOverScreen');
/** 暂停遮罩 */
const pauseScreen = document.getElementById('pauseScreen');
/** 暂停遮罩内"已恢复上次进度"提示（仅进度恢复引入的暂停展示，玩家继续后撤下） */
const pauseRestoreTip = document.getElementById('pauseRestoreTip');
/** 结算面板最终分数元素 */
const finalScoreElement = document.getElementById('finalScore');
/** "新纪录"提示元素 */
const newRecordElement = document.getElementById('newRecord');
/** 成就墙全屏遮罩层（DOM 覆盖层，V/Esc 开合，打开期间主循环冻结） */
const achWall = document.getElementById('achWall');
/** 成就卡片网格容器（条目由 renderAchWall 生成） */
const achGrid = document.getElementById('achGrid');
/** 已解锁成就计数元素 */
const achCountEl = document.getElementById('achCount');
/** 成就总数元素 */
const achTotalEl = document.getElementById('achTotal');
/** 成就墙头部完成度进度条填充 */
const achBarFill = document.getElementById('achBarFill');

/* ===================== 透视投影 ===================== */

/**
 * 世界坐标 → 画布坐标透视投影：远端（y 小）缩小、近端放大，产生纵深感
 * @param {number} wx 世界坐标 x
 * @param {number} wy 世界坐标 y
 * @returns {{x:number,y:number,s:number}} 画布坐标 x/y 与缩放系数 s（用于半径、线宽随深度缩放）
 */
function project(wx, wy) {
    const t = wy / WORLD_H;                        // 纵深比例：0 最远（顶）→ 1 最近（底）
    const s = (PERSP_MIN + (1 - PERSP_MIN) * t) * XS;
    return {
        x: VIEW_CX + (wx - WORLD_W / 2) * s,
        y: VIEW_TOP + (VIEW_BOTTOM - VIEW_TOP) * t,
        s: s
    };
}

/* ===================== 核心逻辑：挡板 ===================== */

/**
 * 计算挡板尖端坐标（世界坐标）
 * @param {object} f 挡板对象
 * @returns {{x:number,y:number}} 尖端坐标
 */
function flipperTip(f) {
    return {
        x: f.ax + f.side * Math.cos(f.angle) * f.len,
        y: f.ay + Math.sin(f.angle) * f.len
    };
}

/**
 * 更新挡板角度：按 pressed 状态以固定角速度向目标角逼近（收拢/拍起），
 * 并记录上一帧角度供碰撞时计算表面线速度
 * @param {number} dt 帧时间步长（秒）
 */
function updateFlippers(dt) {
    for (const f of flippers) {
        f.prev = f.angle;
        const target = f.pressed ? FLIP_ACTIVE : FLIP_REST;
        if (f.angle < target) f.angle = Math.min(target, f.angle + FLIP_SPEED * dt);
        else if (f.angle > target) f.angle = Math.max(target, f.angle - FLIP_SPEED * dt);
    }
}

/* ===================== 核心逻辑：碰撞 ===================== */

/**
 * 球与全部墙体线段碰撞：最近点推出 + 法向反弹；
 * 弹射器线段特殊处理——击出速度提升到 SLING_KICK 并得分（带冷却防连触）
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待碰撞检测的弹球对象
 */
function collideWalls(b) {
    for (const w of walls) {
        // 球心到线段最近点（clamp 投影参数到 [0,1]，端点也参与碰撞）
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
        const len2 = dx * dx + dy * dy;
        let t = ((b.x - w.x1) * dx + (b.y - w.y1) * dy) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const cx = w.x1 + dx * t, cy = w.y1 + dy * t;
        let nx = b.x - cx, ny = b.y - cy;
        const dist = Math.hypot(nx, ny);
        const minD = BALL_R + WALL_HALF;
        if (dist >= minD || dist === 0) continue;
        nx /= dist; ny /= dist;
        // 位置修正：把球推出墙体表面
        b.x = cx + nx * minD;
        b.y = cy + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue; // 正在远离，无需反弹
        if (w.sling && w.cool <= 0) {
            // 弹射器：保留切向速度，法向强制提升到击出速度
            const bounce = Math.max(SLING_KICK, -vn * 1.05);
            b.vx += -vn * nx + nx * bounce;
            b.vy += -vn * ny + ny * bounce;
            w.cool = 0.12;
            w.flash = 0.2;
            spawnSparks(cx, cy, '#ffd23e', 8); // 金色火花强化弹射瞬间
            SFX.pinSling();
            addScore(SLING_SCORE * mult, cx, cy);
        } else {
            // 普通墙：法向按恢复系数反弹 + 反弹后全速度轻微阻尼（0.995 作用于法向与切向）
            b.vx -= (1 + WALL_RESTITUTION) * vn * nx;
            b.vy -= (1 + WALL_RESTITUTION) * vn * ny;
            b.vx *= 0.995;
            b.vy *= 0.995;
            // 播放墙壁碰撞音（90ms 节流，避免连撞时爆音）
            const nowMs = performance.now();
            if (nowMs - lastWallSfx > 90) {
                lastWallSfx = nowMs;
                SFX.pinWall();
            }
        }
    }
}

/**
 * 球与弹柱碰撞：推出重叠后以固定强力反弹（切向保留 30%），
 * 触发闪光动画、得分与短暂冷却（防同一弹柱连续刷分）；
 * Jackpot 判定：清板奖励武装后（jackpotArmed）击中中央弹柱即触发大奖
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待碰撞检测的弹球对象
 */
function collideBumpers(b) {
    for (const bp of bumpers) {
        let nx = b.x - bp.x, ny = b.y - bp.y;
        const dist = Math.hypot(nx, ny);
        const minD = BALL_R + bp.r;
        if (dist >= minD || dist === 0) continue;
        nx /= dist; ny /= dist;
        b.x = bp.x + nx * minD;
        b.y = bp.y + ny * minD;
        if (bp.cool > 0) continue;
        const vn = b.vx * nx + b.vy * ny;
        // 分解速度：切向保留 30%，法向替换为固定击出速度（弹柱"踢球"手感）
        const vtX = b.vx - vn * nx, vtY = b.vy - vn * ny;
        b.vx = vtX * 0.3 + nx * BUMPER_KICK;
        b.vy = vtY * 0.3 + ny * BUMPER_KICK;
        bp.cool = 0.08;
        bp.flash = 0.18;
        spawnSparks(bp.x, bp.y, '#ff8ac2', 10); // 粉色火花强化弹柱命中
        hitShake = Math.max(hitShake, 0.06); // 弹柱命中轻微震台（弱于挡板大力震颤，共用衰减通道）
        // 立体声定位：按弹柱在台面的水平位置分配左右声道（左半左响右半右响）
        SFX.pan(((bp.x / WORLD_W) - 0.5) * 1.2);
        SFX.pinBumper();
        addScore(BUMPER_SCORE * mult, bp.x, bp.y);
        // Jackpot：中央弹柱在清板奖励武装后被打中 → 触发大奖演出
        if (jackpotArmed && bp === bumpers[2]) triggerJackpot();
    }
}

/**
 * 球与目标灯碰撞：位置推出后按法向固定力度反弹（弱于弹柱）；
 * 未点亮的目标被击中即点亮（得分 + 点亮音 + 闪光），全部点亮触发清板奖励（clearBoard）；
 * 已点亮目标仅反弹并溅出小火花，不重复计分
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待碰撞检测的弹球对象
 */
function collideTargets(b) {
    for (const t of targets) {
        let nx = b.x - t.x, ny = b.y - t.y;
        const dist = Math.hypot(nx, ny);
        const minD = BALL_R + t.r;
        if (dist >= minD || dist === 0) continue;
        nx /= dist; ny /= dist;
        // 位置修正：把球推出目标灯表面
        b.x = t.x + nx * minD;
        b.y = t.y + ny * minD;
        if (t.cool > 0) continue;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue; // 正在远离，无需反弹
        // 分解速度：切向保留 40% + 法向替换为固定击出力度
        const vtX = b.vx - vn * nx, vtY = b.vy - vn * ny;
        b.vx = vtX * 0.4 + nx * TARGET_KICK;
        b.vy = vtY * 0.4 + ny * TARGET_KICK;
        t.cool = TARGET_COOL;
        t.flash = TARGET_FLASH;
        if (!t.lit) {
            t.lit = true; // 点亮目标灯
            const litCount = targets.filter(x => x.lit).length; // 已点亮数量（点亮音音调随数量爬升）
            SFX.comboUp(litCount);
            spawnSparks(t.x, t.y, '#9dff5a', 8);
            addScore(TARGET_SCORE * mult, t.x, t.y);
            if (litCount >= targets.length) clearBoard(); // 全部点亮 → 清板奖励
        } else {
            spawnSparks(t.x, t.y, '#cfff9a', 3, 120); // 已点亮：仅小火花反馈
        }
    }
}

/**
 * 球与挡板碰撞（按胶囊体近似：轴到尖端的线段 + 半厚）：
 * 碰撞点处的挡板表面线速度 = 角速度 × 距轴比例 × 长度，
 * 以相对速度计算反弹，实现"拍击把球打出去"的力度传递
 * @param {number} dt 本次物理子步的时间步长（秒），用于求挡板角速度
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待碰撞检测的弹球对象
 */
function collideFlippers(dt, b) {
    for (const f of flippers) {
        const tip = flipperTip(f);
        const dx = tip.x - f.ax, dy = tip.y - f.ay;
        const len2 = dx * dx + dy * dy;
        let t = ((b.x - f.ax) * dx + (b.y - f.ay) * dy) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const cx = f.ax + dx * t, cy = f.ay + dy * t;
        let nx = b.x - cx, ny = b.y - cy;
        const dist = Math.hypot(nx, ny);
        const minD = BALL_R + FLIP_HALF;
        if (dist >= minD) continue;
        if (dist === 0) { nx = 0; ny = -1; } else { nx /= dist; ny /= dist; }
        b.x = cx + nx * minD;
        b.y = cy + ny * minD;
        // 挡板表面线速度：对碰撞点位置关于角度求导 × 角速度（side 处理右挡板镜像）
        const omega = (f.angle - f.prev) / dt;
        const ratio = t; // 碰撞点距轴比例（轴 0 → 尖端 1）
        const svx = -Math.sin(f.angle) * f.side * omega * f.len * ratio;
        const svy = Math.cos(f.angle) * omega * f.len * ratio;
        const vn = (b.vx - svx) * nx + (b.vy - svy) * ny;
        if (vn >= 0) continue;
        b.vx -= (1 + FLIP_RESTITUTION) * vn * nx;
        b.vy -= (1 + FLIP_RESTITUTION) * vn * ny;
        // 正在拍起时追加少量向上助力，保证"接球回击"的手感
        if (f.pressed && omega < 0) b.vy -= 60;
        // 大力击球反馈：碰撞点喷发火花 + 点亮白色发光描边 + 触发画面短促震颤（力度阈值过滤轻触）
        const swing = Math.abs(omega) * f.len * ratio; // 碰撞点处挡板表面线速度
        if (swing > 140 || vn < -150) {
            f.glow = FLIP_GLOW_TIME; // 点亮挡板白色发光描边（drawFlippers 中随剩余时长线性渐隐）
            spawnSparks(cx, cy, '#7ef3ff', 6, 160);
            spawnSparks(cx, cy, '#ffffff', 3, 110);
            hitShake = Math.min(0.22, hitShake + 0.12);
        }
    }
}

/* ===================== 核心逻辑：物理步进 ===================== */

/**
 * 单个物理子步：施加重力 → 限速 → 积分位置 → 依次处理四类碰撞（墙体/弹柱/目标灯/挡板）
 * @param {number} dt 子步时间步长（秒）
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待推进的弹球对象
 */
function stepBall(dt, b) {
    b.vy += gravity * dt;
    // 限速：防止高速穿透细墙
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    collideWalls(b);
    collideBumpers(b);
    collideTargets(b);
    collideFlippers(dt, b);
}

/**
 * 帧级物理更新：遍历场上全部弹球（多球奖励时最多 MAX_BALLS 颗），
 * 各球按自身球速把 dt 拆成若干子步（每步位移 ≤ SUBSTEP_LEN）高速细化防穿墙；
 * 倒序遍历便于失球时移除——无敌档换新球从初始位置自动落下继续，
 * 普通档仅移除丢失的球（多球期间其余球得分照常），场上无球才进入失球演出；
 * 无敌档另带兜底检测，球经侧缝逃出或坐标非法时同样换新球继续
 * @param {number} dt 帧时间步长（秒）
 */
function updatePhysics(dt) {
    for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        const sp = Math.hypot(b.vx, b.vy) + gravity * dt;
        const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(sp * dt / SUBSTEP_LEN)));
        for (let s = 0; s < steps; s++) stepBall(dt / steps, b);
        // 球心滑出台底足够深 → 离场判定（无敌档换新球自动落下继续，普通档移除该球）
        if (b.y > WORLD_H + DRAIN_DEPTH) {
            if (invincibleMode) {
                respawnBall(b);
            } else {
                balls.splice(i, 1); // 仅移除丢失的球，其余球继续（多球期间得分照常）
                loseBall(b);        // 场上仍有余球时不扣球数，全部丢失才进入失球演出
            }
            continue; // 该球已离场（移除或重生），继续处理下一颗
        }
        // 无敌档兜底：球经侧缝逃出台面或坐标非法（未被触底判定捕获）时，
        // 同样初始化新球落回初始位置，保证游戏永不中断（updatePhysics 仅在 play 状态被调用）
        if (invincibleMode) {
            const gone = !Number.isFinite(b.x) || !Number.isFinite(b.y) ||
                b.x < -BALL_R * 2 || b.x > WORLD_W + BALL_R * 2 ||
                b.y < -WORLD_H;
            if (gone) respawnBall(b);
        }
    }
    // 球-球弹性碰撞：全部球完成本步移动后统一对查（每物理步一次；
    // 子步内单球位移 ≤ SUBSTEP_LEN，两球相对位移 < 直径，不会隧穿漏检）
    collideBalls();
}

/**
 * 球-球弹性碰撞（等质量）：遍历全部球对，两球心距离小于直径即接触——
 * 先沿连心线把两球各推出一半重叠量校正位置防粘连，再按等质量弹性碰撞公式
 * 交换法向速度分量（恢复系数 BALL_RESTITUTION，切向分量保留）；
 * 仅在两球相互接近（相对速度朝向彼此）时响应，避免贴合状态下重复弹开；
 * 法向接近速度达 BALL_HIT_MIN_VN 才出反馈（碰撞中点火花 + 撞墙音节流复用 + 计分喂连击），
 * 慢速搭接只做物理分离，防止静止贴靠持续刷分爆音
 */
function collideBalls() {
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i];
            const c = balls[j];
            let dx = c.x - a.x;
            let dy = c.y - a.y;
            let dist = Math.hypot(dx, dy);
            // 完全重合（连心线退化为零向量）时给随机微扰方向，避免除零
            if (dist === 0) {
                dx = (Math.random() - 0.5) * 0.01 || 0.01;
                dy = (Math.random() - 0.5) * 0.01;
                dist = Math.hypot(dx, dy);
            }
            const minDist = BALL_R * 2;
            if (dist >= minDist) continue; // 两球未接触
            const nx = dx / dist; // 连心线单位法向（a → c）
            const ny = dy / dist;
            // 位置校正：沿连心线各退一半重叠量，消除粘连与互相嵌入
            const overlap = minDist - dist;
            a.x -= nx * overlap / 2;
            a.y -= ny * overlap / 2;
            c.x += nx * overlap / 2;
            c.y += ny * overlap / 2;
            // 法向相对速度（负值 = 相互接近），正在分离则不重复响应
            const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (vn >= 0) continue;
            // 等质量弹性碰撞冲量：法向速度按恢复系数比例交换（切向分量不变），
            // 两球获得的冲量等大反向，动量守恒；e=1 时正面对撞恰好完全交换速度
            const imp = (1 + BALL_RESTITUTION) * vn / 2;
            a.vx += imp * nx;
            a.vy += imp * ny;
            c.vx -= imp * nx;
            c.vy -= imp * ny;
            // 接近速度达标才出反馈：碰撞中点火花 + 节流碰撞音 + 计分（自动喂连击倍率）
            if (-vn >= BALL_HIT_MIN_VN) {
                const mx = (a.x + c.x) / 2;
                const my = (a.y + c.y) / 2;
                spawnSparks(mx, my, '#7ef3ff', 8);
                SFX.pinWall(); // 内置 90ms 节流，球-球与撞墙共享防连续爆音
                addScore(BALL_HIT_SCORE * mult, mx, my);
            }
        }
    }
}

/**
 * 衰减全部特效计时器（击球震颤 + 弹柱/弹射器/目标灯的闪光与碰撞冷却 +
 * 挡板击球发光描边 + JACKPOT 大字演出）
 * @param {number} dt 帧时间步长（秒）
 */
function updateTimers(dt) {
    if (hitShake > 0) hitShake = Math.max(0, hitShake - dt); // 击球震颤衰减
    for (const b of bumpers) {
        if (b.cool > 0) b.cool -= dt;
        if (b.flash > 0) b.flash -= dt;
    }
    for (const w of walls) {
        if (w.cool > 0) w.cool -= dt;
        if (w.flash > 0) w.flash -= dt;
    }
    // 目标灯：碰撞冷却与命中闪光衰减
    for (const t of targets) {
        if (t.cool > 0) t.cool -= dt;
        if (t.flash > 0) t.flash -= dt;
    }
    // 挡板击球白色发光描边渐隐
    for (const f of flippers) {
        if (f.glow > 0) f.glow -= dt;
    }
    // JACKPOT 大字演出计时衰减
    if (jackpotFxTimer > 0) jackpotFxTimer -= dt;
    // 连击窗口衰减：窗口内无新得分则连击静默归零（倍率与累计一并复位，无音效不打扰）
    if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
            comboTimer = 0;
            comboHits = 0;
            comboMult = 1;
        }
    }
}

/* ===================== 计分与流程控制 ===================== */

/**
 * 加分入口（连击倍率乘算关口）：先按连击规则累进倍率（窗口内每满 COMBO_STEP 次得分升一级），
 * 再以 原始分（已含难度倍率）× 连击倍率 计入总分并刷新侧栏显示，破纪录仅更新内存并置脏标记
 * （由 flushHighScore 在结算/存档钩子时机统一落盘，避免碰撞热路径每次得分都同步写 localStorage）；
 * 首次打破最高分的瞬间播放专属音效与全屏庆祝特效；实时上报成就数据（得分/连击/倍率，达标自动解锁）；
 * 连击升级瞬间在台面中央弹出 COMBO ×N 飘字并播放音调随级爬升的连击音
 * @param {number} pts 本次得分（已含难度倍率，不含连击倍率）
 * @param {number} wx 得分发生点世界坐标 x（飘字定位）
 * @param {number} wy 得分发生点世界坐标 y
 */
function addScore(pts, wx, wy) {
    // 连击累进：窗口内任意得分刷新计时；每满 COMBO_STEP 次提升一级倍率，封顶 COMBO_MAX_MULT
    comboHits++;
    comboTimer = COMBO_WINDOW;
    const nextMult = Math.min(COMBO_MAX_MULT, 1 + Math.floor(comboHits / COMBO_STEP));
    if (nextMult > comboMult) {
        comboMult = nextMult;
        trackRunStat('mult', comboMult); // 成就上报：连击倍率峰值（达标解锁 mult5）
        // 升级演出：台面中央金色 COMBO 飘字 + 音调随级爬升的连击音
        floatTexts.push({ x: WORLD_W / 2, y: WORLD_H * 0.32, txt: 'COMBO ×' + comboMult, t: 0 });
        SFX.comboUp(comboMult);
    }
    trackRunStat('combo', comboHits); // 成就上报：连击计数峰值（达标解锁 combo30/combo100）
    const total = pts * comboMult; // 最终得分 = 原始分（含难度倍率）× 连击倍率
    score += total;
    trackRunStat('score', score); // 成就上报：单局得分（addScore 为全部得分唯一入口，达标解锁 score 系成就）
    FX.tweenNumber(scoreElement, score, 128); // 分数数字滚动过渡（128ms 快速插值）
    // 得分 DOM 弹跳：放大回弹强化"涨分"瞬间反馈（WAAPI 播完自动清理）
    scoreElement.animate(
        [
            { transform: 'scale(1)' },
            { transform: 'scale(1.18)' },
            { transform: 'scale(1)' }
        ],
        { duration: 160, easing: 'ease-out' }
    );
    if (score > highScore) {
        // 破纪录沿检测：仅在首次超越历史最高分的瞬间触发一次专属音效与庆祝特效
        const wasRecord = isNewRecord;
        highScore = score;
        isNewRecord = true;
        highScoreDirty = true; // 仅置脏：落盘统一交给 flushHighScore（结算/存档钩子时机），热路径不写 localStorage
        highElement.textContent = highScore;
        if (!wasRecord) {
            SFX.newRecord(); // 破纪录专属音效
            FX.recordBurst(); // 全屏庆祝特效（减少动态偏好时库内自动跳过）
        }
    }
    floatTexts.push({ x: wx, y: wy, txt: '+' + total, t: 0 }); // 飘字显示乘算连击后的最终得分
}

/**
 * 落盘最高分（脏标记置位时才真正写 localStorage，键 pinballHighScore）：
 * 在既有落盘时机统一调用——结算（gameOver）与各存档钩子（saveSnapshot 的三个触发点：
 * 返回大厅链接 / arcade:save 消息 / pagehide），碰撞热路径内不再同步写存储；
 * 存储写入失败（隐私模式 / 配额满）静默忽略，脏标记保留供下次时机重试
 */
function flushHighScore() {
    if (!highScoreDirty) return; // 无新增破纪录：幂等返回，零 IO
    try {
        localStorage.setItem('pinballHighScore', String(highScore));
        highScoreDirty = false; // 写入成功才清脏标记，失败则保留待下次重试
    } catch (err) {
        // 存储不可用：静默忽略（与 saveSnapshot 同口径，不影响游戏）
    }
}

/**
 * 更新得分飘字：生命进度推进，超时移除（倒序遍历便于 splice）
 * @param {number} dt 帧时间步长（秒）
 */
function updateFloatTexts(dt) {
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        floatTexts[i].t += dt / 0.8;
        if (floatTexts[i].t >= 1) floatTexts.splice(i, 1);
    }
}

/**
 * 清板奖励：全部目标灯点亮后触发——加分 + CLEAR! 飘字 + 重置目标灯 +
 * 武装 Jackpot（下次击中中央弹柱触发大奖）+ 掉落多球奖励
 */
function clearBoard() {
    addScore(CLEAR_SCORE * mult, WORLD_W / 2, 170);
    floatTexts.push({ x: WORLD_W / 2, y: 150, txt: 'CLEAR!', t: 0 });
    // 重置目标灯：全部熄灭并附带短暂冷却，防止刚重置就被同一颗球立即重复点亮
    for (const t of targets) {
        t.lit = false;
        t.cool = 0.3;
        t.flash = 0.3;
    }
    jackpotArmed = true; // 武装 Jackpot
    SFX.beeWaveClear();
    spawnMultiball(); // 清板奖励：掉落多球
}

/**
 * 触发 Jackpot 大奖：清板武装后击中中央弹柱时调用——
 * 加 5000×倍率 + 金色大字演出 + 80ms 顿帧 + 全库最华丽音效 + 解锁成就
 */
function triggerJackpot() {
    jackpotArmed = false; // 复位武装标记：一次大奖后需重新清板才能再触发
    addScore(JACKPOT_SCORE * mult, WORLD_W / 2, 210);
    jackpotFxTimer = JACKPOT_FX_TIME; // 启动金色大字演出（drawJackpotFx 渲染）
    FX.hitstop(80); // 顿帧强化大奖冲击感（减少动态偏好时库内自动跳过）
    FX.shake(canvas, 5, 280); // 大奖全屏震动（强烈冲击感）
    SFX.klRankS();
    unlockAchievement('jackpot');
}

/**
 * 多球奖励（清板附带）：向场上补掉 2 颗新球（受同场上限 MAX_BALLS 约束），
 * 新球从台顶两侧错位落下并带随机斜向初速；成功掉球时飘出 MULTIBALL 提示并播发射音；
 * 同场达到 3 球时解锁 multiball3 成就
 */
function spawnMultiball() {
    const need = Math.min(2, MAX_BALLS - balls.length); // 计算还可补充的球数
    for (let i = 0; i < need; i++) {
        const dir = i === 0 ? -1 : 1; // 两颗新球分别偏向左右两侧错位落下
        const nb = makeBall(WORLD_W / 2 + dir * 50, 26, dir * (45 + Math.random() * 40), 60);
        balls.push(nb);
        spawnSparks(nb.x, nb.y, '#7ef3ff', 8, 150); // 出生火花提示新球位置
    }
    if (need > 0) {
        floatTexts.push({ x: WORLD_W / 2, y: 60, txt: 'MULTIBALL', t: 0 });
        SFX.pinLaunch();
    }
    trackRunStat('balls', balls.length); // 成就上报：同场球数峰值（trackRunStat 达标自动解锁 multiball3）
}

/**
 * 失球演出更新：球坠出判定线后在深渊中继续加速下坠（2.5 倍重力强化坠落感）；
 * 计时推进到 LOST_FX_TIME 后，仍有余球则回待发射，否则进入结算
 * @param {number} dt 帧时间步长（秒）
 */
function updateLoseFx(dt) {
    if (!lostBall) return; // 守卫：坠落球引用缺失时跳过（防御异常状态）
    // 演出期球保持惯性并加速坠落，投影很快滑出画布底部形成"掉进去"的观感
    lostBall.vy += gravity * 2.5 * dt;
    lostBall.x += lostBall.vx * dt;
    lostBall.y += lostBall.vy * dt;
    loseTimer += dt;
    if (loseTimer >= LOST_FX_TIME) {
        if (lives > 0) {
            resetBall();
            state = 'ready';
        } else {
            gameOver();
        }
    }
}

/**
 * 失球（传入刚落底的那颗球）：场上仍有余球时仅移除该球，不扣球数、不进演出
 * （多球期间其余球得分照常）；全部球丢失才扣剩余球数并进入 lost 演出状态
 * （震动 + 红色警报 + 落底冲击波），演出结束后再回待发射或结算
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 刚落底的弹球对象
 */
function loseBall(b) {
    if (balls.length > 0) return; // 仍有余球在场：不扣球数、不进演出，仅移除该球
    // 末球落底：连击断连（倍率归一、累计清零），新球从 ×1 重新起步
    comboHits = 0;
    comboTimer = 0;
    comboMult = 1;
    lives--;
    drawBalls();
    loseTimer = 0;
    state = 'lost';
    lostBall = b; // 记录坠落球引用，供失球演出继续渲染坠落
    lostBall.trail.length = 0; // 清空该球拖尾，失球坠落不需要残影
    // 落底瞬间在深渊口喷发火花（红为主 + 橙点缀），粒子随震动层抖动、演出期继续余韵
    spawnSparks(b.x, WORLD_H - 6, '#ff5a5a', 16, 230);
    spawnSparks(b.x, WORLD_H - 6, '#ff9a3e', 8, 180);
    // 失球哀鸣无条件播放；最后一球的结算结束音在演出结束时隔 1.1s 才响，不会叠音
    SFX.pinLose();
}

/**
 * 无敌模式专用（多球安全）：单颗球离出台面（落底或异常逃逸）后不减剩余球数，
 * 该球原地重置于初始位置并获得斜向下的初速（随机偏向一侧的水平分量 + 向下分量），
 * 以 play 状态自动落下继续，其余在场球不受影响；
 * 不进失球演出、不播哀鸣，仅以"NEW BALL"飘字、出生火花与发射音提示新球已就位
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待重生的弹球对象
 */
function respawnBall(b) {
    b.x = WORLD_W / 2; // 原地重生：该球重置到台面顶部中央待落点
    b.y = 26;
    b.vy = 60; // 向下初速：新球从初始位置自动落下，无需玩家蓄力发射
    // 随机偏向一侧的水平初速（方向五五开、量值恒在 45~85）：
    // 保证新球以斜向角度落下，避免正中央垂直落下时与台面正下方固定弹柱
    // 形成"垂直弹上弹下"的死循环（游戏未死但玩家无法参与）
    b.vx = (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 40);
    b.trail.length = 0; // 清空该球拖尾，避免跨状态残影
    state = 'play';
    floatTexts.push({ x: b.x, y: b.y + 60, txt: 'NEW BALL', t: 0 });
    spawnSparks(b.x, b.y, '#7ef3ff', 8, 150); // 出生火花提示新球位置
    SFX.pinLaunch();
}

/**
 * 重置场上弹球：清空全部在场球，仅保留一颗位于台面顶部中央待落点的新球（速度清零），
 * 并清除失球演出坠落球引用；用于开始新局与失球演出结束后的回场
 */
function resetBall() {
    balls.length = 0;
    balls.push(makeBall(WORLD_W / 2, 26));
    lostBall = null;
}

/**
 * 发射：按蓄力力度给球初速度进入 play 状态——力度越大初始下落越猛、水平扰动越大，
 * 并在球体处喷发对应力度的火花（满力金色、否则青色）；快速点按松开时蓄力接近 0，以最弱力度发射
 * @param {number} [power=0.35] 蓄力力度 0~1（按住空格时长 / CHARGE_TIME，仅签名缺省，实际调用总传入蓄力值）
 */
function launch(power = 0.35) {
    const b = balls[0];
    if (!b) return; // 守卫：场上无球时忽略发射
    b.vy = 60 + power * 150;                                 // 力度越大初始下落越猛
    b.vx = (Math.random() * 160 - 80) * (0.4 + 0.6 * power); // 力度越大水平扰动越大
    spawnSparks(b.x, b.y, power >= 1 ? '#ffd23e' : '#7ef3ff', 8 + Math.round(power * 8), 150 + power * 120);
    b.trail.length = 0; // 从发射点重新积累拖尾
    SFX.pinLaunch();
    state = 'play';
}

/**
 * 选择难度：切换按钮高亮，并从按钮 data 属性读取重力 / 挡板长度 / 计分倍率 / 无敌标记，
 * 立即重建挡板长度与侧栏倍率显示
 * @param {HTMLButtonElement} btn 被点击的难度按钮（data-gravity / data-flip / data-mult / data-invincible）
 */
function selectDifficulty(btn) {
    document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    gravity = parseFloat(btn.dataset.gravity);
    flipperLen = parseFloat(btn.dataset.flip);
    mult = parseInt(btn.dataset.mult, 10);
    invincibleMode = btn.dataset.invincible === '1'; // 仅"无敌"按钮带 data-invincible="1"，落底不丢球换新球
    multElement.textContent = '×' + mult;
    rebuildFlippers();
    // 持久化所选难度（按钮组中的序号），供下次加载时恢复；存储不可用时静默跳过，保证后续 uiClick 音效正常
    try {
        localStorage.setItem(DIFFICULTY_KEY, String([...document.querySelectorAll('.difficulty-btn')].indexOf(btn)));
    } catch (e) { /* 存储不可用（隐私模式/禁用站点数据）：静默忽略 */ }
    SFX.uiClick();
}

/**
 * 按当前难度重建挡板长度（角度复位到收拢位）
 */
function rebuildFlippers() {
    for (const f of flippers) {
        f.len = flipperLen;
        f.angle = FLIP_REST;
        f.prev = FLIP_REST;
    }
}

/**
 * 开始游戏（开始/重新开始按钮入口）：隐藏全部遮罩（含成就面板）→
 * 重置分数/球数/弹球/飘字/火花/目标灯/挡板发光/Jackpot 状态/物理累加器 →
 * 进入待发射状态 → 播放开场音并启动 BGM 循环
 */
function startGame() {
    // 移除按钮焦点，避免随后按空格误触发按钮点击
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    startScreen.style.display = 'none';
    achWall.hidden = true; // 收起可能打开的成就墙
    achPanelOpen = false;
    gameOverScreen.style.display = 'none';
    pauseScreen.style.display = 'none';
    pauseRestoreTip.style.display = 'none'; // 复位进度恢复提示，新局暂停时不残留
    score = 0;
    isNewRecord = false;
    lives = TOTAL_BALLS;
    isPaused = false;
    floatTexts.length = 0;
    sparkPool.clear(); // 归还全部火花（池对象保留复用）
    for (const t of targets) { t.lit = false; t.cool = 0; t.flash = 0; } // 目标灯全灭
    for (const f of flippers) f.glow = 0; // 挡板发光复位
    jackpotArmed = false;
    jackpotFxTimer = 0;
    comboHits = 0; // 连击状态清零：累计次数/窗口/倍率全部复位
    comboTimer = 0;
    comboMult = 1;
    // 重置成就本局峰值收集器（历史最佳存档 achStore.best 不重置）
    runStats.score = 0;
    runStats.combo = 0;
    runStats.mult = 1;
    runStats.balls = 1;
    accumulator = 0; // 物理累加器清零，避免残留帧时长带入新局
    scoreElement.textContent = '0';
    rebuildFlippers();
    resetBall();
    drawBalls();
    state = 'ready';
    SFX.start();
    SFX.bgm.start('pinball'); // 启动弹珠台 BGM 循环
}

/**
 * 游戏结束：填充最终分数与"新纪录"提示 → 显示结束遮罩 → 停止 BGM → 播放结束音
 */
function gameOver() {
    state = 'over';
    flushHighScore(); // 结算落盘：本局破纪录值在此统一持久化（原来由 addScore 实时写入，现改为结算时机）
    try {
        localStorage.removeItem(SAVE_KEY); // 本局已终结：清除进度快照，下次进入按新局处理
    } catch (e) { /* 存储不可用：静默跳过，确保结算面板与音效不受存储异常中断 */ }
    finalScoreElement.textContent = score;
    newRecordElement.style.display = isNewRecord ? 'block' : 'none';
    gameOverScreen.style.display = 'block';
    SFX.bgm.stop();
    SFX.gameOver();
}

/**
 * 切换暂停：仅在进行中（ready/play）且成就墙未打开时生效（成就墙打开期间局面已冻结，
 * 暂停键不响应，关闭墙面后局面原样继续），暂停时显示遮罩、冻结物理更新，
 * 并接入暂停/恢复音效与 BGM 暂停续播
 */
function togglePause() {
    if (state !== 'play' && state !== 'ready') return;
    if (achPanelOpen) return; // 成就墙打开中：暂停键不生效，避免与墙面冻结叠加出双层遮罩
    isPaused = !isPaused;
    pauseScreen.style.display = isPaused ? 'block' : 'none';
    if (isPaused) {
        SFX.bgm.pause();
        SFX.uiPause();
    } else {
        pauseRestoreTip.style.display = 'none'; // 进度恢复引入的暂停：玩家继续后撤下提示，常规暂停不显示
        SFX.bgm.resume();
        SFX.uiResume();
    }
}

/* ===================== 进度快照：保存与恢复 ===================== */

/**
 * 保存当前局进度快照到 localStorage（键 arcade_save_pinball）：
 * 仅在「进行中（ready/play）或暂停中」时组装纯数据快照写入（只含数值/字符串/布尔/数组，
 * 不含函数与 DOM 引用）；处于开始界面 / 失球演出 / 结算界面时清除已有快照，
 * 避免下次进入恢复到过期进度。全程 try/catch 静默，存储不可用（隐私模式等）不影响游戏。
 * 快照内容：版本号 / 状态与暂停标记 / 分数 / 剩余球数 / 难度参数（倍率·重力·挡板长·无敌档）/
 * Jackpot 武装标记 / 连击状态 / 各目标灯点亮状态 / 各球位置与速度向量；
 * 挡板角度、拖尾、火花、飘字等纯视觉或瞬态对象不保存（恢复时按默认重建）。
 */
function saveSnapshot() {
    try {
        flushHighScore(); // 复用三个既有存档钩子（返回大厅 / arcade:save / pagehide）顺带补写脏最高分，避免中途刷新丢纪录
        if (state !== 'play' && state !== 'ready') {
            localStorage.removeItem(SAVE_KEY); // 未开始 / 已结束：清除残留快照
            return;
        }
        const snap = {
            v: 1,                          // 快照格式版本号，恢复时校验（v !== 1 即弃用）
            state: state,                  // 保存时刻的游戏状态（ready 待发射 / play 进行中）
            paused: !!isPaused,            // 保存时刻是否处于暂停
            score: score,                  // 当前分数
            lives: lives,                  // 剩余球数（含在场球）
            mult: mult,                    // 难度计分倍率
            gravity: gravity,              // 难度重力加速度
            flipperLen: flipperLen,        // 难度挡板长度
            invincible: !!invincibleMode,  // 是否无敌档
            jackpotArmed: !!jackpotArmed,  // Jackpot 武装标记（清板后待触发大奖）
            comboHits: comboHits,          // 连击累计次数
            comboMult: comboMult,          // 当前连击倍率
            comboTimer: comboTimer,        // 连击窗口剩余秒数
            targetLit: targets.map(t => !!t.lit), // 各目标灯点亮状态（数组与台面目标一一对应）
            balls: balls.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })) // 各球位置与速度向量
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
    } catch (err) {
        // 存储写入失败（隐私模式 / 配额满 / 序列化异常）：静默忽略，不打断游戏
    }
}

/**
 * 从 localStorage 恢复上次进度快照（键 arcade_save_pinball）：
 * 读取 → JSON 解析 → 版本号与逐字段类型 / 范围校验（球坐标与速度必须有限且在台面合理范围、
 * 球数 1~3、分数非负有限等），任何异常或非法数据一律清除快照并返回 false，绝不因脏数据抛错；
 * 校验通过后覆盖游戏状态（含难度参数 / 目标灯 / Jackpot / 连击 / 多球位置速度），
 * 挡板复位默认角度、清空瞬态演出对象，刷新 HUD 与画布一帧，
 * 并停回暂停遮罩（追加"已恢复上次进度"提示）等待玩家按 P / 空格继续——不立即开跑。
 * @returns {boolean} true 表示已成功恢复快照；false 表示无快照或快照非法（维持默认新局）
 */
function restoreSnapshot() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false; // 无存档：按新局处理
        const s = JSON.parse(raw);
        // 版本校验：首字段 v !== 1 视为过期 / 异构快照，直接弃用
        if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1) throw new Error('bad version');
        // 状态与暂停标记：仅接受 ready / play 两种可恢复状态
        if ((s.state !== 'ready' && s.state !== 'play') || typeof s.paused !== 'boolean') throw new Error('bad state');
        // 分数：非负有限
        if (!Number.isFinite(s.score) || s.score < 0) throw new Error('bad score');
        // 剩余球数：1 ~ 单局总球数（0 球即已结算，不存在合法快照）
        if (!Number.isInteger(s.lives) || s.lives < 1 || s.lives > TOTAL_BALLS) throw new Error('bad lives');
        // 难度参数：与四档按钮的 data 取值范围一致
        if (!Number.isInteger(s.mult) || s.mult < 1 || s.mult > 3) throw new Error('bad mult');
        if (!Number.isFinite(s.gravity) || s.gravity <= 0 || s.gravity > 5000) throw new Error('bad gravity');
        if (!Number.isFinite(s.flipperLen) || s.flipperLen <= 0 || s.flipperLen > WORLD_W) throw new Error('bad flipper');
        if (typeof s.invincible !== 'boolean' || typeof s.jackpotArmed !== 'boolean') throw new Error('bad flags');
        // 连击状态：累计次数非负整数、倍率 1 ~ 封顶、窗口剩余时长非负有限
        if (!Number.isInteger(s.comboHits) || s.comboHits < 0) throw new Error('bad comboHits');
        if (!Number.isInteger(s.comboMult) || s.comboMult < 1 || s.comboMult > COMBO_MAX_MULT) throw new Error('bad comboMult');
        if (!Number.isFinite(s.comboTimer) || s.comboTimer < 0) throw new Error('bad comboTimer');
        // 目标灯：布尔数组且长度与台面目标数一致
        if (!Array.isArray(s.targetLit) || s.targetLit.length !== targets.length ||
            !s.targetLit.every(x => typeof x === 'boolean')) throw new Error('bad targets');
        // 弹球：1 ~ MAX_BALLS 颗，坐标有限且在台面合理范围、合速度不超上限
        if (!Array.isArray(s.balls) || s.balls.length < 1 || s.balls.length > MAX_BALLS) throw new Error('bad balls');
        for (const b of s.balls) {
            if (!b || typeof b !== 'object') throw new Error('bad ball');
            if (!Number.isFinite(b.x) || b.x < -BALL_R * 2 || b.x > WORLD_W + BALL_R * 2) throw new Error('bad ball x');
            if (!Number.isFinite(b.y) || b.y < -BALL_R * 2 || b.y > WORLD_H + DRAIN_DEPTH) throw new Error('bad ball y');
            if (!Number.isFinite(b.vx) || !Number.isFinite(b.vy) || Math.hypot(b.vx, b.vy) > MAX_SPEED) throw new Error('bad ball v');
        }
        /* ---- 校验全部通过：覆盖游戏状态 ---- */
        score = s.score;
        lives = s.lives;
        mult = s.mult;
        gravity = s.gravity;
        flipperLen = s.flipperLen;
        invincibleMode = s.invincible;
        jackpotArmed = s.jackpotArmed;
        jackpotFxTimer = 0;      // JACKPOT 大字属纯视觉演出，不恢复
        comboHits = s.comboHits;
        comboMult = s.comboMult;
        comboTimer = s.comboTimer;
        isNewRecord = false;     // 破纪录标记按本会话重新沿检测（快照分数不会超已持久化的最高分）
        isPaused = true;         // 恢复后先冻结物理，等待玩家按键继续
        state = s.state;
        lostBall = null;         // 失球演出坠落球引用不跨会话保留
        charging = false;        // 蓄力为瞬态输入，恢复时复位
        charge = 0;
        accumulator = 0;         // 物理累加器清零，避免残留帧时长
        floatTexts.length = 0;   // 飘字 / 火花 / 拖尾等纯视觉对象清空
        sparkPool.clear();
        for (const t of targets) { t.cool = 0; t.flash = 0; } // 碰撞冷却与闪光复位
        targets.forEach((t, i) => { t.lit = s.targetLit[i]; }); // 恢复目标灯点亮进度
        for (const f of flippers) { f.pressed = false; f.glow = 0; }
        rebuildFlippers();       // 挡板恢复默认收拢角度，长度随快照难度重建
        balls.length = 0;
        for (const b of s.balls) balls.push(makeBall(b.x, b.y, b.vx, b.vy)); // 重建各球（拖尾为空）
        // 同步难度按钮高亮，使其与快照实际难度参数一致（视觉与玩法参数统一）
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.toggle('active',
                parseFloat(btn.dataset.gravity) === gravity &&
                parseFloat(btn.dataset.flip) === flipperLen &&
                parseInt(btn.dataset.mult, 10) === mult &&
                (btn.dataset.invincible === '1') === invincibleMode);
        });
        // 刷新 HUD 与画布一帧：侧栏分数 / 倍率 / 剩余球数 + 台面快照画面
        FX.tweenNumber(scoreElement, score, 128); // 分数数字滚动过渡到续玩分数
        multElement.textContent = '×' + mult;
        drawBalls();
        draw(performance.now());
        // 停回暂停遮罩等待玩家输入（开始遮罩隐藏，不立即开跑），并亮出恢复提示
        startScreen.style.display = 'none';
        gameOverScreen.style.display = 'none';
        pauseScreen.style.display = 'block';
        pauseRestoreTip.style.display = 'block';
        // 预置 BGM 曲目并保持暂停态：玩家按 P 继续时由 togglePause 的 resume 正常响起
        //（音频尚未解锁时由公共库在首次手势后自动补启，pause 标记保证静默待命）
        SFX.bgm.start('pinball');
        SFX.bgm.pause();
        return true;
    } catch (err) {
        // 任何解析 / 校验异常：清除非法快照，按无存档处理（绝不向游戏层抛错）
        try {
            localStorage.removeItem(SAVE_KEY);
        } catch (ignored) {
            // 存储不可用：忽略
        }
        return false;
    }
}

/* ===================== 成就系统：函数实现（常量与存档定义见文件头部区块） ===================== */

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
    } catch (err) { /* 存档损坏：按全新档案处理 */ }
    return { unlocked: {}, best: { ...BEST_DEFAULTS } };
}

/**
 * 持久化成就存档（unlocked 解锁表 + best 历史最佳一并写入 localStorage）
 */
function saveAchStore() {
    try {
        localStorage.setItem(ACH_KEY, JSON.stringify(achStore));
    } catch (err) { /* 隐私模式写入失败：成就提示照常弹出，仅不入盘，不中断结算链 */ }
}

/**
 * 上报本局峰值并驱动成就判定：刷新 runStats 与历史最佳（只增不减），
 * 随后检查引用该维度的全部成就，达标即解锁
 * @param {string} stat 数据维度（score/combo/mult/balls，对应 BEST_DEFAULTS 键）
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
 * 解锁成就：幂等（已解锁静默返回）→ 持久化 → toast 堆叠提示 + 音效，
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
        SFX.newRecord(); // 成就解锁音：对齐全库音色（与贪吃蛇/俄罗斯方块机台一致复用破纪录五连琶音）
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
        // 进度条：历史最佳 / 目标值（封顶 100%）；事件型成就按达成状态显示满/零进度
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
 * 冻结由主循环与失球演出的 achPanelOpen 闸门保证（与手动暂停 isPaused 相互独立）；
 * 进行中的局随墙面打开挂起 BGM、关闭后续播，并重置计时基准防止恢复瞬间 delta 暴涨
 */
function toggleAchPanel() {
    achPanelOpen = !achPanelOpen;
    achWall.hidden = !achPanelOpen;
    SFX.uiClick(); // 开关提示音
    if (achPanelOpen) {
        renderAchWall();
        // 进行中的局：BGM 同步挂起保留进度（暂停态的局不动 BGM，避免与暂停续播逻辑互踩）
        if ((state === 'play' || state === 'ready') && !isPaused) SFX.bgm.pause();
    } else {
        lastTime = performance.now(); // 重置计时基准，防止关闭瞬间帧时长暴涨导致物理大步跳变
        if ((state === 'play' || state === 'ready') && !isPaused) SFX.bgm.resume();
    }
}

// 点击成就墙遮罩空白处关闭（点在面板内部不触发）：与键盘 Esc / 关闭按钮同走 toggleAchPanel
achWall.addEventListener('pointerdown', e => {
    if (e.target === e.currentTarget) toggleAchPanel();
});

/* ===================== 渲染 ===================== */

/* ---------- 台面静态层离屏缓存：梯形底 + 透视网格 + 普通墙 + 危险区仅按需重绘一次 ---------- */

/** 台面静态层离屏画布（物理分辨率与主画布保持一致） */
const tableLayerCanvas = document.createElement('canvas');
/** 台面静态层绘制上下文 */
const tableLayerCtx = tableLayerCanvas.getContext('2d');
/** 台面静态层脏标记：true 时下一帧重建（DPR 适配 / 画布尺寸变化时由 resize 监听置位） */
let tableLayerDirty = true;

/**
 * 将台面静态内容渲染到离屏层：透视梯形底色 → 透视网格线 → 普通墙体霓虹描边 → 落底危险区。
 * 弹射器（sling）因击发闪白为动态元素不进层，由 drawTable 每帧单独绘制；
 * shadowBlur 发光是画布最贵操作，原先约 20 条发光墙线每帧重绘，静态化后每帧仅弹射器两条承担
 */
function renderTableLayer() {
    const view = FX.dims(canvas); // 读主画布 dpr：离屏层与主画布共用同一逻辑坐标系
    tableLayerCanvas.width = canvas.width; // 物理分辨率与主画布对齐（1:1 贴回不缩放）
    tableLayerCanvas.height = canvas.height;
    tableLayerCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); // 锁 CSS 逻辑坐标，绘制代码零换算
    tableLayerCtx.clearRect(0, 0, VIEW_W, VIEW_H);

    // 台面梯形（四角投影），纵向渐变营造进深
    const pTL = project(0, 0), pTR = project(WORLD_W, 0);
    const pBR = project(WORLD_W, WORLD_H), pBL = project(0, WORLD_H);
    const grad = tableLayerCtx.createLinearGradient(0, pTL.y, 0, pBL.y);
    grad.addColorStop(0, '#191938');
    grad.addColorStop(1, '#0c0c1e');
    tableLayerCtx.fillStyle = grad;
    tableLayerCtx.beginPath();
    tableLayerCtx.moveTo(pTL.x, pTL.y);
    tableLayerCtx.lineTo(pTR.x, pTR.y);
    tableLayerCtx.lineTo(pBR.x, pBR.y);
    tableLayerCtx.lineTo(pBL.x, pBL.y);
    tableLayerCtx.closePath();
    tableLayerCtx.fill();

    // 透视网格：竖线随深度收拢，横线等距（增强 3D 纵深感）
    tableLayerCtx.strokeStyle = 'rgba(193, 123, 255, 0.08)';
    tableLayerCtx.lineWidth = 1;
    tableLayerCtx.beginPath();
    for (let x = 40; x < WORLD_W; x += 40) {
        const a = project(x, 0), b = project(x, WORLD_H);
        tableLayerCtx.moveTo(a.x, a.y);
        tableLayerCtx.lineTo(b.x, b.y);
    }
    for (let y = 40; y < WORLD_H; y += 40) {
        const a = project(0, y), b = project(WORLD_W, y);
        tableLayerCtx.moveTo(a.x, a.y);
        tableLayerCtx.lineTo(b.x, b.y);
    }
    tableLayerCtx.stroke();

    // 普通墙体：紫色霓虹（弹射器除外，线宽随深度缩放）
    tableLayerCtx.lineCap = 'round';
    tableLayerCtx.shadowBlur = 10;
    for (const w of walls) {
        if (w.sling) continue; // 弹射器动态绘制，不进静态层
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        const a = project(w.x1, w.y1), b = project(w.x2, w.y2);
        tableLayerCtx.shadowColor = '#c17bff';
        tableLayerCtx.strokeStyle = '#c17bff';
        tableLayerCtx.lineWidth = 7 * project(mx, my).s;
        tableLayerCtx.beginPath();
        tableLayerCtx.moveTo(a.x, a.y);
        tableLayerCtx.lineTo(b.x, b.y);
        tableLayerCtx.stroke();
    }
    tableLayerCtx.shadowBlur = 0;

    // 落底危险区：台底中央暗红渐变（纯静态，原 drawDrain 并入本层）
    const da = project(60, 540), db = project(WORLD_W - 60, 540);
    const dc = project(WORLD_W - 60, WORLD_H), dd = project(60, WORLD_H);
    const dgrad = tableLayerCtx.createLinearGradient(0, da.y, 0, dd.y);
    dgrad.addColorStop(0, 'rgba(255, 60, 60, 0)');
    dgrad.addColorStop(1, 'rgba(255, 60, 60, 0.22)');
    tableLayerCtx.fillStyle = dgrad;
    tableLayerCtx.beginPath();
    tableLayerCtx.moveTo(da.x, da.y);
    tableLayerCtx.lineTo(db.x, db.y);
    tableLayerCtx.lineTo(dc.x, dc.y);
    tableLayerCtx.lineTo(dd.x, dd.y);
    tableLayerCtx.closePath();
    tableLayerCtx.fill();
}

/**
 * 绘制台面每帧内容：静态层脏标记置位时重建一次后整体贴回，
 * 再单独绘制两条弹射器（黄色霓虹，击发瞬间闪白）
 */
function drawTable() {
    if (tableLayerDirty) {
        renderTableLayer();
        tableLayerDirty = false;
    }
    ctx.drawImage(tableLayerCanvas, 0, 0, VIEW_W, VIEW_H);
    // 弹射器：黄色霓虹（击发瞬间闪白），线宽随深度缩放
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    for (const w of walls) {
        if (!w.sling) continue; // 普通墙已在静态层
        const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2;
        const a = project(w.x1, w.y1), b = project(w.x2, w.y2);
        ctx.shadowColor = '#ffd23e';
        ctx.strokeStyle = w.flash > 0 ? '#ffffff' : '#ffd23e';
        ctx.lineWidth = 7 * project(mx, my).s;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;
}

/**
 * 绘制顶部 marquee 装饰灯：沿三段顶墙 chase 流水点亮，营造街机氛围
 * @param {number} now 当前帧时间戳（毫秒）
 */
function drawLamps(now) {
    const idx = Math.floor(now / 140) % lampPts.length;
    for (let i = 0; i < lampPts.length; i++) {
        const p = project(lampPts[i].x, lampPts[i].y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 * p.s, 0, Math.PI * 2);
        if (i === idx) {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 8;
        } else {
            ctx.fillStyle = 'rgba(193, 123, 255, 0.35)';
            ctx.shadowBlur = 0;
        }
        ctx.fill();
    }
    ctx.shadowBlur = 0;
}

/**
 * 绘制弹柱：贴台面椭圆阴影 + 粉色霓虹圆（径向渐变）+ 内环；
 * 击发瞬间（flash>0）整体闪白并叠加外圈冲击光环；
 * Jackpot 武装期间中央弹柱叠加金色呼吸外环提示（击中即触发大奖）
 * @param {number} now 当前帧时间戳（毫秒），用于呼吸外环脉动
 */
function drawBumpers(now) {
    for (const b of bumpers) {
        const p = project(b.x, b.y);
        const r = b.r * p.s;
        // 台面阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.55, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        // 本体：击发闪白 → 常态粉色径向渐变
        if (b.flash > 0) {
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 25;
            ctx.fillStyle = '#ffffff';
        } else {
            ctx.shadowColor = '#ff3ea5';
            ctx.shadowBlur = 16;
            const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.2, p.x, p.y, r);
            g.addColorStop(0, '#ff8ac2');
            g.addColorStop(0.65, '#ff3ea5');
            g.addColorStop(1, '#b0155e');
            ctx.fillStyle = g;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // 内环装饰
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        // 冲击光环（随 flash 淡出扩大）
        if (b.flash > 0) {
            const k = 1 - b.flash / 0.18; // 0 → 1 扩散进度
            ctx.strokeStyle = `rgba(255, 255, 255, ${(b.flash / 0.18) * 0.6})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * (1 + k * 0.7), 0, Math.PI * 2);
            ctx.stroke();
        }
        // Jackpot 武装提示：中央弹柱金色呼吸外环（sin 脉动强度与半径，击中即得大奖）
        if (jackpotArmed && b === bumpers[2]) {
            const pulse = 0.6 + 0.4 * Math.sin(now / 150);
            ctx.strokeStyle = `rgba(255, 210, 62, ${0.35 + 0.55 * pulse})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 6 + pulse * 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

/**
 * 绘制目标灯：贴台面椭圆阴影 + 点亮态（绿色实心发光 + 呼吸外环）与未点亮态（紫色空芯）两种样式；
 * 命中闪光（flash>0）叠加白色泛光；全部点亮后由 clearBoard 重置回未点亮
 * @param {number} now 当前帧时间戳（毫秒），用于已点亮态呼吸外环脉动
 */
function drawTargets(now) {
    for (const t of targets) {
        const p = project(t.x, t.y);
        const r = t.r * p.s;
        // 台面椭圆阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + r * 0.55, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
        if (t.lit) {
            // 已点亮：绿色实心发光球，命中闪光瞬间整体闪白
            const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, r * 0.2, p.x, p.y, r);
            if (t.flash > 0) {
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 24;
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.shadowColor = '#9dff5a';
                ctx.shadowBlur = 14;
                g.addColorStop(0, '#e2ffc9');
                g.addColorStop(0.6, '#9dff5a');
                g.addColorStop(1, '#4e9e1c');
                ctx.fillStyle = g;
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            // 呼吸外环：提示该灯已计入清板进度
            ctx.strokeStyle = `rgba(157, 255, 90, ${0.3 + 0.3 * Math.sin(now / 220)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // 未点亮：紫色空芯圆 + 中心点缀，提示"可击打点亮"
            ctx.strokeStyle = '#6a4a9c';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(193, 123, 255, 0.35)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/**
 * 绘制两块挡板：台面阴影 + 透视投影后的圆头粗线本体（纯色青色霓虹辉光，非渐变）+ 尖端高亮 + 轴点
 */
function drawFlippers() {
    for (const f of flippers) {
        const tip = flipperTip(f);
        const a = project(f.ax, f.ay), b = project(tip.x, tip.y);
        const lw = 11 * project((f.ax + tip.x) / 2, (f.ay + tip.y) / 2).s;
        // 台面阴影
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + 4);
        ctx.lineTo(b.x, b.y + 4);
        ctx.stroke();
        // 本体发光
        ctx.shadowColor = '#35e0ff';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#35e0ff';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // 击球发光描边：大力击球瞬间边缘白色发光，随剩余时长线性渐隐（glow 由碰撞逻辑置位）
        if (f.glow > 0) {
            const glowK = Math.max(0, f.glow / FLIP_GLOW_TIME); // 1 → 0 线性渐隐系数
            ctx.strokeStyle = `rgba(255, 255, 255, ${glowK * 0.9})`;
            ctx.lineWidth = lw + 4;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        // 尖端高亮
        ctx.strokeStyle = 'rgba(230, 255, 255, 0.85)';
        ctx.lineWidth = lw * 0.4;
        ctx.beginPath();
        ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // 轴点
        ctx.fillStyle = '#e8e8ff';
        ctx.beginPath();
        ctx.arc(a.x, a.y, lw * 0.28, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 绘制单颗弹球：椭圆投影阴影（体现悬浮感）+ 金属径向渐变球体 + 高光点；
 * ready 状态在球下方画闪烁下落箭头提示发射（多球时每球各带一份阴影与渐变）
 * @param {number} now 当前帧时间戳（毫秒）
 * @param {{x:number,y:number,vx:number,vy:number,trail:Array}} b 待绘制的弹球对象
 */
function drawBall(now, b) {
    const p = project(b.x, b.y);
    const r = BALL_R * p.s;
    // 台面投影阴影（向下偏移，模拟球悬浮在台面上方）
    const sp = project(b.x, b.y + 10);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y, r * 1.1, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 球体径向渐变：正常时金属质感；失球坠落时"烧红"（白热高光 → 橙红 → 暗红余烬）
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.15, p.x, p.y, r);
    if (state === 'lost') {
        g.addColorStop(0, '#ffd0b0');
        g.addColorStop(0.35, '#ff7a5a');
        g.addColorStop(0.75, '#c03028');
        g.addColorStop(1, '#5a1010');
    } else {
        // 左上高光 → 灰蓝 → 暗边的金属质感
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.35, '#cfd4e8');
        g.addColorStop(0.75, '#6a7090');
        g.addColorStop(1, '#2c2f45');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 高光点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(p.x - r * 0.35, p.y - r * 0.35, Math.max(1, r * 0.18), 0, Math.PI * 2);
    ctx.fill();
    // ready 提示：球下方闪烁的向下箭头
    if (state === 'ready') {
        ctx.globalAlpha = 0.45 + 0.45 * Math.sin(now / 180);
        ctx.fillStyle = '#35e0ff';
        ctx.beginPath();
        const ay = p.y + r + 10;
        ctx.moveTo(p.x - 7, ay);
        ctx.lineTo(p.x + 7, ay);
        ctx.lineTo(p.x, ay + 9);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

/**
 * 绘制得分飘字：随生命进度上浮 + 渐隐，字号随透视缩放
 */
function drawFloatTexts() {
    ctx.textAlign = 'center';
    for (const ft of floatTexts) {
        const p = project(ft.x, ft.y - ft.t * 34);
        ctx.font = `${Math.round(13 * p.s)}px 'Press Start 2P', monospace`;
        ctx.fillStyle = `rgba(255, 210, 62, ${1 - ft.t})`;
        ctx.fillText(ft.txt, p.x, p.y);
    }
}

/**
 * 绘制失球演出特效：深渊红色冲击波扩散环 + 全屏红色警报闪烁 +
 * "BALL LOST" 提示文字（上浮渐隐）。在震动偏移复位后调用，保证特效层稳定
 */
function drawLoseFx() {
    const k = loseTimer / LOST_FX_TIME; // 演出进度 0 → 1
    // 深渊冲击波（双环）：主环粗亮 + 副环延迟跟进，双层扩散增强冲击纵深
    const c = project(WORLD_W / 2, WORLD_H);
    // 主环：前 60% 演出期扩散完毕（粗线、高不透明度）
    if (k < 0.6) {
        const kr = k / 0.6;                          // 主环扩散进度 0 → 1
        const rr = 30 + kr * 130;                    // 扩散半径
        ctx.strokeStyle = `rgba(255, 60, 60, ${(1 - kr) * 0.8})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr, rr * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    // 副环：延迟 15% 演出期启动，半径更小、线更细、更透明，形成错落层次
    if (k >= 0.15 && k < 0.75) {
        const kr2 = (k - 0.15) / 0.6;                // 副环扩散进度 0 → 1
        const rr2 = 20 + kr2 * 90;                   // 扩散半径
        ctx.strokeStyle = `rgba(255, 90, 90, ${(1 - kr2) * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr2, rr2 * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    // 台面红色警报：正弦闪烁两下并随进度整体渐隐
    const flash = Math.max(0, Math.sin(k * Math.PI * 4)) * (1 - k);
    if (flash > 0.01) {
        ctx.fillStyle = `rgba(255, 40, 40, ${flash * 0.16})`;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // 失球提示：像素风红色大字，上浮渐隐
    if (k < 0.85) {
        ctx.globalAlpha = 1 - k / 0.85;
        ctx.font = "22px 'Press Start 2P', monospace";
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff5a5a';
        ctx.shadowColor = '#ff3e3e';
        ctx.shadowBlur = 14;
        // 文字随机抖动：失球瞬间抖得厉害，随演出进度逐渐安定
        const jx = (Math.random() - 0.5) * 4 * (1 - k);
        const jy = (Math.random() - 0.5) * 4 * (1 - k);
        ctx.fillText('BALL LOST', VIEW_CX + jx, VIEW_H / 2 - 40 - k * 26 + jy);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }
}

/**
 * 绘制一帧完整画面（按台面（静态层贴回+弹射器）→ 灯 → 弹柱 → 目标灯 → 挡板 → 球（含拖尾残影）→ 特效 → 飘字顺序）；
 * 失球演出期间整体画面随机震动（振幅随进度衰减），警报/大字/飘字层在震动偏移复位后绘制保持稳定，火花刻意跟随震动；
 * 减少动态偏好时跳过两类画面震动（静态视觉如球阴影/目标灯不受影响）
 * @param {number} now 当前帧时间戳（毫秒）
 */
function draw(now) {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    // 失球演出：画面震动（振幅 7px 起线性衰减，前半程结束）
    let shook = false;
    if (state === 'lost' && !FX.prefersReduced) {
        const amp = Math.max(0, 1 - (loseTimer / LOST_FX_TIME) * 2.2) * 7;
        if (amp > 0.3) {
            ctx.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
            shook = true;
        }
    }
    // 挡板大力击球：画面轻微震颤（幅度随剩余时长衰减，短促有力）
    if (hitShake > 0 && !FX.prefersReduced) {
        const amp2 = hitShake * 30;
        ctx.translate((Math.random() - 0.5) * 2 * amp2, (Math.random() - 0.5) * 2 * amp2);
        shook = true;
    }
    drawTable();
    drawLamps(now);
    drawBumpers(now);
    drawTargets(now);
    drawFlippers();
    // 多球渲染：逐球绘制拖尾残影与球体（每球独立阴影/渐变），失球演出期改绘坠落球
    for (const b of balls) {
        drawTrail(b.trail);
        drawBall(now, b);
    }
    if (state === 'lost' && lostBall) drawBall(now, lostBall);
    // 蓄力发射充能环：ready 按住空格时围绕首发球绘制进度弧（青色充能 → 满力金色加粗）
    const chargeBall = balls[0];
    if (state === 'ready' && charging && chargeBall) {
        const cp = project(chargeBall.x, chargeBall.y);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, BALL_R * cp.s + 7, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
        ctx.strokeStyle = charge >= 1 ? '#ffd23e' : '#7ef3ff';
        ctx.lineWidth = charge >= 1 ? 4 : 3;
        ctx.globalAlpha = 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    // 命中火花（世界坐标）：绘制在震动偏移复位之前，跟随台面抖动（池活跃区遍历）
    for (let i = 0; i < sparkPool.n; i++) {
        const p = sparkPool.items[i];
        const sp = project(p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        const s = p.size * sp.s;
        ctx.fillRect(sp.x - s / 2, sp.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    if (shook) ctx.setTransform(viewDpr, 0, 0, viewDpr, 0, 0); // 复位震动偏移（按 DPR 恢复预缩放变换），警报/文字层不跟随抖动
    if (state === 'lost') drawLoseFx();
    drawFloatTexts();
    // 连击倍率 HUD：倍率 >1 时在画布顶部留白带常驻显示 ×N 与窗口剩余进度条
    // （震动复位后绘制，不跟随抖动；窗口将尽时文字变亮、进度条缩短提示即将断连）
    if (comboMult > 1 && state === 'play') {
        const ratio = Math.max(0, comboTimer / COMBO_WINDOW);
        const full = comboMult >= COMBO_MAX_MULT; // 满级转红色示警"已封顶"
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 15px system-ui, sans-serif';
        ctx.fillStyle = full ? '#ff5a5a' : '#ffd23e';
        ctx.globalAlpha = 0.8 + 0.2 * ratio;
        ctx.fillText('COMBO ×' + comboMult, VIEW_CX, 18);
        // 窗口进度条：宽度随剩余时间线性缩短
        const barW = 64;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(VIEW_CX - barW / 2, 29, barW, 3);
        ctx.fillStyle = full ? '#ff5a5a' : '#7ef3ff';
        ctx.fillRect(VIEW_CX - barW / 2, 29, barW * ratio, 3);
        ctx.globalAlpha = 1;
    }
    // JACKPOT 金色大字演出：在最上层绘制放大渐隐的 JACKPOT 字样
    if (jackpotFxTimer > 0) drawJackpotFx();
}

/**
 * 绘制球拖尾残影：越旧的采样点越小越透明，营造高速运动轨迹（每球独立调用）
 * @param {Array<{x:number,y:number}>} trail 该球的拖尾采样点数组（最新点在末尾）
 */
function drawTrail(trail) {
    for (let i = 0; i < trail.length; i++) {
        const k = (i + 1) / trail.length;    // 旧点 0+ → 新点 1
        const tp = project(trail[i].x, trail[i].y);
        ctx.globalAlpha = k * 0.25;
        ctx.fillStyle = '#9db8ff';
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, BALL_R * tp.s * (0.3 + 0.5 * k), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/**
 * 绘制 JACKPOT 金色大字演出：画布中央放大 + 淡出（前 30% 进度保持全不透明，之后线性淡出）；
 * 减少动态偏好时跳过放大，仅保留淡出
 */
function drawJackpotFx() {
    const k = 1 - jackpotFxTimer / JACKPOT_FX_TIME; // 演出进度 0 → 1
    const scale = FX.prefersReduced ? 1 : 1 + k * 0.9; // 减少动态偏好：不放大只淡出
    ctx.save();
    ctx.translate(VIEW_CX, VIEW_H / 2 - 30);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, (1 - k) * 1.4);
    ctx.font = "34px 'Press Start 2P', monospace";
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd23e';
    ctx.shadowColor = '#ff9a3e';
    ctx.shadowBlur = 22;
    ctx.fillText('JACKPOT', 0, 0);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.restore();
}

/* ===================== 侧栏：剩余球数 ===================== */

/**
 * 绘制侧栏 BALLS 面板：按剩余球数绘制金属小球图标
 */
function drawBalls() {
    ballsCtx.clearRect(0, 0, ballsCanvas.width, ballsCanvas.height);
    for (let i = 0; i < lives; i++) {
        const cx = 25 + i * 34, cy = 18, r = 9;
        const g = ballsCtx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.15, cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.4, '#cfd4e8');
        g.addColorStop(1, '#4a4f6b');
        ballsCtx.fillStyle = g;
        ballsCtx.beginPath();
        ballsCtx.arc(cx, cy, r, 0, Math.PI * 2);
        ballsCtx.fill();
    }
}

/* ===================== 主循环与输入 ===================== */

/**
 * 游戏主循环（rAF 驱动，固定步长物理）：顿帧冻结期间仅重绘；
 * 进行中且未暂停时把帧时长拆解为固定 1/120 秒物理步推进（单帧最多 5 步防"追帧螺旋"，
 * 不同刷新率下手感一致并缓解高速穿透），拖尾采样与火花/飘字仍按帧时长更新；
 * 失球演出期间球坠落 + 火花余韵照常；成就墙打开期间同样只重绘（局面冻结，与暂停互不影响）；
 * 每帧重绘；帧时长上限 33ms 防止切回窗口时的大步长穿透
 * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
 */
function loop(t) {
    // 顿帧短路：FX.hitstop 冻结期间跳过全部更新只重绘，保持大奖演出的冲击感
    if (FX.frozen()) {
        draw(t);
        requestAnimationFrame(loop);
        return;
    }
    const dt = Math.min((t - lastTime) / 1000, 0.033);
    lastTime = t;
    if (!isPaused && !achPanelOpen && (state === 'play' || state === 'ready')) {
        // 固定步长物理：帧时长累加进累加器（封顶 MAX_STEPS_PER_FRAME 步，卡顿时丢弃多余时间），
        // 按整数个 FIXED_DT 步推进挡板/计时器/蓄力/物理
        accumulator = Math.min(accumulator + dt, FIXED_DT * MAX_STEPS_PER_FRAME);
        while (accumulator >= FIXED_DT) {
            accumulator -= FIXED_DT;
            updateFlippers(FIXED_DT);
            updateTimers(FIXED_DT);
            if (state === 'ready' && charging) {
                charge = Math.min(1, charge + FIXED_DT / CHARGE_TIME); // 蓄力进度按物理步推进，1 为满力
                // 蓄力充电音：每 80ms 播放一次，音调随蓄力进度（0~1）爬升
                const nowMs = performance.now();
                if (nowMs - lastChargeSfx >= CHARGE_SFX_INTERVAL) {
                    lastChargeSfx = nowMs;
                    SFX.pinCharge(charge);
                }
            }
            if (state === 'play') {
                updatePhysics(FIXED_DT);
                if (state === 'lost') break; // 物理步内触发失球演出时立即退出步进循环
            }
        }
        if (state === 'play') {
            // 球拖尾采样保持每帧一次（不随物理步加密）：每球独立采样，最多保留 TRAIL_MAX 点
            for (const b of balls) {
                b.trail.push({ x: b.x, y: b.y });
                if (b.trail.length > TRAIL_MAX) b.trail.shift();
            }
        }
        updateSparks(dt);
        updateFloatTexts(dt);
    } else if (state === 'lost' && !achPanelOpen) {
        // 失球演出：球坠落 + 特效计时 + 火花余韵，结束后自动回待发射或结算（成就墙打开期间冻结不推进）
        updateLoseFx(dt);
        updateTimers(dt);
        updateSparks(dt);
        updateFloatTexts(dt);
    }
    draw(t);
    requestAnimationFrame(loop);
}

/**
 * 全局键盘控制：
 * ← / A 拍左挡板，→ / D 拍右挡板（keydown 按下 / keyup 松开）；
 * 空格在 ready 状态按住蓄力、松开发射（力度决定初速），play 状态切换暂停；
 * P 键切换暂停；V 键开关成就墙（全站统一开墙键：V），Esc 关闭成就墙；
 * 成就墙打开期间吞掉其余按键（墙面已冻结局面，防止墙体遮挡下的游戏误输入）；
 * 方向键与空格均阻止页面滚动
 * @param {KeyboardEvent} event 键盘事件
 */
document.addEventListener('keydown', (event) => {
    // 成就墙打开期间：仅 V / Esc 可关闭墙面（preventDefault + !event.repeat 防长按连发），其余按键一律吞掉
    if (achPanelOpen) {
        if (event.code === 'KeyV' || event.code === 'Escape') {
            event.preventDefault();
            if (!event.repeat) toggleAchPanel();
        }
        return;
    }
    switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
            event.preventDefault();
            flippers[0].pressed = true;
            if (!event.repeat) { SFX.pan(-0.5); SFX.pinFlip(); } // 左挡板：左声道拍击音（长按不重复播音）
            break;
        case 'ArrowRight':
        case 'KeyD':
            event.preventDefault();
            flippers[1].pressed = true;
            if (!event.repeat) { SFX.pan(0.5); SFX.pinFlip(); } // 右挡板：右声道拍击音（长按不重复播音）
            break;
        case 'Space':
            event.preventDefault();
            if (state === 'ready' && !isPaused) {
                // 按住空格开始蓄力（!event.repeat 防长按重复触发），松开后由 keyup 发射
                if (!event.repeat && !charging) {
                    charging = true;
                    charge = 0;
                    lastChargeSfx = 0; // 新一轮蓄力：重置充电音节流时间戳，首声立即播放
                }
            } else if (state === 'play') {
                if (!event.repeat) togglePause(); // 防长按连发：系统按键重复率下反复切换暂停
            }
            break;
        case 'KeyP':
            if (!event.repeat) togglePause(); // 防长按连发
            break;
        case 'KeyV':
            if (!event.repeat) toggleAchPanel(); // 成就墙开关（全站统一开墙键：V；Esc 亦可关闭）
            break;
    }
});

/**
 * 键盘抬起：松开对应挡板（挡板以固定角速度逼近目标角，拍击力度由碰撞瞬间的角速度差分天然决定，无需在此显式处理）
 * @param {KeyboardEvent} event 键盘事件
 */
document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
            flippers[0].pressed = false;
            break;
        case 'ArrowRight':
        case 'KeyD':
            flippers[1].pressed = false;
            break;
        case 'Space':
            // 松开空格：按蓄力力度发射（未蓄力或非 ready 状态仅复位蓄力标记）
            if (charging && state === 'ready' && !isPaused && !achPanelOpen) launch(charge); // 成就墙打开时不发射（开墙瞬间的残留蓄力在此兜底失效）
            charging = false;
            charge = 0;
            break;
    }
});

/* ===================== 触屏分区控制 ===================== */

/**
 * 触屏拉杆区顶界（画布 CSS 逻辑坐标 y）：底部 70px 条带专管蓄力发射。
 * 取 590 为挡板尖端最低投影（加长挡板约 578）留出按压余量，避免按挡板尖端误触蓄力
 */
const PLUNGER_ZONE_Y = 590;

/**
 * 多点触控分区表：pointerId → 分区名（'left' / 'right' / 'plunger'）。
 * 采用「按下锁定分区、松手才复位」策略（不监听 pointermove 跨区切换）：手指按住时难免
 * 轻微漂移，实时跨区翻转会造成挡板误抬/误拍（左指滑过中线瞬间左板抬起右板拍下），
 * 锁定式手感更稳，多指同时按住左右挡板互不干扰；拉杆区非蓄力起手不入表，杜绝第二根
 * 手指抢先松开误发射
 * @type {Map<number, string>}
 */
const touchZones = new Map();

/**
 * 判定画布 CSS 逻辑坐标所属触屏分区：底部条带为拉杆区，其余按竖直中线划分左右挡板区
 * @param {number} x 画布 CSS 逻辑坐标 x（0~500，画布 CSS 尺寸固定无缩放变形，偏移即坐标）
 * @param {number} y 画布 CSS 逻辑坐标 y（0~660）
 * @returns {string} 'left' 左挡板区 / 'right' 右挡板区 / 'plunger' 拉杆蓄力区
 */
function zoneAt(x, y) {
    if (y >= PLUNGER_ZONE_Y) return 'plunger';
    return x < VIEW_CX ? 'left' : 'right';
}

/**
 * 检查指定分区是否仍被其它按住中的指针占据（多指同区容错：
 * 一指抬起时只要还有同区手指按住就不复位挡板，避免"还按着却松开"的错感）
 * @param {string} zone 分区名（'left' / 'right' / 'plunger'）
 * @returns {boolean} 是否仍有指针按住该分区
 */
function zoneHeld(zone) {
    for (const z of touchZones.values()) {
        if (z === zone) return true;
    }
    return false;
}

/**
 * 触屏分区按下：直接置位键盘 keydown 分支维护的同一批内部状态（复用不派发合成键盘事件）——
 * 左/右分区置位挡板按下态并播拍击音（与键盘一致无状态守卫，物理循环仅在 play/ready 未暂停时推进）；
 * 拉杆分区仅在 ready 且未暂停且未蓄力时开始蓄力（与空格 keydown 分支同款守卫与置位）
 * @param {PointerEvent} event 指针按下事件
 */
function handleZoneDown(event) {
    if (event.pointerType === 'mouse') return; // 桌面鼠标零改动：仅触屏/手写笔启用分区
    event.preventDefault(); // 抑制触屏默认手势（touch-action:none 之外的兜底，如长按菜单）
    canvas.setPointerCapture(event.pointerId); // 后续抬起/取消即使移出画布也必送达，保证按下态必被复位
    const rect = canvas.getBoundingClientRect();
    const zone = zoneAt(event.clientX - rect.left, event.clientY - rect.top);
    if (zone === 'plunger' && !(state === 'ready' && !isPaused && !charging)) {
        return; // 拉杆区非蓄力起手（play 中点按 / 重复起手）：不入跟踪表，其抬起不会误发射
    }
    touchZones.set(event.pointerId, zone);
    if (zone === 'left') {
        flippers[0].pressed = true;
        SFX.pan(-0.5); // 左挡板：左声道拍击音
        SFX.pinFlip(); // 等效键盘 keydown 的单次拍击音
    } else if (zone === 'right') {
        flippers[1].pressed = true;
        SFX.pan(0.5); // 右挡板：右声道拍击音
        SFX.pinFlip();
    } else {
        // 与空格 keydown 分支一致：按住蓄力、松手发射；!charging 守卫保证重复起手不重置蓄力进度
        charging = true;
        charge = 0;
        lastChargeSfx = 0; // 新一轮蓄力：重置充电音节流时间戳，首声立即播放
    }
}

/**
 * 触屏分区抬起/系统取消：等效对应 keyup 分支复位——
 * 左/右分区在无其它同区手指时抬起挡板；拉杆分区按蓄力力度发射（守卫与空格 keyup 分支完全一致）
 * @param {PointerEvent} event 指针抬起或取消事件
 */
function handleZoneUp(event) {
    const zone = touchZones.get(event.pointerId);
    if (!zone) return; // 未跟踪的指针（遮罩面板上起手 / 拉杆区非蓄力起手）：忽略
    touchZones.delete(event.pointerId);
    if (zone === 'left') {
        if (!zoneHeld('left')) flippers[0].pressed = false;
    } else if (zone === 'right') {
        if (!zoneHeld('right')) flippers[1].pressed = false;
    } else {
        // 与空格 keyup 分支一致：按蓄力力度发射，守卫不满足则仅复位蓄力标记
        if (charging && state === 'ready' && !isPaused) launch(charge);
        charging = false;
        charge = 0;
    }
}

// 分区监听挂在画布上：开始/暂停/结束遮罩是画布的兄弟节点（非其后代），面板上的起手不会
// 进入画布监听（天然排除 UI，无 bee 先例的 document 级监听误触问题）；
// 暂停恢复走键盘 P 与暂停遮罩点击（见下方 pauseScreen 监听）
canvas.addEventListener('pointerdown', handleZoneDown);
canvas.addEventListener('pointerup', handleZoneUp);
canvas.addEventListener('pointercancel', handleZoneUp);

// 暂停遮罩点击恢复：面板悬浮于画布之上会拦截 pointerdown（不再落到画布分区监听），
// 点击面板空白处即恢复（空格/失焦自动暂停弹出的遮罩共用同一 DOM，同样适用）；
// 点在遮罩内按钮/链接上（如返回大厅）只操作 UI 不恢复——与 bee.js 先例一致，
// 防止暂停中点链接先误恢复运行、快照存成运行态再退出
pauseScreen.addEventListener('pointerdown', e => {
    if (e.target.closest('button, a')) return; // 按钮/链接交给自身逻辑，不作为恢复输入
    togglePause(); // 恢复并撤下遮罩（BGM 续播、恢复音、提示行清理均走 togglePause 分支）
});

// 切出窗口时自动暂停，避免回来时球已落底白白损失；同时取消未完成的蓄力防状态卡死
window.addEventListener('blur', () => {
    charging = false;
    charge = 0;
    // 清空挡板按下态：切窗期间系统不会补发 keyup，不清则回来后挡板无键自抬（卡键）
    for (const f of flippers) f.pressed = false;
    // 触屏按下态并入同一处清理：跟踪表残留会使回窗后的抬手指误复位/误发射（挡板/蓄力实体态已在上两行复位）
    touchZones.clear();
    if ((state === 'play' || state === 'ready') && !isPaused && !achPanelOpen) togglePause(); // 成就墙已冻结局面：不再叠加暂停遮罩
});

/* ===================== 初始化 ===================== */

// 难度恢复：页面加载时保持与上一次选择一致（默认中等，序号 2；
// 按钮序号：无敌 0 / 简单 1 / 中等 2 / 困难 3，存档记录的即该序号；
// 加载时 AudioContext 尚未激活，selectDifficulty 中的 uiClick 无声，无害；
// 恢复会触发 rebuildFlippers 重建挡板与侧栏倍率刷新，加载时机安全）
let savedDifficultyIndex = NaN; // 存储不可用（隐私模式/禁用站点数据）时兜底 NaN，按默认难度处理
try {
    savedDifficultyIndex = parseInt(localStorage.getItem(DIFFICULTY_KEY), 10);
} catch (e) { /* 存储不可用：静默保持兜底，不中断初始化 */ }
if (!Number.isNaN(savedDifficultyIndex) && savedDifficultyIndex !== 2) {
    const savedDifficultyBtn = document.querySelectorAll('.difficulty-btn')[savedDifficultyIndex];
    if (savedDifficultyBtn) selectDifficulty(savedDifficultyBtn);
}

// 恢复最高分与倍率显示，绘制初始球数，注册窗口/全屏监听，启动主循环
// （成就墙初始渲染由打开墙面时的 renderAchWall 按需完成，启动时无需预渲染）
highElement.textContent = highScore;
multElement.textContent = '×' + mult;
drawBalls();

// 进度快照恢复：位于核心状态创建之后、默认新局逻辑（开始按钮触发的新局）之前。
// 恢复成功则停回暂停遮罩等待玩家按 P / 空格继续（不立即开跑），
// 失败或无快照则维持默认新局（开始遮罩 + 初始待发射球）不变
restoreSnapshot();

// ---------- CRT 开关机音效双监听：覆盖独立打开与 iframe 嵌入两条全屏路径 ----------
let embedFsLast = null; // iframe 嵌入模式下最近一次全屏状态（null = 尚未同步，首条消息静默）

// 独立打开模式：监听文档全屏切换，进全屏播开机音、退出播关机音
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});

// iframe 嵌入模式：父页面通过 postMessage 广播全屏状态（arcade:exit 为返回大厅请求）
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
        saveSnapshot(); // 父页关闭 iframe 覆盖层前下发：保存当前局进度快照
    } else if (d.type === 'arcade:exit') {
        SFX.crtOff(); // 返回游戏厅：CRT 关机音
    }
});

// 窗口尺寸变化：按最新 DPR 重建画布物理分辨率并同步 viewDpr（FX.setupCanvas 重复调用安全）
window.addEventListener('resize', () => {
    const v = FX.setupCanvas(canvas, 2);
    viewDpr = v.dpr;
    tableLayerDirty = true; // 画布物理分辨率/DPR 已变：下一帧重建台面静态层
});

// 左上角"← 游戏厅"返回链接：跳转前先保存当前局进度快照（不拦截默认导航，saveSnapshot 内部自判状态）
document.querySelector('.back-link').addEventListener('click', () => {
    saveSnapshot();
});

// 页面隐藏 / 关闭（含返回大厅导航、刷新、关标签）：saveSnapshot 内部自判——
// 进行中或暂停中写入快照，未开始 / 已结束界面则清除过期快照
window.addEventListener('pagehide', () => {
    saveSnapshot();
});

requestAnimationFrame(loop);

// 游玩时长统计上报（返回大厅/关页时结算）+ 键帽实时高亮（按住时点亮说明面板键帽）
FX.playtime.init('pinball');
FX.KeyLight.init();
