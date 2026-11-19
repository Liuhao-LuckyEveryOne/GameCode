/* ======================================================================
 * 小蜜蜂 (BEE) —— 像素街机厅游戏逻辑（完整版）
 * 480×560 画布 · Galaxian 类固定射击
 * 核心机制：
 *   - 蜂群：8×4 网格横移、碰壁下压；混编精英蜂（2 血、30 分）
 *   - 蜂种：分裂蜂（击落后裂出两只小蛋蜂）、自爆蜂（俯冲贴近玩家
 *           引爆环形弹幕）
 *   - 事件波：第 3 波起概率触发俯冲潮（俯冲频率大增）或精英阵（全员精英）
 *   - 冲刺：Shift 瞬身冲刺，冲刺中无敌并留下残影，冷却限制使用频率
 *   - 俯冲：蜜蜂随机脱离队形，加速曲线俯冲并沿途投弹，冲出屏幕后
 *           从顶部归队（归队途中不参与碰壁边界统计，但仍参与触底判定）
 *   - Boss：每 5 波遭遇 Boss（正弦游走 + 瞄准弹 + 扇形弹幕），
 *           顶部血条，击败获得高额奖励并掉落道具
 *   - 道具：击落概率掉落 7 种 —— 火力升级（单发→双发→三向）、护盾（挡
 *           1 次）、1UP、炸弹（全屏清弹+范围伤害）、时停（冻结敌阵数秒）、
 *           磁铁（吸引场上道具）、激光（持续贯穿光柱）；落出屏幕即消失
 *   - 成就：10 项成就跨局持久化，解锁弹出横幅，按 V 查看成就面板
 *   - 连击：连续击杀积累连击数，每 5 连击提升得分倍率（最高 ×5），
 *           连击窗口超时或玩家受击即清零
 *   - 奖励：每 10000 分奖励 1 条命（上限 5）；清波按波次给分，
 *           本波未掉命再获"完美防御"加分
 *   - 打击感：击杀/受击粒子爆裂、得分飘字、命中顿帧、屏幕震动、
 *           引擎尾焰、受击红闪、三层视差星空、清波敌弹星尘
 *   - Boss 强化：三段式入场演出（警告横幅鸣响 → 缓降引擎尾焰 → 落地冲击震屏）、
 *           受击闪白、低血狂暴（变红+弹幕加速）、击败后连环殉爆
 *   - 状态提示：WAVE 开场横幅、连击倍率角标、倍率提升金色脉冲、
 *           濒死红色呼吸边框；冲刺就绪/蜂群下压/低命警报等提示音
 *   - 难度：开始画面四档可选（无敌/简单/普通/困难），影响初始生命、弹速、
 *           开火/俯冲频率、蜂群速度与 Boss 血量；选择持久化至 localStorage
 *   - 全屏：右上角按钮经公共库 fullscreen.js 切换全屏并等比缩放游戏区域
 * 渲染架构：requestAnimationFrame 单循环，按 dt 推进逻辑与绘制；
 *          顿帧期间冻结逻辑但仍渲染（震动/粒子暂存）
 * 依赖：audio.js 提供的全局音效库 SFX / fx.js 提供的全局特效库 FX
 * ==================================================================== */

/* ===================== 游戏常量 ===================== */

/**
 * localStorage 存档键集中定义（单点维护）：键名与游戏厅大厅及历史存档约定一致，
 * 改名即弃档，勿随意变动；全部键名字面量仅在此处出现
 */
const KEYS = {
    difficulty: 'beeDifficulty', // 上次选择的难度
    highScore: 'beeHighScore', // 历史最高分
    achievements: 'arcade_ach_bee', // 成就数据（与项目其余游戏统一 arcade_ach_* 前缀）
    achievementsLegacy: 'beeAchievements', // 旧版成就键：读取时回退并一次性迁移到新键
    save: 'arcade_save_bee' // 进度镜像快照（与游戏厅父页约定的命名）
};

/** 玩家飞船尺寸（像素） */
const PLAYER_W = 34;
/** 玩家飞船尺寸（像素） */
const PLAYER_H = 26;
/** 玩家水平移动速度（像素/秒） */
const PLAYER_SPEED = 280;
/** 鼠标等效按键保持秒数：一次主动移动产生的等效方向在该时长内持续生效，期间无新移动则归零（模拟松键） */
const MOUSE_DIR_HOLD = 0.15;
/** 玩家子弹上升速度（像素/秒） */
const BULLET_SPEED = 520;
/** 三向散射斜射弹的水平分速度（像素/秒） */
const SPREAD_VX = 170;
/** 敌方子弹基础下落速度（像素/秒，随波次微增） */
const ENEMY_BULLET_SPEED = 200;
/** 玩家射击最小间隔（秒），防止按住空格连成弹幕 */
const FIRE_COOLDOWN = 0.32;
/** 蜂群水平移动速度（像素/秒，基础值，随波次递增） */
const SWARM_SPEED = 60;
/** 蜂群碰壁后整体下压距离（像素） */
const SWARM_DESCEND = 18;
/** 蜂群横向间隔（像素） */
const BEE_GAP_X = 46;
/** 蜂群纵向间隔（像素） */
const BEE_GAP_Y = 40;
/** 蜂群列数 */
const BEE_COLS = 8;
/** 蜂群行数 */
const BEE_ROWS = 4;
/** 单只蜜蜂尺寸（像素） */
const BEE_W = 28;
/** 单只蜜蜂尺寸（像素） */
const BEE_H = 22;
/** 精英蜂在蜂群中的出现概率 */
const ELITE_CHANCE = 0.15;
/** 普通蜜蜂基础得分 */
const BEE_POINTS = 10;
/** 精英蜂基础得分 */
const ELITE_POINTS = 30;
/** 分裂蜂出现概率 */
const SPLITTER_CHANCE = 0.1;
/** 分裂蜂基础得分 */
const SPLITTER_POINTS = 15;
/** 分裂蜂死后裂出的小蛋蜂数量 */
const MINI_COUNT = 2;
/** 小蛋蜂尺寸（像素） */
const MINI_W = 18;
/** 小蛋蜂尺寸（像素） */
const MINI_H = 14;
/** 小蛋蜂基础得分 */
const MINI_POINTS = 5;
/** 小蛋蜂裂出时的初始俯冲速度（像素/秒） */
const MINI_DIVE_VY = 200;
/** 小蛋蜂裂出时的水平分离速度（像素/秒） */
const MINI_SPLIT_VX = 120;
/** 自爆蜂出现概率 */
const BOMBER_CHANCE = 0.08;
/** 自爆蜂基础得分 */
const BOMBER_POINTS = 20;
/** 自爆蜂俯冲速度倍率（比普通俯冲更快） */
const BOMBER_DIVE_MULT = 1.35;
/** 自爆蜂引爆时发射的环形弹数 */
const BOMBER_BULLETS = 6;
/** 自爆蜂引爆时环形弹的飞行速度（像素/秒） */
const BOMBER_BULLET_SPEED = 150;
/** 自爆蜂俯冲时贴近玩家引爆的距离阈值（像素） */
const BOMBER_FUSE_DIST = 90;
/** 事件波最早可能出现的波次 */
const EVENT_WAVE_MIN = 3;
/** 事件波触发概率 */
const EVENT_CHANCE = 0.3;
/** 俯冲潮事件下俯冲间隔的缩短倍率 */
const TIDE_DIVE_MULT = 0.4;
/** 生命上限（道具 1UP 与里程碑奖励均受此限制） */
const MAX_LIVES = 5;
/** 玩家被击中后的无敌时长（秒），期间闪烁且免疫伤害 */
const RESPAWN_INVINCIBLE = 2;
/** 蜂群两次投放子弹的基准间隔（秒），随机系数在其一半到一点五倍间，整体另随波次与难度缩短 */
const ENEMY_FIRE_INTERVAL = 1.4;
/** 俯冲触发基准间隔（秒），实际间隔随波次缩短 */
const DIVE_INTERVAL = 3.4;
/** 俯冲初始下落速度（像素/秒） */
const DIVE_START_VY = 140;
/** 俯冲下落加速度（像素/秒²） */
const DIVE_ACCEL = 300;
/** 俯冲水平转向加速度（像素/秒²），用于轻微追踪玩家 */
const DIVE_HOMING = 260;
/** 俯冲水平速度上限（像素/秒） */
const DIVE_VX_MAX = 200;
/** 俯冲投弹的两个高度阈值（像素） */
const DIVE_DROP_YS = [170, 330];
/** 俯冲蜜蜂冲出屏幕后从顶部归队的速度（像素/秒） */
const RETURN_SPEED = 170;
/** Boss 尺寸（像素） */
const BOSS_W = 76;
/** Boss 尺寸（像素） */
const BOSS_H = 52;
/** Boss 基础血量（随波次线性增长） */
const BOSS_BASE_HP = 28;
/** Boss 每波额外血量 */
const BOSS_HP_PER_WAVE = 4;
/** Boss 被击败的基础奖励分 */
const BOSS_BONUS = 500;
/** Boss 每波额外奖励分 */
const BOSS_BONUS_PER_WAVE = 50;
/** Boss 扇形弹幕间隔（秒，随波次缩短） */
const BOSS_FAN_INTERVAL = 2.0;
/** Boss 瞄准单发间隔（秒） */
const BOSS_AIM_INTERVAL = 1.1;
/** Boss 扇形弹幕的发数 */
const BOSS_FAN_COUNT = 5;
/** Boss 扇形弹幕总张角（弧度） */
const BOSS_FAN_SPREAD = 0.9;
/** Boss 血条失血白色闪烁的持续时间（秒） */
const BOSS_HURT_FLASH_TIME = 0.12;
/** Boss 入场警告演出时长（秒）：红色警戒横幅与警报鸣响结束后 Boss 才现身入场 */
const BOSS_WARN_TIME = 1.8;
/** Boss 入场缓降速度（像素/秒） */
const BOSS_ENTER_SPEED = 110;
/** Boss 落地冲击震动时长（秒） */
const BOSS_LAND_SHAKE_TIME = 0.3;
/** Boss 落地冲击震动幅度（像素） */
const BOSS_LAND_SHAKE_MAG = 6;
/** Boss 落地冲击顿帧时长（秒） */
const BOSS_LAND_FREEZE = 0.1;
/** Boss 落地冲击激起的尘土粒子数 */
const BOSS_LAND_DUST = 22;
/** Boss 落地冲击环扩散时长（秒） */
const BOSS_SHOCK_TIME = 0.45;
/** 道具击落掉落概率 */
const POWERUP_DROP_CHANCE = 0.09;
/** 道具下落速度（像素/秒） */
const POWERUP_FALL_SPEED = 120;
/** 道具尺寸（像素） */
const POWERUP_SIZE = 20;
/** 道具外观表：类型 → 底色与字母标识（掉落绘制与拾取飘字统一取用） */
const POWERUP_STYLE = {
    weapon: { color: '#35e0ff', label: 'W' },
    shield: { color: '#39ff6a', label: 'S' },
    life: { color: '#ff3ea5', label: '♥' },
    bomb: { color: '#ff5533', label: 'B' },
    freeze: { color: '#b388ff', label: 'T' },
    magnet: { color: '#ffd23e', label: 'M' },
    laser: { color: '#f0f6ff', label: 'L' }
};
/** 炸弹对全场蜜蜂造成的伤害（点数） */
const BOMB_DAMAGE = 2;
/** 炸弹对 Boss 造成的伤害（点数） */
const BOMB_BOSS_DAMAGE = 8;
/** 炸弹全屏白闪持续时长（秒） */
const BOMB_FLASH_TIME = 0.3;
/** 时停道具冻结敌方的时长（秒） */
const FREEZE_DURATION = 4;
/** 磁铁道具持续时长（秒） */
const MAGNET_DURATION = 6;
/** 磁铁吸引半径（像素，超出范围的道具照常下落） */
const MAGNET_RADIUS = 260;
/** 磁铁吸引时道具飞向玩家的速度（像素/秒） */
const MAGNET_PULL_SPEED = 340;
/** 激光道具持续时长（秒） */
const LASER_DURATION = 5;
/** 激光伤害结算间隔（秒） */
const LASER_TICK = 0.08;
/** 激光光柱宽度（像素） */
const LASER_WIDTH = 10;
/** 激光每次结算造成的伤害（点数） */
const LASER_DAMAGE = 1;
/** 连击判定窗口（秒）：窗口内继续击杀则连击延续，超时清零 */
const COMBO_WINDOW = 2.5;
/** 连击倍率上限 */
const COMBO_MAX_MULT = 5;
/** 每积累多少连击数提升一档倍率 */
const COMBO_STEP = 5;
/** 里程碑奖励生命的分数步长 */
const EXTRA_LIFE_STEP = 10000;
/** 粒子重力加速度（像素/秒²），让爆裂碎屑有下坠感 */
const PARTICLE_GRAVITY = 320;
/** 飘字默认存活时长（秒） */
const FLOAT_LIFE = 0.9;
/** 冲刺速度（像素/秒），冲刺期间替代常规移速 */
const DASH_SPEED = 820;
/** 冲刺持续时间（秒），期间免疫伤害 */
const DASH_TIME = 0.16;
/** 冲刺冷却时间（秒），自冲刺发起起计 */
const DASH_COOLDOWN = 1.6;

/* ===================== 难度系统 ===================== */

/** localStorage 存档键：上次选择的难度（字面量统一收口于顶部 KEYS） */
const DIFFICULTY_KEY = KEYS.difficulty;
/**
 * 四档难度参数表：所有难度差异均以乘数/覆盖值在既有计算处应用，不复制逻辑
 * - lives：初始生命（无敌/简单 4 / 普通 3 / 困难 2，上限仍为 MAX_LIVES=5，为 1UP 道具留价值）
 * - bullet：敌方子弹速度乘数
 * - fire：敌方开火间隔除数（越大开火越频繁）
 * - swarm：蜂群基础横移速度乘数
 * - dive：俯冲间隔除数（越大俯冲越频繁）
 * - bossHp：Boss 血量乘数
 */
const DIFFICULTIES = {
    // 无敌档：完全免疫死亡（受击不掉命、蜂群触底不判负）；游玩参数为 easy 当前值的
    // 显式展开副本（两档数值此刻逐字一致，自此解耦），此后各自独立调整互不连带
    invincible: { name: '无敌', lives: 4, bullet: 0.85, fire: 0.7, swarm: 0.85, dive: 0.75, bossHp: 0.8 },
    easy: { name: '简单', lives: 4, bullet: 0.85, fire: 0.7, swarm: 0.85, dive: 0.75, bossHp: 0.8 },
    normal: { name: '普通', lives: 3, bullet: 1, fire: 1, swarm: 1, dive: 1, bossHp: 1 },
    hard: { name: '困难', lives: 2, bullet: 1.15, fire: 1.35, swarm: 1.15, dive: 1.3, bossHp: 1.25 }
};
/** 当前难度 key（启动时从 localStorage 恢复，非法值回退普通） */
let difficulty = Arcade.loadRaw(DIFFICULTY_KEY); // 存储被禁（隐私模式/禁 Cookie）时按未存档处理
if (!DIFFICULTIES[difficulty]) difficulty = 'normal';
/** 当前难度的参数配置（各处计算经它取乘数，避免散落硬编码） */
let diffCfg = DIFFICULTIES[difficulty];

/* ===================== 游戏状态 ===================== */

/** 当前分数 */
let score = 0;
/** 剩余生命数（初始值随难度：无敌/简单 4 / 普通 3 / 困难 2） */
let lives = diffCfg.lives;
/** 当前波次（每清空一波 +1，蜂群随之加速，每 5 波为 Boss 战） */
let wave = 1;
/** 游戏阶段：start（开始画面）/ playing（进行中）/ over（已结束） */
let gameState = 'start';
/** 失焦自动暂停标记：游戏进行中窗口失焦时置真，点击或按任意键恢复 */
let blurPaused = false;
/** 手动暂停标记：按 P 键切换（空格已被射击占用故选 P），与失焦暂停相互独立；
 *  恢复时两种标记一次清空，避免"手动暂停中失焦→回来需恢复两次"的多余操作 */
let paused = false;
/** 玩家飞船左上角坐标 { x, y } */
let player = { x: 0, y: 0 };
/** 玩家子弹数组 { x, y, vx }（x/y 为子弹底部中心即弹尾，vx 为水平分速度） */
const bullets = [];
/** 敌方子弹数组 { x, y, vx, vy }（俯冲投弹直落、Boss 弹带角度） */
const enemyBullets = [];
/**
 * 蜂群数组，每只蜜蜂：{ col, row, type, hp, alive, diving, reenter,
 * x, y, vx, vy, dropped1, dropped2 }
 * 编队位由 col/row 与蜂群偏移推算；diving/reenter 时以自身 x/y 运动
 */
const bees = [];
/** 当前波次的 Boss（null 表示非 Boss 波或已被击败） */
let boss = null;
/** Boss 血条失血白色闪烁剩余时间（秒），>0 时在血量区域叠加白光 */
let bossHurtFlash = 0;
/** Boss 血条渐变缓存（水平渐变，几何仅取决于血条左端 x，血条宽度/配色固定） */
let bossHpGrad = null;
/** 渐变缓存对应的血条左端 x 坐标，与当前 barX 不一致时才重建渐变 */
let bossHpGradX = -1;
/** 当前波次事件类型：null 普通 / 'tide' 俯冲潮 / 'eliteWall' 精英阵 */
let waveEvent = null;
/** 道具数组 { x, y, type }，type ∈ weapon/shield/life/bomb/freeze/magnet/laser */
const powerups = [];
/** 蜂群横移方向：1 向右 / -1 向左 */
let swarmDir = 1;
/** 蜂群当前横移速度（像素/秒，随波次递增） */
let swarmSpeed = SWARM_SPEED;
/** 蜂群横向偏移（像素），编队位 = 基准位 + 偏移 */
let swarmOffsetX = 0;
/** 蜂群累计下压量（像素） */
let swarmDescend = 0;
/** 蜂群编队基准 x（首列基准位，spawnSwarm 时计算） */
let swarmBaseX = 0;
/** 距蜂群下次投放子弹的倒计时（秒） */
let enemyFireTimer = ENEMY_FIRE_INTERVAL;
/** 距下次触发俯冲的倒计时（秒） */
let diveTimer = DIVE_INTERVAL;
/** 距玩家下次可射击的冷却倒计时（秒） */
let fireCooldown = 0;
/** 玩家剩余无敌时间（秒），大于 0 时闪烁且免疫伤害 */
let invincibleTimer = 0;
/** 玩家武器等级：1 单发 / 2 双发 / 3 三向散射 */
let weaponLevel = 1;
/** 是否持有护盾（可抵挡一次伤害） */
let hasShield = false;
/** 时停剩余时间（秒），大于 0 时敌方阵型/弹幕全部冻结且无害 */
let enemyFreezeTimer = 0;
/** 磁铁剩余时间（秒），大于 0 时场上道具被吸向玩家 */
let magnetTimer = 0;
/** 激光剩余时间（秒），大于 0 时持续发射贯穿光柱 */
let laserTimer = 0;
/** 激光伤害结算倒计时（秒），归零按 LASER_TICK 结算一次 */
let laserTickTimer = 0;
/** 炸弹白闪剩余时间（秒），用于全屏白闪特效 */
let bombFlashTimer = 0;
/** 本局是否刷新了历史最高分（结算面板据此显示"新纪录"提示） */
let isNewRecord = false;
/** 历史最高分（localStorage 持久化，键 beeHighScore）；|| 0 兜底脏数据，避免历史存储被污染成非数字时解析出 NaN */
let highScore = 0;
highScore = parseInt(Arcade.loadRaw(KEYS.highScore) || '0', 10) || 0; // 存储被禁时从 0 起算，不阻断页面初始化
/** 当前连击数（COMBO_WINDOW 内连续击杀的次数） */
let comboCount = 0;
/** 连击窗口剩余时间（秒），归零则连击清零 */
let comboTimer = 0;
/** 当前得分倍率（1~5），由连击数推导并缓存，用于检测倍率提升以触发提示音与金色脉冲 */
let comboMult = 1;
/** 下一次里程碑奖励生命所需的分数 */
let nextLifeScore = EXTRA_LIFE_STEP;
/** 本波开始时的生命数，用于"完美防御"判定（随难度初始化） */
let livesAtWaveStart = diffCfg.lives;
/** 按键按下状态表：code → true，用于支持持续按住移动/射击 */
const keys = {};
/** 鼠标等效移动方向：-1 左 / 1 右 / 0 无（由鼠标主动移动脉冲产生，超时或窗口失焦归零） */
let mouseDir = 0;
/** 鼠标等效方向剩余有效秒数：归零时清除 mouseDir（模拟松开按键） */
let mouseDirTimer = 0;
/** 鼠标帧间累计水平位移（movementX 求和），达到阈值后判定方向并清零，过滤悬停微动 */
let mouseDx = 0;
/** 鼠标左键按下状态：true 期间等同按住空格持续射击 */
let mouseFire = false;
/** 触屏转向手势上一次触点 X 坐标：null 表示无进行中的触屏转向（pointerup/cancel/失焦清空） */
let touchLastX = null;
/** 玩家朝向：1 右 / -1 左（原地冲刺时决定冲刺方向） */
let facing = 1;
/** 冲刺剩余时间（秒），大于 0 时处于冲刺位移与无敌帧中 */
let dashTimer = 0;
/** 冲刺冷却剩余时间（秒），大于 0 时不可再次冲刺 */
let dashCdTimer = 0;
/** 冲刺方向：1 右 / -1 左（发起冲刺瞬间锁定） */
let dashDir = 1;
/** 本局冲刺次数（冲刺成就统计） */
let dashCount = 0;
/** 本局击落数（成就统计） */
let killCount = 0;
/** 冲刺残影数组 { x, y, t, life }（t 为已存在秒数） */
const dashGhosts = [];

/* ===================== 特效状态 ===================== */

/** 击杀/受击粒子池 { x, y, vx, vy, life, maxLife, color, size }：预分配零分配复用，满员自动征用最旧粒子 */
const particlePool = new FX.Pool(240, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2 }));
/** 得分/提示飘字数组 { x, y, text, color, t, life }（t 为已存活秒数） */
const floatTexts = [];
/** 命中顿帧剩余时间（秒），大于 0 时冻结游戏逻辑制造打击停顿 */
let freezeTimer = 0;
/** 屏幕震动剩余时间（秒） */
let shakeTime = 0;
/** 屏幕震动幅度（像素） */
let shakeMag = 0;
/** 死亡演出剩余时间（秒）：大于 0 表示已进入 over 阶段但结算面板尚未弹出 */
let deathFxTimer = 0;
/** 死亡演出是否已播过：防止演出结束后再次进入 endGame 时重复重播演出导致结算面板永不弹出 */
let deathFxShown = false;
/** 死亡演出总时长（秒）：玫红/金双色爆裂粒子 + 大幅震动 + 白闪之后才弹结算面板 */
const DEATH_FX_TIME = 0.8;
/** 受击红闪剩余时间（秒）：全屏红色边缘闪光提示玩家掉血 */
let hurtFlashTimer = 0;
/** 连击倍率提升金色脉冲剩余时间（秒）：全屏金色泛光反馈 */
let goldPulseTimer = 0;
/** 波次开场横幅 { text, color, t, life }，null 表示无横幅 */
let waveBanner = null;
/** Boss 击败连环殉爆队列 { x, y, delay }（delay 为距引爆剩余秒数） */
const explosions = [];
/** Boss 落地冲击环剩余时间（秒），大于 0 时绘制自落点扩散的椭圆冲击波 */
let bossShockTimer = 0;

/* ===================== 成就系统（共享库 ach-common.js 驱动） ===================== */

/**
 * 成就定义表：id → { name, icon, rarity, cat, desc, stat, target }
 * - rarity 稀有度四档：common 普通 / rare 稀有 / epic 史诗 / legendary 传说（决定卡片配色与解锁特效档位）
 * - cat 分类：得分 / 成长 / 技巧 / 收集（成就墙卡片上的小标签）
 * - stat/target 对应成就存档 best 中的进度统计项与目标值（target 0 表示无进度条，仅解锁态展示）
 */
const ACHIEVEMENTS = [
    { id: 'firstBlood', name: '初战告捷', icon: '🚀', rarity: 'common', cat: '成长', desc: '击落第一只蜜蜂', stat: 'totalKills', target: 1 },
    { id: 'hundred', name: '百人斩', icon: '💯', rarity: 'rare', cat: '收集', desc: '累计击落 100 只蜜蜂', stat: 'totalKills', target: 100 },
    { id: 'combo10', name: '十连击', icon: '🔥', rarity: 'common', cat: '技巧', desc: '单局连击数达到 10', stat: 'combo', target: 10 },
    { id: 'combo25', name: '连击大师', icon: '⚡', rarity: 'epic', cat: '技巧', desc: '单局连击数达到 25', stat: 'combo', target: 25 },
    { id: 'boss1', name: '弑君者', icon: '👑', rarity: 'epic', cat: '成长', desc: '击败一只蜂王 Boss', stat: 'boss', target: 1 },
    { id: 'wave10', name: '十波坚守', icon: '🛡️', rarity: 'rare', cat: '成长', desc: '单局到达第 10 波', stat: 'wave', target: 10 },
    { id: 'score10k', name: '万分俱乐部', icon: '🏆', rarity: 'legendary', cat: '得分', desc: '单局得分达到 10000', stat: 'score', target: 10000 },
    { id: 'bomb10', name: '爆破专家', icon: '💣', rarity: 'rare', cat: '收集', desc: '累计使用 10 枚炸弹道具', stat: 'totalBombs', target: 10 },
    { id: 'dash30', name: '幻影步', icon: '💨', rarity: 'common', cat: '技巧', desc: '单局冲刺 30 次', stat: 'dash', target: 30 },
    { id: 'perfect', name: '完美防御', icon: '✨', rarity: 'epic', cat: '技巧', desc: '任意一波未掉命通关', stat: 'perfect', target: 1 }
];
/** 跨局最佳/累计统计初始值：共享层 Ach.init 初始化与旧档迁移钩子以此为基准合并 */
const ACH_BEST_DEFAULTS = {
    score: 0,      // 单局最高分
    wave: 1,       // 单局到达的最高波次
    combo: 0,      // 单局最高连击数
    dash: 0,       // 单局冲刺次数
    boss: 0,       // 蜂王击杀数（跨局累计）
    perfect: 0,    // 完美防御达成次数（跨局累计）
    totalKills: 0, // 跨局累计击落数
    totalBombs: 0  // 跨局累计炸弹使用数
};
/** 成就数据持久化键名（localStorage，与项目其余游戏统一 arcade_ach_* 前缀；字面量统一收口于顶部 KEYS） */
const ACHIEVEMENT_KEY = KEYS.achievements;
/** 旧版成就键名：早期未遵循 arcade_ach_* 约定，读取时回退此键并一次性迁移到新键，保留老玩家数据（字面量统一收口于顶部 KEYS） */
const ACHIEVEMENT_LEGACY_KEY = KEYS.achievementsLegacy;

/**
 * 成就存档自有迁移钩子：把读出的原始档归一为 v2 形状交共享层采用并落盘。
 * 兼容两代旧格式，判定分支与原 loadAchStore 逐条对应：
 * - v2 现役：unlocked 为对象映射 → 原样采用，best 缺项用初始值补齐；
 * - v1.5：新键 { unlocked: [id...], totalKills, totalBombs } 数组形态；
 * - v1.0：更早期旧键 beeAchievements 的 { unlocked: [...] } 形态；
 * - 其余（无档/损坏/裸数组等）按首次游玩处理返回全新空档——原实现不迁移裸数组，
 *   故此处不返回 null 借用共享层默认迁移（那会把裸数组当成就 id 迁入，与原行为不一致）
 * @param {*} raw Arcade.loadJSON 读新键的原始档（null = 无档/损坏/存储不可用）
 * @returns {{unlocked: Object<string, number>, best: Object<string, number>}}
 *          已解锁 id → 解锁时间戳映射，以及各维度最佳/累计统计
 */
function migrateBeeStore(raw) {
    // v2 现役结构：unlocked 为对象映射（非数组）直接采用，best 缺项用初始值补齐
    if (raw && raw.unlocked && typeof raw.unlocked === 'object' && !Array.isArray(raw.unlocked)) {
        return { unlocked: Object.assign({}, raw.unlocked), best: Object.assign({}, ACH_BEST_DEFAULTS, raw.best || {}) };
    }
    // 旧格式归一化：v1.5 新键数组形态优先，否则回读 v1.0 旧键（两代累计统计字段同名同义）
    let legacyIds = null;
    const legacyBest = {};
    if (raw && Array.isArray(raw.unlocked)) {
        legacyIds = raw.unlocked;
        legacyBest.totalKills = raw.totalKills || 0;
        legacyBest.totalBombs = raw.totalBombs || 0;
    } else {
        const legacy = Arcade.loadJSON(ACHIEVEMENT_LEGACY_KEY); // 旧键缺失 / 损坏 / 存储不可用统一返回 null
        if (legacy && Array.isArray(legacy.unlocked)) {
            legacyIds = legacy.unlocked;
            legacyBest.totalKills = legacy.totalKills || 0;
            legacyBest.totalBombs = legacy.totalBombs || 0;
        }
    }
    // 旧解锁迁入 unlocked（时间戳记 0，墙内显示已达成），累计统计并入 best；迁移落盘由共享层统一执行。
    // Arcade.loadJSON 失败统一返回 null 不会抛错，原实现的 try/catch 包裹的正是这些调用，故无需保留
    const migrated = { unlocked: {}, best: Object.assign({}, ACH_BEST_DEFAULTS, legacyBest) };
    if (legacyIds) {
        for (let i = 0; i < legacyIds.length; i++) migrated.unlocked[legacyIds[i]] = 0;
    }
    return migrated;
}

/** 成就墙遮罩 DOM 引用（开合/遮罩点击/× 按钮接线由共享库完成；游戏其余 DOM 在后方"DOM 引用"区统一管理） */
const achWall = document.getElementById('achWall');
/** 成就卡片网格容器 DOM 引用 */
const achGrid = document.getElementById('achGrid');
/** 已解锁计数 DOM 引用（共享层以数字滚动补间刷新） */
const achCountEl = document.getElementById('achCount');
/** 成就总数 DOM 引用（与计数同排的"/10"分母） */
const achTotalEl = document.getElementById('achTotal');
/** 总进度条填充 DOM 引用 */
const achBarFill = document.getElementById('achBarFill');
/** 成就解锁 toast 悬浮容器 DOM 引用 */
const achToastStack = document.getElementById('achToastStack');

// 初始化共享成就系统：存档装载/三代档位迁移、解锁演出（toast + 蜜蜂专属音效 + 史诗/传说彩带爆发）、
// 成就墙渲染与 V/Esc/遮罩/× 开合接线全部由 ach-common.js 提供。V 任意状态可用（含手动/失焦暂停中），
// 与原实现一致无前置门槛故省略 canOpen；开墙瞬间清空键鼠输入由 onToggle 接线
Ach.init({
    defs: ACHIEVEMENTS,
    storageKey: ACHIEVEMENT_KEY,
    bestDefaults: ACH_BEST_DEFAULTS,
    mount: { wall: achWall, grid: achGrid, count: achCountEl, total: achTotalEl, barFill: achBarFill, toasts: achToastStack },
    sfx: { unlock: () => SFX.beeAchievement() }, // 蜜蜂页专属解锁音效（缺省为共享层的破纪录号角）
    onToggle: (open) => {
        if (!open) return;
        // 开墙瞬间清空按键表并停火：防止关墙后残留的移动/开火输入"卡住"（关墙不清，与原实现一致）
        for (const k in keys) delete keys[k];
        mouseFire = false;
    },
    migrate: migrateBeeStore
});

/**
 * 累计型统计上报（add 语义：跨局击杀 totalKills / 用弹 totalBombs / 蜂王 boss / 完美防御 perfect）。
 * 旧值 + 增量必然大于旧值，经共享层 trackRunStat 的 max 语义等效写入 best 并连带解锁挂靠成就
 * （如 firstBlood / hundred / bomb10 / boss1 / perfect）
 * @param {string} stat 统计名（ACH_BEST_DEFAULTS 中的键）
 * @param {number} delta 本次增量（非正数忽略，防御调用方误传）
 * @returns {void}
 */
function trackCumulativeStat(stat, delta) {
    if (delta <= 0) return;
    Ach.trackRunStat(stat, Ach.getStore().best[stat] + delta);
}

/* ===================== DOM 引用 ===================== */

/** 游戏画布 */
const canvas = document.getElementById('gameCanvas');
/** 2D 绘图上下文（setupCanvas 内部会重设 transform 为 dpr 缩放基准，绘制一律使用逻辑坐标） */
const ctx = canvas.getContext('2d');
/** 画布逻辑宽度（CSS 像素）：DPR 适配后所有布局/边界计算一律以此为准 */
let viewW = 480;
/** 画布逻辑高度（CSS 像素）：DPR 适配后所有布局/边界计算一律以此为准 */
let viewH = 560;

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
/** 当前分数显示元素 */
const scoreElement = document.getElementById('score');
/** 波次显示元素 */
const waveElement = document.getElementById('wave');
/** 生命显示元素 */
const livesElement = document.getElementById('lives');
/** 最高分显示元素 */
const highScoreElement = document.getElementById('highScore');
/** 开始遮罩 */
const startScreen = document.getElementById('startScreen');
/** 游戏结束遮罩 */
const gameOverScreen = document.getElementById('gameOverScreen');
/** 暂停遮罩（与开始/结束遮罩同款面板形态，同步显示逻辑见 syncPauseOverlay） */
const pauseScreen = document.getElementById('pauseScreen');
/** 暂停遮罩恢复方式提示行（手动/失焦文案由 syncPauseOverlay 动态写入） */
const pauseTipElement = document.getElementById('pauseTip');
/** 暂停遮罩"已恢复上次进度"提示行（恢复快照成功后的首见遮罩显示） */
const pauseRestoreTipElement = document.getElementById('pauseRestoreTip');
/** 结算面板最终分数元素 */
const finalScoreElement = document.getElementById('finalScore');
/** 结算面板到达波次元素 */
const finalWaveElement = document.getElementById('finalWave');
/** "新纪录"提示元素 */
const newRecordElement = document.getElementById('newRecord');
/** 结算面板评级元素（S/A/B/C，HTML 中内联 display:none，显示时由 JS 置 block） */
const finalRankElement = document.getElementById('finalRank');
// 难度按钮组绑定收口共享库（Arcade.bindDifficultyButtons）：点击时序统一下沉
// （blur 防空格误触 → 高亮 → 存档 → 点击音 → 回调），canPick 复刻原「非法 key 或
// 重复选择直接忽略」前置守卫（整条时序短路，不存档不发声）
/** 难度选择按钮组控制器（绑定与程序化恢复，由 Arcade.bindDifficultyButtons 产出） */
const diffCtl = Arcade.bindDifficultyButtons({
    bar: document,
    btnSelector: '.diff-btn',
    storageKey: DIFFICULTY_KEY,
    persist: 'data-diff',
    activeClass: 'selected', // 本页按钮高亮类与默认 'active' 不同
    canPick: (_btn, _idx, key) => !!DIFFICULTIES[key] && key !== difficulty,
    lockedDuringPlay: () => gameState === 'playing', // 对局进行中禁切难度（局中守卫统一收口）
    onChange(_btn, _idx, key) {
        difficulty = key;
        diffCfg = DIFFICULTIES[key];
        // 刷新开始画面静态生命显示
        livesElement.textContent = `LIVES ${diffCfg.lives}`;
    }
});

// 页面加载即恢复上次最高分显示
highScoreElement.textContent = `HI ${highScore}`;
// 恢复存档难度的按钮选中态（程序化选择：不存档不发声；非法值已在难度区回退 normal）
diffCtl.sync(difficulty);
// 按当前难度刷新开始画面静态生命显示
livesElement.textContent = `LIVES ${lives}`;

/* ===================== 视差星空常量 ===================== */

/** 三层视差星层的下落速度（像素/秒，由远及近递增） */
const STAR_SPEEDS = [14, 30, 55];
/** 三层视差星层的星点尺寸（像素） */
const STAR_SIZES = [1.5, 2, 3];
/** 三层视差星层的星点透明度（远层更暗） */
const STAR_ALPHAS = [0.16, 0.28, 0.42];
/** 预生成的固定星空：66 颗星按伪随机序列铺开并循环分配三层 */
const STARS = [];
for (let i = 0; i < 66; i++) {
    STARS.push({
        x: (i * 97 + 31) % viewW,
        y: (i * 53 + 17) % viewH,
        layer: i % 3
    });
}

/* ===================== 初始化与流程 ===================== */

/**
 * 初始化一局新游戏：重置分数、生命、波次、玩家位置、武器/护盾、
 * 连击与全部特效状态，并生成第一波敌阵
 */
function initGame() {
    score = 0;
    lives = diffCfg.lives;
    wave = 1;
    isNewRecord = false;
    player = { x: (viewW - PLAYER_W) / 2, y: viewH - PLAYER_H - 16 };
    bullets.length = 0;
    enemyBullets.length = 0;
    powerups.length = 0;
    particlePool.clear(); // 归还全部粒子（池对象保留复用）
    floatTexts.length = 0;
    boss = null;
    SFX.bgm.setIntensity(false); // 清场重开瞬间脱离 Boss 危险分层（Boss 波重打会由 spawnBoss 重新置位）
    // 开火/俯冲间隔按难度缩短（除数越大节奏越快）
    enemyFireTimer = ENEMY_FIRE_INTERVAL / diffCfg.fire;
    diveTimer = DIVE_INTERVAL / diffCfg.dive;
    fireCooldown = 0;
    invincibleTimer = 0;
    weaponLevel = 1;
    hasShield = false;
    enemyFreezeTimer = 0;
    magnetTimer = 0;
    laserTimer = 0;
    laserTickTimer = 0;
    bombFlashTimer = 0;
    // 冲刺与成就局内状态重置
    facing = 1;
    dashTimer = 0;
    dashCdTimer = 0;
    dashCount = 0;
    killCount = 0;
    dashGhosts.length = 0;
    // 鼠标控制状态重置：新局从零开始，避免残留方向脉冲或开火态
    mouseDir = 0;
    mouseDirTimer = 0;
    mouseDx = 0;
    mouseFire = false;
    // 成就墙强制收起（新局从干净界面开始）；解锁提示为 DOM toast 自动消失，无需清理
    Ach.close();
    comboCount = 0;
    comboTimer = 0;
    comboMult = 1;
    nextLifeScore = EXTRA_LIFE_STEP;
    livesAtWaveStart = diffCfg.lives;
    freezeTimer = 0;
    shakeTime = 0;
    shakeMag = 0;
    // 新增特效状态重置：受击红闪 / 金色脉冲 / 波次横幅 / 连环殉爆队列 / Boss 落地冲击环
    hurtFlashTimer = 0;
    goldPulseTimer = 0;
    waveBanner = null;
    explosions.length = 0;
    bossShockTimer = 0;
    spawnWave();
    updateHud();
}

/**
 * 生成当前波次的敌阵：波次为 5 的倍数时生成 Boss，否则生成蜂群；
 * 同时弹出本波开场横幅（Boss 波粉色加长版）
 */
function spawnWave() {
    waveBanner = wave % 5 === 0
        ? { text: `WAVE ${wave} · BOSS`, color: '#ff3ea5', t: 0, life: 1.8 }
        : { text: `WAVE ${wave}`, color: '#39ff6a', t: 0, life: 1.4 };
    if (wave % 5 === 0) {
        spawnBoss();
    } else {
        spawnSwarm();
    }
}

/**
 * 生成一波蜂群：BEE_COLS × BEE_ROWS 网格，按概率混编蜂种
 * （精英 / 分裂 / 自爆 / 普通），并按当前波次提升横移速度；
 * 第 EVENT_WAVE_MIN 波起概率触发事件波（俯冲潮 / 精英阵）
 */
function spawnSwarm() {
    bees.length = 0;
    boss = null;
    // 事件波判定：达到起始波次后按概率随机选择事件类型
    waveEvent = null;
    if (wave >= EVENT_WAVE_MIN && Math.random() < EVENT_CHANCE) {
        waveEvent = Math.random() < 0.5 ? 'tide' : 'eliteWall';
    }
    // 蜂群整体居中：计算总宽度后平铺网格，记录基准 x 供编队位推算
    const swarmW = BEE_COLS * BEE_GAP_X;
    swarmBaseX = (viewW - swarmW + BEE_GAP_X - BEE_W) / 2;
    swarmOffsetX = 0;
    swarmDescend = 0;
    swarmDir = 1;
    // 每波提速 12%，按难度乘数缩放基础速度，封顶避免不可反应
    swarmSpeed = Math.min(SWARM_SPEED * diffCfg.swarm * Math.pow(1.12, wave - 1), 200);
    for (let row = 0; row < BEE_ROWS; row++) {
        for (let col = 0; col < BEE_COLS; col++) {
            // 按概率混编蜂种：精英阵全员精英，否则按精英/分裂/自爆依次 roll
            let type = 'normal';
            if (waveEvent === 'eliteWall') {
                type = 'elite';
            } else {
                const roll = Math.random();
                if (roll < ELITE_CHANCE) {
                    type = 'elite';
                } else if (roll < ELITE_CHANCE + SPLITTER_CHANCE) {
                    type = 'splitter';
                } else if (roll < ELITE_CHANCE + SPLITTER_CHANCE + BOMBER_CHANCE) {
                    type = 'bomber';
                }
            }
            bees.push({
                col,
                row,
                type,
                hp: type === 'elite' ? 2 : 1,
                alive: true,
                diving: false,
                reenter: false,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                dropped1: false,
                dropped2: false
            });
        }
    }
    // 事件波开场提示
    if (waveEvent === 'tide') {
        addFloatText(viewW / 2, 170, '事件波: 俯冲潮!', '#ff7b2e', 1.4);
        SFX.beeDive();
    } else if (waveEvent === 'eliteWall') {
        addFloatText(viewW / 2, 170, '事件波: 精英阵!', '#ff3ea5', 1.4);
        SFX.beeBossWarn();
    }
    // 开火/俯冲基准间隔按难度除数缩短
    enemyFireTimer = ENEMY_FIRE_INTERVAL / diffCfg.fire;
    diveTimer = DIVE_INTERVAL * Math.pow(0.93, wave - 1) / diffCfg.dive;
    // 俯冲潮：本波首次俯冲大幅提前
    if (waveEvent === 'tide') diveTimer *= TIDE_DIVE_MULT;
}

/**
 * 生成 Boss：正弦游走 + 瞄准弹 + 扇形弹幕，血量随波次增长；
 * 入场分三阶段演出——警告横幅鸣响（Boss 隐于画外）→ 顶部缓降（引擎尾焰
 * 拖尾）→ 落地冲击（顿帧 + 震屏 + 尘爆 + 冲击环），全程不开火
 */
function spawnBoss() {
    bees.length = 0;
    waveEvent = null;
    // Boss 血量按难度乘数缩放（四舍五入避免小数血量）
    const maxHp = Math.round((BOSS_BASE_HP + (wave - 1) * BOSS_HP_PER_WAVE) * diffCfg.bossHp);
    boss = {
        x: viewW / 2 - BOSS_W / 2,
        y: -BOSS_H - 20,
        hp: maxHp,
        maxHp,
        t: 0,
        fanTimer: BOSS_FAN_INTERVAL,
        aimTimer: BOSS_AIM_INTERVAL,
        // 入场三阶段：'warn' 警告演出（Boss 隐于画外）→ 'enter' 缓降 → 'fight' 正式战斗
        phase: 'warn',
        // 警告演出剩余时间：归零后现身转入缓降
        warnTimer: BOSS_WARN_TIME,
        targetY: 70,
        // 受击闪白剩余时间（秒）
        flash: 0,
        // 低血狂暴：血量过半一次性触发，弹幕加速且身体变红
        enraged: false
    };
    SFX.beeBossAlarm();
    SFX.bgm.setIntensity(true); // Boss 战开幕：叠加 Boss 战鼓点层（入场警告演出即计入危险态）
}

/**
 * 开始游戏：隐藏两块遮罩，初始化并进入 playing 阶段
 */
function startGame() {
    startScreen.style.display = 'none';
    gameOverScreen.style.display = 'none';
    // 重置死亡演出计时与已播标记，避免上一局的演出状态残留到新一局
    deathFxTimer = 0;
    deathFxShown = false;
    // 新一局开始：清除失焦/手动两种暂停标记，避免上一局残留的暂停态卡住新局
    blurPaused = false;
    paused = false;
    syncPauseOverlay(); // 同步隐藏暂停遮罩（幂等）
    initGame();
    gameState = 'playing';
    SFX.start();
    // 开始游戏：启动蜜蜂保卫战专属背景音乐
    SFX.bgm.start('bee');
}

/**
 * 结束游戏：两段式结算——首次进入先播放死亡演出（爆裂 + 震动 + 闪白），
 * 演出结束后再次进入才更新最高分并弹出结算面板
 */
function endGame() {
    // 第一段：死亡演出阶段（仅首次进入，deathFxShown 防止重复重播），演出计时结束后由主循环再次调用本函数弹出面板
    if (!deathFxShown) {
        // 标记演出已播过：主循环演出结束后（deathFxTimer 已归零）再次进入时直接走下方结算分支
        deathFxShown = true;
        gameState = 'over';
        // 游戏已结束：立即清除进行中保存的进度快照，避免下次进入误恢复残局（存储不可用时静默忽略）
        snapPipe.clear();
        // 玩家阵亡立即停止背景音乐，为死亡演出留出声音空间
        SFX.bgm.stop();
        deathFxTimer = DEATH_FX_TIME;
        // 玩家中心坐标（与 hitPlayer 中的爆裂位置保持一致）
        const cx = player.x + PLAYER_W / 2;
        const cy = player.y + PLAYER_H / 2;
        // 双色爆裂粒子：玫红为主 + 金色点缀，强化死亡瞬间的视觉冲击
        spawnBurst(cx, cy, '#ff3ea5', 40, 300);
        spawnBurst(cx, cy, '#ffd23e', 24, 220);
        // 大幅长震 + 顿帧 + 白闪，多通道反馈叠加
        shakeTime = 0.5;
        shakeMag = 8;
        freezeTimer = Math.max(freezeTimer, 0.35);
        bombFlashTimer = Math.max(bombFlashTimer, 0.35);
        SFX.beePlayerHit();
        return;
    }
    gameState = 'over';
    // 刷新最高分持久化
    if (score > highScore) {
        highScore = score;
        isNewRecord = true;
        // 隐私模式等存储不可用时静默跳过，本局结算仍正常显示新纪录
        Arcade.saveRaw(KEYS.highScore, String(highScore));
        highScoreElement.textContent = `HI ${highScore}`;
    }
    finalScoreElement.textContent = score;
    finalWaveElement.textContent = wave;
    // 结算评级：按得分/波次计算 S/A/B/C 并展示（面板 display 切换会重置 CSS 动画，弹入动画自动重播）
    const rank = computeBeeRank();
    finalRankElement.textContent = rank;
    finalRankElement.className = `rank-badge rank-${rank.toLowerCase()}`;
    finalRankElement.style.display = 'block';
    newRecordElement.style.display = isNewRecord ? 'block' : 'none';
    gameOverScreen.style.display = 'block';
    // 刷新纪录时以辉煌琶音替代常规结束音，避免两音叠加，并追加破纪录金色烟花
    if (isNewRecord) {
        SFX.beeRecord();
        FX.recordBurst();
    } else {
        SFX.gameOver();
        // 评级音效复用 bee 素材：S 级用辉煌琶音、A/B 级用成就琶音，C 级不额外加音
        if (rank === 'S') SFX.beeRecord();
        else if (rank === 'A' || rank === 'B') SFX.beeAchievement();
    }
}

/**
 * 计算本局结算评级（S/A/B/C）。
 * 阈值依据：普通难度下每清一波约得 500~800 分，故以得分为主、波次为辅，
 * 任一指标达标即取高评级：
 *   S —— 得分 ≥12000 或波次 ≥10：通关多轮 Boss 战的蜂王级表现
 *   A —— 得分 ≥6000 或波次 ≥7：稳定推进两个 Boss 周期以上的强表现
 *   B —— 得分 ≥2500 或波次 ≥4：打满一个 Boss 周期的合格表现
 *   C —— 未达 B 级：初期阵亡
 * @returns {string} 评级字母（'S' | 'A' | 'B' | 'C'）
 */
function computeBeeRank() {
    if (score >= 12000 || wave >= 10) return 'S';
    if (score >= 6000 || wave >= 7) return 'A';
    if (score >= 2500 || wave >= 4) return 'B';
    return 'C';
}

/* ===================== 射击 ===================== */

/**
 * 玩家开火：按武器等级生成 1~4 发子弹，冷却结束后才可再次射击
 */
function playerFire() {
    if (fireCooldown > 0) return;
    fireCooldown = FIRE_COOLDOWN;
    const cx = player.x + PLAYER_W / 2;
    const y = player.y;
    if (weaponLevel === 1) {
        // 单发居中
        bullets.push({ x: cx, y, vx: 0 });
    } else if (weaponLevel === 2) {
        // 双发平行
        bullets.push({ x: cx - 9, y, vx: 0 });
        bullets.push({ x: cx + 9, y, vx: 0 });
    } else {
        // 三向散射：双发平行 + 左右斜射
        bullets.push({ x: cx - 9, y, vx: 0 });
        bullets.push({ x: cx + 9, y, vx: 0 });
        bullets.push({ x: cx - 6, y, vx: -SPREAD_VX });
        bullets.push({ x: cx + 6, y, vx: SPREAD_VX });
    }
    SFX.beeShoot();
}

/**
 * 敌方直落弹：从指定坐标向下发射
 * @param {number} x 发射点 x
 * @param {number} y 发射点 y
 */
function enemyDrop(x, y) {
    // 弹速乘难度乘数：困难更快、简单更慢
    enemyBullets.push({ x, y, vx: 0, vy: (ENEMY_BULLET_SPEED + wave * 6) * diffCfg.bullet });
}

/**
 * 蜂群定时投放子弹：随机选取一只编队中的蜜蜂（不含俯冲/归队）发射
 */
function formationFire() {
    const candidates = bees.filter(b => b.alive && !b.diving && !b.reenter);
    if (candidates.length === 0) return;
    const shooter = candidates[Math.floor(Math.random() * candidates.length)];
    enemyDrop(shooter.x + BEE_W / 2, shooter.y + BEE_H);
}

/**
 * Boss 发射瞄准弹：朝玩家当前位置直线射击
 * @param {number} speed 弹速（像素/秒）
 */
function bossAimedShot(speed) {
    const bx = boss.x + BOSS_W / 2;
    const by = boss.y + BOSS_H;
    const dx = (player.x + PLAYER_W / 2) - bx;
    const dy = (player.y + PLAYER_H / 2) - by;
    const len = Math.max(1, Math.hypot(dx, dy));
    // 难度乘数统一在弹速计算处应用（DRY：调用方无需感知难度）
    const sp = speed * diffCfg.bullet;
    enemyBullets.push({ x: bx, y: by, vx: dx / len * sp, vy: dy / len * sp });
}

/**
 * Boss 发射扇形弹幕：以瞄准玩家方向为中心，向两侧均匀展开多发斜弹
 */
function bossFanShot() {
    // 扇形弹基础速度同样受难度乘数影响
    const speed = (ENEMY_BULLET_SPEED + 60) * diffCfg.bullet;
    const bx = boss.x + BOSS_W / 2;
    const by = boss.y + BOSS_H;
    // 以指向玩家的角度为中心，两侧均分张角
    const base = Math.atan2((player.y + PLAYER_H / 2) - by, (player.x + PLAYER_W / 2) - bx);
    for (let i = 0; i < BOSS_FAN_COUNT; i++) {
        const ang = base + (i - (BOSS_FAN_COUNT - 1) / 2) * (BOSS_FAN_SPREAD / (BOSS_FAN_COUNT - 1));
        enemyBullets.push({ x: bx, y: by, vx: Math.cos(ang) * speed, vy: Math.abs(Math.sin(ang)) * speed + 60 });
    }
}

/* ===================== 冲刺闪避 ===================== */

/**
 * 执行冲刺：沿当前输入方向（原地时沿朝向）高速位移 DASH_TIME 秒，
 * 期间免疫伤害并逐帧留残影；冷却期间或已在冲刺中则忽略
 */
function performDash() {
    if (gameState !== 'playing' || dashCdTimer > 0 || dashTimer > 0) return;
    // 方向取当前输入方向（键盘优先，其次鼠标等效方向），无输入时沿上次朝向冲刺
    const dir = moveAxis();
    dashDir = dir !== 0 ? dir : facing;
    facing = dashDir;
    dashTimer = DASH_TIME;
    dashCdTimer = DASH_COOLDOWN;
    dashCount++;
    // 成就：单局冲刺次数回写最佳值（挂靠的 dash30 由共享层扫描连带解锁）
    Ach.trackRunStat('dash', dashCount);
    SFX.beeDash();
}

/* ===================== 俯冲 ===================== */

/**
 * 触发一次俯冲：随机挑选一只编队蜜蜂，赋予俯冲初速度并轻微追踪玩家
 */
function triggerDive() {
    const candidates = bees.filter(b => b.alive && !b.diving && !b.reenter);
    if (candidates.length === 0) return;
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    b.diving = true;
    b.reenter = false;
    // 自爆蜂俯冲速度更快，压迫感更强
    b.vy = DIVE_START_VY * (b.type === 'bomber' ? BOMBER_DIVE_MULT : 1);
    // 初始横向速度带随机倾向，配合追踪形成弧线俯冲
    b.vx = (Math.random() - 0.5) * 120;
    b.dropped1 = false;
    b.dropped2 = false;
    SFX.beeDive();
}

/**
 * 推进一只俯冲蜜蜂：加速下落 + 轻微追踪玩家 + 按阈值投弹，
 * 冲出屏幕后转入归队状态（从顶部返回编队位）；
 * 自爆蜂贴近玩家时引爆，小蛋蜂冲出屏幕直接消散
 * @param {object} b 蜜蜂对象
 * @param {number} dt 帧间隔秒数
 */
function updateDive(b, dt) {
    const bw = wOf(b);
    const bh = hOf(b);
    // 加速下坠
    b.vy += DIVE_ACCEL * dt;
    // 轻微追踪：向玩家方向施加水平转向加速度，并限制横向速度
    const steer = Math.sign(player.x + PLAYER_W / 2 - (b.x + bw / 2));
    b.vx = Math.max(-DIVE_VX_MAX, Math.min(DIVE_VX_MAX, b.vx + steer * DIVE_HOMING * dt));
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // 沿途两次投弹（到达阈值高度各一次；小蛋蜂 dropped 已置位不会投弹）
    if (!b.dropped1 && b.y > DIVE_DROP_YS[0]) {
        b.dropped1 = true;
        enemyDrop(b.x + bw / 2, b.y + bh);
    }
    if (!b.dropped2 && b.y > DIVE_DROP_YS[1]) {
        b.dropped2 = true;
        enemyDrop(b.x + bw / 2, b.y + bh);
    }
    // 自爆蜂引信：俯冲中与玩家距离小于阈值即当场引爆
    if (b.type === 'bomber') {
        const dx = player.x + PLAYER_W / 2 - (b.x + bw / 2);
        const dy = player.y + PLAYER_H / 2 - (b.y + bh / 2);
        if (Math.hypot(dx, dy) < BOMBER_FUSE_DIST) {
            detonateBomber(b);
            return;
        }
    }
    // 冲出屏幕：小蛋蜂直接消散（无编队位可归），其余转归队从顶部降落
    if (b.y > viewH + 40) {
        if (b.type === 'mini') {
            b.alive = false;
        } else {
            b.diving = false;
            b.reenter = true;
            b.x = slotXOf(b);
            b.y = -40;
        }
    }
}

/**
 * 计算蜜蜂的编队位 x（基准位 + 横偏移）
 * @param {object} b 蜜蜂对象
 * @returns {number} 编队位左上角 x
 */
function slotXOf(b) {
    return swarmBaseX + b.col * BEE_GAP_X + swarmOffsetX;
}

/**
 * 计算蜜蜂的编队位 y（基准位 + 累计下压量）
 * @param {object} b 蜜蜂对象
 * @returns {number} 编队位左上角 y
 */
function slotYOf(b) {
    return 60 + b.row * BEE_GAP_Y + swarmDescend;
}

/**
 * 取蜜蜂的碰撞/绘制宽度（小蛋蜂体型更小）
 * @param {object} b 蜜蜂对象
 * @returns {number} 宽度（像素）
 */
function wOf(b) {
    return b.type === 'mini' ? MINI_W : BEE_W;
}

/**
 * 取蜜蜂的碰撞/绘制高度（小蛋蜂体型更小）
 * @param {object} b 蜜蜂对象
 * @returns {number} 高度（像素）
 */
function hOf(b) {
    return b.type === 'mini' ? MINI_H : BEE_H;
}

/* ===================== 特殊蜂种行为 ===================== */

/**
 * 分裂蜂被击落时裂出小蛋蜂：向左右分离并快速俯冲，
 * 沿途不投弹、冲出屏幕后直接消散
 * @param {object} parent 被击落的分裂蜂
 */
function spawnMinis(parent) {
    for (let i = 0; i < MINI_COUNT; i++) {
        bees.push({
            col: parent.col,
            row: parent.row,
            type: 'mini',
            hp: 1,
            alive: true,
            diving: true,
            reenter: false,
            x: parent.x + (BEE_W - MINI_W) / 2,
            y: parent.y + (BEE_H - MINI_H) / 2,
            vx: (i === 0 ? -1 : 1) * MINI_SPLIT_VX,
            vy: MINI_DIVE_VY,
            dropped1: true,
            dropped2: true
        });
    }
    SFX.beeSplit();
}

/**
 * 自爆蜂引爆：向四周环形发射弹幕并产生爆裂特效与震动
 * （不结算得分，属于自爆蜂的威胁性退场）
 * @param {object} b 引爆的自爆蜂
 */
function detonateBomber(b) {
    b.alive = false;
    const cx = b.x + wOf(b) / 2;
    const cy = b.y + hOf(b) / 2;
    // 环形均分弹道角度，全向封锁走位
    for (let i = 0; i < BOMBER_BULLETS; i++) {
        const ang = (i / BOMBER_BULLETS) * Math.PI * 2;
        enemyBullets.push({ x: cx, y: cy, vx: Math.cos(ang) * BOMBER_BULLET_SPEED, vy: Math.sin(ang) * BOMBER_BULLET_SPEED });
    }
    spawnBurst(cx, cy, '#ff7b2e', 18, 240);
    shakeTime = Math.max(shakeTime, 0.18);
    shakeMag = Math.max(shakeMag, 4);
    SFX.beeBomberBoom();
}

/* ===================== 碰撞与得分 ===================== */

/**
 * 矩形碰撞检测（AABB）
 * @param {number} ax A 左上角 x
 * @param {number} ay A 左上角 y
 * @param {number} aw A 宽
 * @param {number} ah A 高
 * @param {number} bx B 左上角 x
 * @param {number} by B 左上角 y
 * @param {number} bw B 宽
 * @param {number} bh B 高
 * @returns {boolean} 两矩形是否重叠
 */
function isHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * 由连击数推导得分倍率（每 COMBO_STEP 连击提升一档，封顶 COMBO_MAX_MULT）
 * @returns {number} 当前倍率
 */
function calcMult() {
    return Math.min(COMBO_MAX_MULT, 1 + Math.floor(comboCount / COMBO_STEP));
}

/**
 * 击落蜜蜂：结算连击与得分，生成爆炸粒子/飘字/微顿帧，
 * 概率掉落道具并检查里程碑加命；分裂蜂裂出小蛋蜂，
 * 俯冲中的自爆蜂被击落时当场引爆
 * @param {object} b 被击落的蜜蜂
 */
function killBee(b) {
    b.alive = false;
    const bw = wOf(b);
    const bh = hOf(b);
    // 连击推进：倍率提升时播放提示音与金色飘字
    comboCount++;
    comboTimer = COMBO_WINDOW;
    const mult = calcMult();
    if (mult > comboMult) {
        comboMult = mult;
        SFX.beeCombo(mult);
        addFloatText(b.x + bw / 2, b.y - 18, `COMBO x${mult}`, '#ffd23e', 1.1);
        // 倍率提升瞬间全屏金色脉冲，强化成长反馈
        goldPulseTimer = 0.3;
    }
    // 成就统计：本局连击与跨局累计击杀推进（累计值入 best 存档；
    // firstBlood/hundred/combo10/combo25 由共享层扫描挂靠统计连带解锁）
    killCount++;
    trackCumulativeStat('totalKills', 1);
    Ach.trackRunStat('combo', comboCount);
    // 按蜂种结算基础分并乘以倍率
    const baseByType = { elite: ELITE_POINTS, splitter: SPLITTER_POINTS, bomber: BOMBER_POINTS, mini: MINI_POINTS };
    const base = baseByType[b.type] || BEE_POINTS;
    const gained = base * mult;
    score += gained;
    addFloatText(b.x + bw / 2, b.y, `+${gained}`, b.type === 'elite' ? '#ff3ea5' : '#e8e8ff', 0.8);
    // 爆裂粒子与打击感（精英蜂更华丽）
    const isElite = b.type === 'elite';
    spawnBurst(b.x + bw / 2, b.y + bh / 2, isElite ? '#ff3ea5' : '#ffd23e', isElite ? 16 : 10, isElite ? 220 : 160);
    freezeTimer = Math.max(freezeTimer, isElite ? 0.04 : 0.02);
    shakeTime = Math.max(shakeTime, 0.06);
    shakeMag = Math.max(shakeMag, 1.5);
    if (isElite) SFX.beeEliteDie(); else SFX.beeDie();
    // 蜂种特效：分裂蜂裂出小蛋蜂；俯冲中的自爆蜂被击落也会当场引爆
    if (b.type === 'splitter') spawnMinis(b);
    if (b.type === 'bomber' && b.diving) detonateBomber(b);
    // 概率掉落道具
    if (Math.random() < POWERUP_DROP_CHANCE) dropPowerup(b.x + bw / 2, b.y + bh / 2);
    checkExtraLife();
    updateHud();
}

/**
 * 击中 Boss：扣血、闪白与火花反馈；血量过半触发一次性狂暴
 * （弹幕加速、身体变红）；血量归零则连环殉爆后击败结算
 * @param {boolean} [silent] 静音本次受击音（全屏炸弹批量结算时避免受击音连续叠播）
 */
function hitBoss(silent) {
    boss.hp--;
    score += 5;
    boss.flash = 0.06;
    // 血条失白闪烁置位：顶部血量区域叠加短暂白光，强化"掉血"感知
    bossHurtFlash = BOSS_HURT_FLASH_TIME;
    // 受击火花（小而快，区别于击杀爆裂）
    spawnBurst(boss.x + BOSS_W / 2 + (Math.random() - 0.5) * BOSS_W, boss.y + BOSS_H / 2, '#e8e8ff', 3, 120);
    if (!silent) SFX.beeArmorHit();
    // 低血狂暴：血量首次跌破一半时一次性触发，警示音 + 飘字 + 震动
    if (!boss.enraged && boss.hp > 0 && boss.hp <= boss.maxHp * 0.5) {
        boss.enraged = true;
        SFX.beeEnrage();
        addFloatText(boss.x + BOSS_W / 2, boss.y - 14, '狂暴!', '#ff2222', 1.2);
        spawnBurst(boss.x + BOSS_W / 2, boss.y + BOSS_H / 2, '#ff2222', 20, 260);
        shakeTime = Math.max(shakeTime, 0.25);
        shakeMag = Math.max(shakeMag, 4);
    }
    if (boss.hp <= 0) {
        // 击败 Boss：高额奖励 + 大爆炸 + 掉落道具
        const bonus = BOSS_BONUS + (wave - 1) * BOSS_BONUS_PER_WAVE;
        score += bonus;
        addFloatText(boss.x + BOSS_W / 2, boss.y, `BOSS +${bonus}`, '#ff3ea5', 1.4);
        spawnBurst(boss.x + BOSS_W / 2, boss.y + BOSS_H / 2, '#ffd23e', 40, 320);
        freezeTimer = Math.max(freezeTimer, 0.35);
        shakeTime = Math.max(shakeTime, 0.4); // 取 max 不覆盖进行中的更强震动
        shakeMag = Math.max(shakeMag, 6);
        SFX.beeBossDie();
        // 连环殉爆：Boss 躯体范围内预排 5 个延时爆炸点，
        // 在击败顿帧结束后依次爆开，形成"大爆 → 殉爆"节奏
        for (let i = 0; i < 5; i++) {
            explosions.push({
                x: boss.x + Math.random() * BOSS_W,
                y: boss.y + Math.random() * BOSS_H,
                delay: 0.12 + i * 0.14
            });
        }
        // 成就：击败蜂王（跨局累计计数回写，挂靠的 boss1 由共享层扫描连带解锁）
        trackCumulativeStat('boss', 1);
        dropPowerup(boss.x + BOSS_W / 2, boss.y + BOSS_H / 2);
        boss = null;
        SFX.bgm.setIntensity(false); // Boss 被击败：脱离危险分层，鼓点层逐拍衰减收场
        checkExtraLife();
        updateHud();
    }
}

/**
 * 里程碑奖励生命：分数每越过一个步长奖励 1 条命（受上限约束）
 */
function checkExtraLife() {
    while (score >= nextLifeScore) {
        nextLifeScore += EXTRA_LIFE_STEP;
        if (lives < MAX_LIVES) {
            lives++;
            SFX.beeOneUp();
            addFloatText(player.x + PLAYER_W / 2, player.y - 20, '1UP!', '#39ff6a', 1.2);
            updateHud();
        }
    }
}

/**
 * 击中玩家：无敌档难度完全免疫；护盾优先抵挡；否则扣命、降级武器、
 * 清空敌弹并给予无敌闪烁；生命耗尽则结束游戏
 */
function hitPlayer() {
    // 无敌档难度：完全免疫一切受击（不掉命、不碎盾、不清敌弹、无顿帧），直接返回
    if (difficulty === 'invincible') return;
    // 无敌期或冲刺过程中免疫伤害（冲刺无敌帧）
    if (invincibleTimer > 0 || dashTimer > 0) return;
    // 护盾抵挡：碎盾而非掉命
    if (hasShield) {
        hasShield = false;
        invincibleTimer = 1.2;
        enemyBullets.length = 0;
        hurtFlashTimer = 0.25;
        spawnBurst(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, '#35e0ff', 18, 220);
        addFloatText(player.x + PLAYER_W / 2, player.y - 20, '护盾破裂', '#35e0ff', 1.0);
        SFX.beeShieldHit();
        return;
    }
    lives--;
    // 最后一条命：红色警报音警示濒死状态
    if (lives === 1) SFX.beeAlarm();
    // 受击惩罚：连击清零 + 武器降一级
    comboCount = 0;
    comboTimer = 0;
    comboMult = 1;
    weaponLevel = Math.max(1, weaponLevel - 1);
    invincibleTimer = RESPAWN_INVINCIBLE;
    // 清空敌弹给玩家喘息空间
    enemyBullets.length = 0;
    spawnBurst(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, '#ff3ea5', 24, 260);
    freezeTimer = Math.max(freezeTimer, 0.15);
    shakeTime = 0.3;
    shakeMag = 6;
    // 掉命红闪比碎盾更强烈、更持久
    hurtFlashTimer = 0.4;
    SFX.beePlayerHit();
    updateHud();
    if (lives <= 0) endGame();
}

/* ===================== 道具 ===================== */

/**
 * 掉落一枚道具：7 类按权重随机（火力 30% / 护盾 18% / 1UP 12% /
 * 炸弹 12% / 时停 10% / 激光 8% / 磁铁 10%），生命已满时 1UP 权重并入护盾
 * @param {number} x 掉落点 x
 * @param {number} y 掉落点 y
 */
function dropPowerup(x, y) {
    let type;
    const roll = Math.random();
    if (roll < 0.3) {
        type = 'weapon';
    } else if (roll < 0.48) {
        type = 'shield';
    } else if (roll < 0.6) {
        type = lives < MAX_LIVES ? 'life' : 'shield';
    } else if (roll < 0.72) {
        type = 'bomb';
    } else if (roll < 0.82) {
        type = 'freeze';
    } else if (roll < 0.9) {
        type = 'laser';
    } else {
        type = 'magnet';
    }
    powerups.push({ x, y, type });
}

/**
 * 应用道具效果：按道具类型分发处理
 * 火力/护盾/1UP 为即时增益，炸弹即时引爆，时停/磁铁/激光刷新对应时限
 * @param {object} p 被拾取的道具
 */
function applyPowerup(p) {
    const style = POWERUP_STYLE[p.type];
    if (p.type === 'weapon') {
        if (weaponLevel < 3) {
            weaponLevel++;
            addFloatText(p.x, p.y - 10, '火力提升!', style.color, 1.0);
        } else {
            // 已满级则折算分数
            score += 200;
            addFloatText(p.x, p.y - 10, '+200', style.color, 0.9);
        }
        SFX.beePowerupWeapon();
    } else if (p.type === 'shield') {
        hasShield = true;
        addFloatText(p.x, p.y - 10, '护盾!', style.color, 1.0);
        SFX.beePowerupShield();
    } else if (p.type === 'life') {
        if (lives < MAX_LIVES) {
            lives++;
            addFloatText(p.x, p.y - 10, '1UP!', style.color, 1.0);
        } else {
            // 满命则折算分数
            score += 500;
            addFloatText(p.x, p.y - 10, '+500', style.color, 0.9);
        }
        SFX.beePowerupLife();
    } else if (p.type === 'bomb') {
        // 炸弹立即引爆，音效与飘字在 detonateBomb 内部处理
        detonateBomb(p.x, p.y);
    } else if (p.type === 'freeze') {
        enemyFreezeTimer = FREEZE_DURATION;
        addFloatText(p.x, p.y - 10, '时间静止!', style.color, 1.2);
        SFX.beeSlow();
    } else if (p.type === 'magnet') {
        magnetTimer = MAGNET_DURATION;
        addFloatText(p.x, p.y - 10, '磁力全开!', style.color, 1.2);
        SFX.beeMagnet();
    } else {
        laserTimer = LASER_DURATION;
        laserTickTimer = 0;
        addFloatText(p.x, p.y - 10, '激光武装!', style.color, 1.2);
        SFX.beeLaser();
    }
    updateHud();
}

/* ===================== 道具扩展行为 ===================== */

/**
 * 引爆全屏炸弹：对场上所有蜜蜂造成范围伤害、按点数重创 Boss，
 * 清空全部敌方弹幕，并触发白闪/震屏/顿帧反馈
 * @param {number} x 爆心 x 坐标（用于飘字定位）
 * @param {number} y 爆心 y 坐标（用于飘字定位）
 */
function detonateBomb(x, y) {
    // 以快照长度遍历，避免炸弹击落分裂蜂裂出的小蛋蜂被同帧连坐
    const count = bees.length;
    for (let i = 0; i < count; i++) {
        const b = bees[i];
        if (!b.alive) continue;
        b.hp -= BOMB_DAMAGE;
        if (b.hp <= 0) {
            killBee(b);
        } else {
            spawnBurst(b.x + wOf(b) / 2, b.y + hOf(b) / 2, '#e8e8ff', 3, 100);
        }
    }
    // Boss 按点数结算（复用 hitBoss 的受击/击败逻辑，击败后 boss 为 null 自动停止；
    // 传 silent 批量静音受击音，只留炸弹本身的爆轰音）
    for (let i = 0; i < BOMB_BOSS_DAMAGE && boss; i++) hitBoss(true);
    // 蜂群自爆引发的弹幕与原有敌弹一并清空（必须在伤害结算后执行）
    enemyBullets.length = 0;
    // 成就统计：跨局炸弹使用数推进（累计值入 best 存档，挂靠的 bomb10 由共享层连带解锁）
    trackCumulativeStat('totalBombs', 1);
    // 同一波炸弹连击合并反馈：白闪窗口内重复引爆不重复震屏与音效，震屏维持首次最强值
    if (bombFlashTimer <= 0) {
        shakeTime = Math.max(shakeTime, 0.35);
        shakeMag = Math.max(shakeMag, 6);
        SFX.beeBomb();
    }
    bombFlashTimer = BOMB_FLASH_TIME;
    freezeTimer = Math.max(freezeTimer, 0.12);
    addFloatText(x, y - 10, '全屏轰炸!', '#ff5533', 1.2);
}

/**
 * 激光伤害结算：以玩家为中心生成贯穿光柱的截面矩形，
 * 对截面内所有蜜蜂与 Boss 造成一次伤害（按 LASER_TICK 节拍调用）
 */
function fireLaserTick() {
    const cx = player.x + PLAYER_W / 2;
    const left = cx - LASER_WIDTH / 2;
    // 记录本拍最高命中点，用于在命中处喷发粒子
    let topHitY = player.y;
    let hitAny = false;
    // 快照长度遍历：激光击落分裂蜂裂出的小蛋蜂不参与本拍结算
    const count = bees.length;
    for (let i = 0; i < count; i++) {
        const b = bees[i];
        if (!b.alive) continue;
        if (isHit(left, 0, LASER_WIDTH, player.y, b.x, b.y, wOf(b), hOf(b))) {
            hitAny = true;
            if (b.y < topHitY) topHitY = b.y;
            b.hp -= LASER_DAMAGE;
            if (b.hp <= 0) {
                killBee(b);
            } else {
                spawnBurst(b.x + wOf(b) / 2, b.y + hOf(b), '#f0f6ff', 2, 80);
            }
        }
    }
    if (boss && boss.phase !== 'warn' && isHit(left, 0, LASER_WIDTH, player.y, boss.x, boss.y, BOSS_W, BOSS_H)) {
        hitAny = true;
        if (boss.y < topHitY) topHitY = boss.y;
        hitBoss();
    }
    if (hitAny) spawnBurst(cx, Math.max(4, topHitY), '#f0f6ff', 2, 90);
}

/* ===================== 波次推进 ===================== */

/**
 * 清波结算并进入下一波：按波次给清波奖励，本波未掉命再获
 * "完美防御"加分，随后生成新敌阵
 */
function nextWave() {
    // 清波敌弹化作星尘消散，避免清波瞬间残余敌弹仍具威胁
    for (const bl of enemyBullets) spawnBurst(bl.x, bl.y, '#ff3ea5', 3, 90);
    enemyBullets.length = 0;
    // 清波奖励：100 × 已通关的波次
    let bonus = 100 * wave;
    addFloatText(viewW / 2, 260, `WAVE ${wave} CLEAR +${bonus}`, '#39ff6a', 1.3);
    // 完美防御：本波一次未掉命额外 +200
    if (lives === livesAtWaveStart) {
        bonus += 200;
        addFloatText(viewW / 2, 292, '完美防御 +200', '#ffd23e', 1.3);
        // 成就：完美防御次数回写（挂靠的 perfect 由共享层扫描连带解锁）
        trackCumulativeStat('perfect', 1);
    }
    score += bonus;
    SFX.beeWaveClear();
    checkExtraLife();
    wave++;
    // 成就：波次最佳值回写（挂靠的 wave10 由共享层扫描连带解锁；wave 已自增为即将开始的波次）
    Ach.trackRunStat('wave', wave);
    livesAtWaveStart = lives;
    spawnWave();
    updateHud();
}

/* ===================== 主逻辑更新 ===================== */

/**
 * 推进一帧游戏逻辑：玩家 → 子弹 → 蜂群/Boss → 碰撞 → 波次判定
 * @param {number} dt 距上一帧经过的秒数
 */
function updateGame(dt) {
    // 恢复快照的暂停遮罩提示语只在恢复后的首个续玩帧清除，之后再次手动暂停不再展示
    if (restoredNotice) restoredNotice = '';
    // ---- 玩家移动：键盘/鼠标等效方向恒速移动（等同按键手感），鼠标静止即零输入零移动；冲刺期间沿冲刺方向高速位移 ----
    // 推进鼠标等效方向倒计时：持续无新移动则超时归零（模拟松键），飞船随之静止
    if (mouseDirTimer > 0) {
        mouseDirTimer -= dt;
        if (mouseDirTimer <= 0) mouseDir = 0;
    }
    const keyDir = keyAxis();
    // 键盘优先，其次鼠标等效方向；二者均为恒速 PLAYER_SPEED，手感与按键一致
    const moveX = keyDir !== 0 ? keyDir : mouseDir;
    if (moveX !== 0) facing = moveX;
    if (dashTimer > 0) {
        dashTimer -= dt;
        player.x += dashDir * DASH_SPEED * dt;
        // 逐帧记录残影，短寿命淡出形成拖尾
        dashGhosts.push({ x: player.x, y: player.y, t: 0, life: 0.22 });
    } else if (moveX !== 0) {
        player.x += moveX * PLAYER_SPEED * dt;
    }
    player.x = Math.max(0, Math.min(viewW - PLAYER_W, player.x));

    // ---- 引擎尾焰：船尾持续喷出粒子，冲刺时喷射量增大且带甩尾 ----
    // 复用全局粒子容器；冲刺中每帧 3 粒、平时 1 粒；
    // 减弱动态效果下装饰性尾焰跳过、冲刺时仅保留 1 粒以示冲刺状态
    const flameCount = FX.prefersReduced
        ? (dashTimer > 0 ? 1 : 0)
        : (dashTimer > 0 ? 3 : 1);
    for (let i = 0; i < flameCount; i++) {
        const p = particlePool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = player.x + PLAYER_W / 2 + (Math.random() - 0.5) * 8;
        p.y = player.y + PLAYER_H;
        // 冲刺时粒子获得与冲刺方向相反的横向速度，形成甩尾
        p.vx = -dashDir * 60 + (Math.random() - 0.5) * 30;
        p.vy = 80 + Math.random() * 60;
        p.life = dashTimer > 0 ? 0.18 : 0.28;
        p.maxLife = p.life;
        p.color = Math.random() < 0.7 ? '#35e0ff' : '#e8e8ff';
        p.size = 2;
    }

    // ---- 射击冷却与开火 ----
    fireCooldown = Math.max(0, fireCooldown - dt);
    // 空格或鼠标左键（游戏中按住左键）均可触发连发
    if (keys['Space'] || (mouseFire && gameState === 'playing')) playerFire();

    // ---- 无敌与连击窗口倒计时 ----
    invincibleTimer = Math.max(0, invincibleTimer - dt);
    if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
            comboCount = 0;
            comboMult = 1;
        }
    }

    // ---- 道具时限倒计时：时停 / 磁铁 / 激光 ----
    enemyFreezeTimer = Math.max(0, enemyFreezeTimer - dt);
    magnetTimer = Math.max(0, magnetTimer - dt);
    if (laserTimer > 0) {
        laserTimer -= dt;
        // 激光按固定节拍对截面内敌人结算伤害
        laserTickTimer -= dt;
        if (laserTickTimer <= 0) {
            laserTickTimer = LASER_TICK;
            fireLaserTick();
        }
    }

    // ---- 冲刺冷却与残影衰减：冷却跨零瞬间播放就绪提示音 ----
    if (dashCdTimer > 0) {
        dashCdTimer = Math.max(0, dashCdTimer - dt);
        if (dashCdTimer === 0) SFX.beeDashReady();
    }
    for (let i = dashGhosts.length - 1; i >= 0; i--) {
        dashGhosts[i].t += dt;
        if (dashGhosts[i].t >= dashGhosts[i].life) dashGhosts.splice(i, 1);
    }
    // 成就：单局分数最佳值实时回写（超越历史最佳才落盘，挂靠的 score10k 由共享层连带解锁）
    Ach.trackRunStat('score', Math.floor(score));

    // ---- 玩家子弹飞行，出屏移除 ----
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bl = bullets[i];
        bl.y -= BULLET_SPEED * dt;
        bl.x += bl.vx * dt;
        if (bl.y < -10 || bl.x < -10 || bl.x > viewW + 10) bullets.splice(i, 1);
    }

    // ---- 敌方子弹飞行，出屏移除（时停期间冻结） ----
    if (enemyFreezeTimer <= 0) {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const bl = enemyBullets[i];
            bl.x += bl.vx * dt;
            bl.y += bl.vy * dt;
            if (bl.y > viewH + 10 || bl.y < -20 || bl.x < -20 || bl.x > viewW + 20) enemyBullets.splice(i, 1);
        }
    }

    // ---- 道具下落与拾取 ----
    for (let i = powerups.length - 1; i >= 0; i--) {
        const p = powerups[i];
        const dx = player.x + PLAYER_W / 2 - p.x;
        const dy = player.y + PLAYER_H / 2 - p.y;
        const dist = Math.hypot(dx, dy);
        if (magnetTimer > 0 && dist < MAGNET_RADIUS && dist > 1) {
            // 磁铁吸引：沿指向玩家的方向匀速牵引
            p.x += dx / dist * MAGNET_PULL_SPEED * dt;
            p.y += dy / dist * MAGNET_PULL_SPEED * dt;
        } else {
            p.y += POWERUP_FALL_SPEED * dt;
        }
        if (p.y > viewH + POWERUP_SIZE) {
            powerups.splice(i, 1);
        } else if (isHit(p.x - POWERUP_SIZE / 2, p.y - POWERUP_SIZE / 2, POWERUP_SIZE, POWERUP_SIZE,
            player.x + 2, player.y + 2, PLAYER_W - 4, PLAYER_H - 4)) {
            powerups.splice(i, 1);
            applyPowerup(p);
        }
    }

    // ---- 蜂群分支更新：时停冻结 / Boss 波走 Boss 逻辑 / 普通波走蜂群逻辑 ----
    if (enemyFreezeTimer > 0) {
        // 时间静止：敌阵与敌方开火全部冻结，玩家仍可自由输出
    } else if (boss) {
        updateBoss(dt);
    } else {
        updateSwarm(dt);
    }

    // ---- 玩家子弹 vs 蜜蜂/Boss 碰撞 ----
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bl = bullets[i];
        let consumed = false;
        // 命中 Boss：扣血，子弹消耗（警告演出阶段 Boss 隐于画外，不参与判定）
        if (boss && boss.phase !== 'warn' && isHit(bl.x - 2, bl.y - 8, 4, 8, boss.x, boss.y, BOSS_W, BOSS_H)) {
            hitBoss();
            bullets.splice(i, 1);
            continue;
        }
        // 命中蜜蜂：精英蜂先扣血，血量归零才击落
        for (const b of bees) {
            if (!b.alive) continue;
            if (isHit(bl.x - 2, bl.y - 8, 4, 8, b.x, b.y, wOf(b), hOf(b))) {
                b.hp--;
                if (b.hp <= 0) {
                    killBee(b);
                } else {
                    // 精英蜂受击未死：火花反馈 + 低频钝响
                    spawnBurst(bl.x, bl.y, '#e8e8ff', 3, 100);
                    SFX.beeArmorHit();
                }
                bullets.splice(i, 1);
                consumed = true;
                break;
            }
        }
        if (consumed) continue;
    }

    // ---- 敌方子弹 vs 玩家碰撞（时停期间冻结者无害） ----
    if (enemyFreezeTimer <= 0) {
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const bl = enemyBullets[i];
            if (isHit(bl.x - 2, bl.y, 4, 10, player.x + 4, player.y + 4, PLAYER_W - 8, PLAYER_H - 8)) {
                enemyBullets.splice(i, 1);
                hitPlayer();
                // hitPlayer 在碎盾/掉命时会清空整个敌弹数组，此时必须立即终止本帧遍历，
                // 否则后续迭代读到 undefined 抛异常、打断 rAF 主循环导致游戏永久卡死
                if (gameState !== 'playing' || enemyBullets.length === 0) return;
            }
        }
    }

    // ---- 俯冲蜜蜂 vs 玩家机体碰撞：同归于尽（时停期间冻结者无害） ----
    // 以快照长度遍历，避免碰撞结算中裂出的小蛋蜂被同帧误判
    if (enemyFreezeTimer <= 0) {
        const beeCount = bees.length;
        for (let i = 0; i < beeCount; i++) {
            const b = bees[i];
            if (b.alive && b.diving &&
                isHit(b.x, b.y, wOf(b), hOf(b), player.x + 4, player.y + 4, PLAYER_W - 8, PLAYER_H - 8)) {
                killBee(b);
                hitPlayer();
                if (gameState !== 'playing') return;
            }
        }
    }

    // ---- 波次推进：敌阵清空则结算并进入下一波 ----
    if (boss) {
        // Boss 仍在场：继续战斗
    } else if (wave % 5 === 0) {
        // Boss 波且 Boss 已被击败（hitBoss 中置 null）：立即结算进入下一波
        nextWave();
    } else if (bees.length > 0 && bees.every(b => !b.alive)) {
        nextWave();
    }
}

/**
 * 推进蜂群（普通波）：编队位移、俯冲触发、归队降落、
 * 碰壁下压、定时投弹与触底判定
 * @param {number} dt 帧间隔秒数
 */
function updateSwarm(dt) {
    // ---- 编队横移 ----
    swarmOffsetX += swarmDir * swarmSpeed * dt;

    // ---- 定时触发俯冲 ----
    diveTimer -= dt;
    if (diveTimer <= 0) {
        triggerDive();
        // 间隔随波次缩短，并保留随机性避免机械感；俯冲潮事件下大幅缩短；难度除数整体收紧
        diveTimer = Math.max(
            waveEvent === 'tide' ? 0.55 : 1.1,
            DIVE_INTERVAL * Math.pow(0.93, wave - 1) * (0.7 + Math.random() * 0.6) * (waveEvent === 'tide' ? TIDE_DIVE_MULT : 1) / diffCfg.dive
        );
    }

    // ---- 蜂群定时投放子弹（仅编队中的蜜蜂） ----
    enemyFireTimer -= dt;
    if (enemyFireTimer <= 0) {
        formationFire();
        enemyFireTimer = ENEMY_FIRE_INTERVAL / (1 + (wave - 1) * 0.15) * (0.5 + Math.random()) / diffCfg.fire;
    }

    // ---- 逐只更新位置：编队吸附 / 归队降落 / 俯冲自由运动 ----
    let minX = Infinity;
    let maxX = -Infinity;
    for (const b of bees) {
        if (!b.alive) continue;
        if (b.diving) {
            updateDive(b, dt);
        } else if (b.reenter) {
            // 归队：横向吸附编队位，纵向自顶部降落到编队位
            b.x = slotXOf(b);
            b.y += RETURN_SPEED * dt;
            if (b.y >= slotYOf(b)) {
                b.y = slotYOf(b);
                b.reenter = false;
            }
        } else {
            b.x = slotXOf(b);
            b.y = slotYOf(b);
        }
        // 碰壁边界只统计编队中的蜜蜂（俯冲/归队不参与）
        if (!b.diving && !b.reenter) {
            if (b.x < minX) minX = b.x;
            if (b.x + BEE_W > maxX) maxX = b.x + BEE_W;
        }
    }

    // ---- 碰壁反向 + 整体下压（低沉钝响提示压迫感逼近） ----
    if (minX <= 0 || maxX >= viewW) {
        swarmDir *= -1;
        swarmOffsetX += swarmDir * 2;
        swarmDescend += SWARM_DESCEND;
        SFX.beeThud();
    }

    // ---- 触底判定：编队与归队蜜蜂压到玩家所在高度即失败（俯冲者另有碰撞） ----
    for (const b of bees) {
        if (b.alive && !b.diving && b.y + BEE_H >= player.y) {
            // 无敌档：触底不判负，仅将下压累计量归零，编队蜜蜂（每帧按 slotYOf 吸附）
            // 随即整体弹回初始编队高度，避免持续下压出屏与玩家永久重叠
            if (difficulty === 'invincible') {
                swarmDescend = 0;
                return;
            }
            endGame();
            return;
        }
    }
}

/**
 * 推进 Boss：警告演出 → 缓降入场 → 正弦游走、定时瞄准弹与扇形弹幕；
 * 狂暴状态下开火间隔缩短为 0.65 倍
 * @param {number} dt 帧间隔秒数
 */
function updateBoss(dt) {
    // ---- 警告演出：警戒横幅与警报鸣响期间 Boss 隐于画外，全程低频震屏施压 ----
    if (boss.phase === 'warn') {
        boss.warnTimer -= dt;
        shakeTime = Math.max(shakeTime, 0.06);
        shakeMag = Math.max(shakeMag, 2);
        if (boss.warnTimer <= 0) boss.phase = 'enter';
        return;
    }
    boss.t += dt;
    // 受击闪白衰减
    boss.flash = Math.max(0, boss.flash - dt);
    // ---- 缓降入场：自顶部匀速降落至战斗位，喷口持续喷吐尾焰，期间不开火不游走 ----
    if (boss.phase === 'enter') {
        boss.y += BOSS_ENTER_SPEED * dt;
        // 引擎尾焰：机体下方喷口每帧喷出金橙短命粒子，随机体下坠拖出光尾
        const exhaust = FX.prefersReduced ? 1 : 2;
        for (let i = 0; i < exhaust; i++) {
            const p = particlePool.obtain();
            p.x = boss.x + BOSS_W / 2 + (Math.random() - 0.5) * 20;
            p.y = boss.y + BOSS_H - 4;
            p.vx = (Math.random() - 0.5) * 40;
            p.vy = 120 + Math.random() * 80;
            p.life = 0.25 + Math.random() * 0.15;
            p.maxLife = p.life;
            p.color = Math.random() < 0.5 ? '#ffd23e' : '#ff7b2e';
            p.size = 3;
        }
        if (boss.y >= boss.targetY) {
            boss.y = boss.targetY;
            boss.phase = 'fight';
            // 落地冲击：顿帧 + 震屏 + 尘爆 + 扩散冲击环 + 落地巨响，登场仪式收束
            freezeTimer = Math.max(freezeTimer, BOSS_LAND_FREEZE);
            shakeTime = Math.max(shakeTime, BOSS_LAND_SHAKE_TIME);
            shakeMag = Math.max(shakeMag, BOSS_LAND_SHAKE_MAG);
            bossShockTimer = BOSS_SHOCK_TIME;
            // 尘爆：触地点向左右两侧交替激起的尘土粒子
            const dust = FX.prefersReduced ? Math.ceil(BOSS_LAND_DUST / 2) : BOSS_LAND_DUST;
            for (let i = 0; i < dust; i++) {
                const p = particlePool.obtain();
                const dir = i % 2 === 0 ? -1 : 1;
                p.x = boss.x + BOSS_W / 2 + dir * BOSS_W / 2 * Math.random();
                p.y = boss.y + BOSS_H;
                p.vx = dir * (60 + Math.random() * 160);
                p.vy = -(20 + Math.random() * 90);
                p.life = 0.4 + Math.random() * 0.3;
                p.maxLife = p.life;
                p.color = Math.random() < 0.5 ? '#cfd8ea' : '#8a93a8';
                p.size = 2 + Math.random() * 2;
            }
            // 全屏震动已由上方 shakeTime/shakeMag（BOSS_LAND_SHAKE_*）承担，不再叠加 FX.shake
            SFX.beeBossLand();
        }
        return;
    }
    // 水平正弦游走（两端留边距），纵向缓慢沉浮
    boss.x = viewW / 2 - BOSS_W / 2 + Math.sin(boss.t * 0.9) * (viewW / 2 - BOSS_W / 2 - 16);
    boss.y = 70 + (Math.sin(boss.t * 0.45) + 1) * 18;

    // 狂暴倍率：开火间隔缩短，压迫感陡增
    const rageMult = boss.enraged ? 0.65 : 1;
    // 瞄准单发
    boss.aimTimer -= dt;
    if (boss.aimTimer <= 0) {
        bossAimedShot(ENEMY_BULLET_SPEED + 40);
        boss.aimTimer = Math.max(0.6, (BOSS_AIM_INTERVAL - (wave - 5) * 0.04) * rageMult);
    }
    // 扇形弹幕
    boss.fanTimer -= dt;
    if (boss.fanTimer <= 0) {
        bossFanShot();
        boss.fanTimer = Math.max(1.1, (BOSS_FAN_INTERVAL - (wave - 5) * 0.06) * rageMult);
    }
}

/**
 * 刷新 HUD 显示（分数 / 波次 / 生命）
 */
function updateHud() {
    FX.tweenNumber(scoreElement, score, 128, v => `SCORE ${v}`); // 分数数字滚动过渡（128ms 快速插值）
    waveElement.textContent = `WAVE ${wave}`;
    livesElement.textContent = `LIVES ${lives}`;
}

/* ===================== 特效 ===================== */

/**
 * 生成一团爆裂粒子
 * @param {number} x 爆心 x
 * @param {number} y 爆心 y
 * @param {string} color 粒子颜色
 * @param {number} count 粒子数量
 * @param {number} speed 初始速度上限（像素/秒）
 */
function spawnBurst(x, y, color, count, speed) {
    // 减弱动态效果：粒子数量减半，保留功能性命中/爆炸反馈（参数 count 被就地重赋值）
    if (FX.prefersReduced) count = Math.ceil(count / 2);
    for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = Math.random() * speed;
        const p = particlePool.obtain(); // 从池中取粒（满员时自动征用最旧粒子，演出永不断流）
        p.x = x;
        p.y = y;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 40;
        p.life = 0.3 + Math.random() * 0.35;
        p.maxLife = p.life;
        p.color = color;
        p.size = 2 + Math.random() * 2.5;
    }
}

/**
 * 添加一条上浮渐隐的飘字
 * @param {number} x 飘字中心 x
 * @param {number} y 飘字起始 y
 * @param {string} text 文本内容
 * @param {string} color 文本颜色
 * @param {number} [life] 存活时长（秒），默认 FLOAT_LIFE
 */
function addFloatText(x, y, text, color, life = FLOAT_LIFE) {
    floatTexts.push({ x, y, text, color, t: 0, life });
}

/**
 * 推进特效计时：粒子受重力下落、飘字上浮，超时移除；
 * 屏幕震动/炸弹白闪/受击红闪/金色脉冲随时间衰减，
 * 波次横幅播毕移除，Boss 连环殉爆倒计时归零即爆开，
 * 落地冲击环扩散淡出（成就 toast 由 DOM 定时器自理，不经本函数）
 * @param {number} dt 帧间隔秒数
 */
function updateEffects(dt) {
    // 粒子推进：池活跃区正向遍历，sweep 回收死粒零分配
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        p.life -= dt;
        p.vy += PARTICLE_GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
    particlePool.sweep();
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const f = floatTexts[i];
        f.t += dt;
        if (f.t >= f.life) floatTexts.splice(i, 1);
    }
    shakeTime = Math.max(0, shakeTime - dt);
    // 炸弹白闪随剩余时间淡出
    bombFlashTimer = Math.max(0, bombFlashTimer - dt);
    // 受击红闪 / 连击金色脉冲计时衰减
    hurtFlashTimer = Math.max(0, hurtFlashTimer - dt);
    goldPulseTimer = Math.max(0, goldPulseTimer - dt);
    // Boss 血条失白闪烁随时间衰减
    bossHurtFlash = Math.max(0, bossHurtFlash - dt);
    // Boss 落地冲击环随时间扩散淡出
    bossShockTimer = Math.max(0, bossShockTimer - dt);
    // 波次横幅计时推进，播毕移除
    if (waveBanner) {
        waveBanner.t += dt;
        if (waveBanner.t >= waveBanner.life) waveBanner = null;
    }
    // Boss 连环殉爆：倒计时归零时原地爆开（金橙随机色 + 微震 + 爆音）
    for (let i = explosions.length - 1; i >= 0; i--) {
        const ex = explosions[i];
        ex.delay -= dt;
        if (ex.delay <= 0) {
            explosions.splice(i, 1);
            const color = Math.random() < 0.5 ? '#ffd23e' : '#ff7b2e';
            spawnBurst(ex.x, ex.y, color, 14, 220);
            shakeTime = Math.max(shakeTime, 0.1);
            shakeMag = Math.max(shakeMag, 3);
            SFX.beeBoom();
        }
    }
}

/* ===================== 绘制 ===================== */

/**
 * 绘制一帧：星空背景 → 道具 → 蜂群 → Boss → 冲刺残影 → 玩家 →
 * 双方子弹 → 粒子与飘字 → 时停/受击/横幅等状态覆盖层
 * （整体随屏幕震动偏移）
 */
function render() {
    ctx.save();
    // 屏幕震动：随机偏移画布原点（减弱动态效果下跳过，避免眩晕）
    if (shakeTime > 0 && !FX.prefersReduced) {
        ctx.translate((Math.random() - 0.5) * 2 * shakeMag, (Math.random() - 0.5) * 2 * shakeMag);
    }

    // ---- 背景：纯色底 + 三层视差滚动星空（零状态，任何阶段都持续流动） ----
    ctx.fillStyle = '#1a0f14';
    ctx.fillRect(-10, -10, viewW + 20, viewH + 20);
    // 用墙钟时间驱动滚动，顿帧/开始/结束界面星空也不停摆
    const nowS = performance.now() / 1000;
    for (const s of STARS) {
        const sy = (s.y + nowS * STAR_SPEEDS[s.layer]) % viewH;
        ctx.fillStyle = `rgba(232, 232, 255, ${STAR_ALPHAS[s.layer]})`;
        ctx.fillRect(s.x, sy, STAR_SIZES[s.layer], STAR_SIZES[s.layer]);
    }

    // ---- 道具：彩色方块 + 字母标识（样式取自 POWERUP_STYLE 表） ----
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of powerups) {
        const style = POWERUP_STYLE[p.type];
        ctx.fillStyle = style.color;
        ctx.fillRect(p.x - POWERUP_SIZE / 2, p.y - POWERUP_SIZE / 2, POWERUP_SIZE, POWERUP_SIZE);
        ctx.fillStyle = '#0d1420';
        ctx.fillText(style.label, p.x, p.y + 1);
    }

    // ---- 蜂群：按蜂种配色绘制（普通/精英/分裂/自爆/小蛋蜂） ----
    for (const b of bees) {
        if (!b.alive) continue;
        const bw = wOf(b);
        const bh = hOf(b);
        // 各蜂种配色：身体 / 翅膀 / 眼睛（小蛋蜂沿用比例缩放的通用造型）
        const bodyColor = b.type === 'elite' ? '#ff3ea5'
            : b.type === 'splitter' ? '#7dff5a'
            : b.type === 'bomber' ? '#ff7b2e'
            : b.type === 'mini' ? '#ffe98a' : '#ffd23e';
        const wingColor = b.type === 'elite' ? '#ffd6ec' : '#e8e8ff';
        const eyeColor = b.type === 'elite' ? '#ffd23e'
            : b.type === 'bomber' ? '#ff2222' : '#0d1420';
        // 翅膀（两侧，按体型比例定位）
        ctx.fillStyle = wingColor;
        ctx.fillRect(b.x + bw * 0.08, b.y + bh * 0.2, bw * 0.2, bh * 0.36);
        ctx.fillRect(b.x + bw * 0.72, b.y + bh * 0.2, bw * 0.2, bh * 0.36);
        // 身体
        ctx.fillStyle = bodyColor;
        ctx.fillRect(b.x + bw * 0.2, b.y + bh * 0.1, bw * 0.6, bh * 0.72);
        // 深色条纹两道
        ctx.fillStyle = '#0d1420';
        ctx.fillRect(b.x + bw * 0.32, b.y + bh * 0.18, bw * 0.1, bh * 0.55);
        ctx.fillRect(b.x + bw * 0.58, b.y + bh * 0.18, bw * 0.1, bh * 0.55);
        // 眼睛
        ctx.fillStyle = eyeColor;
        ctx.fillRect(b.x + bw * 0.25, b.y + bh * 0.62, 3, 3);
        ctx.fillRect(b.x + bw * 0.65, b.y + bh * 0.62, 3, 3);
        // 分裂蜂身体中线：暗示“一分为二”
        if (b.type === 'splitter') {
            ctx.fillStyle = '#e8ffe0';
            ctx.fillRect(b.x + bw / 2 - 1, b.y + 2, 2, bh - 4);
        }
        // 自爆蜂俯冲时头顶引信高频闪烁示警
        if (b.type === 'bomber') {
            ctx.fillStyle = b.diving && Math.floor(performance.now() / 90) % 2 === 0 ? '#ff2222' : '#ffd23e';
            ctx.fillRect(b.x + bw / 2 - 2, b.y - 4, 4, 4);
        }
        // 精英蜂头顶王冠标记（区分度）
        if (b.type === 'elite') {
            ctx.fillStyle = '#ffd23e';
            ctx.fillRect(b.x + bw / 2 - 4, b.y - 3, 8, 3);
        }
    }

    // ---- Boss：大型蜂王 + 顶部血条（狂暴时通体赤红 + 眼睛转金）；
    //      警告演出阶段 Boss 隐于画外不绘制，血条待落地进入战斗后才亮出 ----
    if (boss && boss.phase !== 'warn') {
        const bx = boss.x;
        const by = boss.y;
        // 翅膀
        ctx.fillStyle = boss.enraged ? '#ffb3b3' : '#ffd6ec';
        ctx.fillRect(bx + 2, by + 10, 16, 20);
        ctx.fillRect(bx + BOSS_W - 18, by + 10, 16, 20);
        // 身体（狂暴变红）
        ctx.fillStyle = boss.enraged ? '#ff2222' : '#ff3ea5';
        ctx.fillRect(bx + 14, by + 4, BOSS_W - 28, BOSS_H - 12);
        // 条纹
        ctx.fillStyle = '#0d1420';
        ctx.fillRect(bx + 22, by + 8, 6, BOSS_H - 20);
        ctx.fillRect(bx + 35, by + 8, 6, BOSS_H - 20);
        ctx.fillRect(bx + 48, by + 8, 6, BOSS_H - 20);
        // 眼睛（常态红，狂暴转金以示狂性）
        ctx.fillStyle = boss.enraged ? '#ffd23e' : '#ff2222';
        ctx.fillRect(bx + 22, by + BOSS_H - 18, 6, 6);
        ctx.fillRect(bx + BOSS_W - 28, by + BOSS_H - 18, 6, 6);
        // 王冠
        ctx.fillStyle = '#ffd23e';
        ctx.fillRect(bx + BOSS_W / 2 - 14, by - 6, 28, 5);
        // 受击闪白：覆盖躯干区域，随剩余时间快速淡出
        if (boss.flash > 0) {
            ctx.globalAlpha = Math.min(1, boss.flash / 0.06) * 0.8;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(bx + 14, by + 4, BOSS_W - 28, BOSS_H - 12);
            ctx.globalAlpha = 1;
        }
        // 血条：画布顶部居中（狂暴时描红边警示），蜜橙→深红渐变填充（落地进入战斗后才亮出）
        if (boss.phase === 'fight') {
            const barW = 260;
            const barX = (viewW - barW) / 2;
            ctx.fillStyle = 'rgba(232, 232, 255, 0.15)';
            ctx.fillRect(barX, 14, barW, 8);
            const hpFrac = Math.max(0, boss.hp / boss.maxHp);
            // 渐变填充：从蜜橙过渡到深红，血量越低视觉压迫感越强；
            // 渐变为水平方向且血条宽度固定，几何仅由 barX 决定（随画布宽度变化），
            // 按 barX 缓存渐变对象，参数不变直接复用，避免 Boss 战每帧新建渐变
            if (bossHpGradX !== barX) {
                bossHpGradX = barX;
                bossHpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                bossHpGrad.addColorStop(0, '#ff7b2e');
                bossHpGrad.addColorStop(1, '#ff2222');
            }
            ctx.fillStyle = bossHpGrad;
            ctx.fillRect(barX, 14, barW * hpFrac, 8);
            // 失血白色闪烁：刚被击中时在当前血量区域叠白光，随剩余时间快速淡出
            if (bossHurtFlash > 0) {
                ctx.globalAlpha = Math.min(1, bossHurtFlash / BOSS_HURT_FLASH_TIME) * 0.8;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(barX, 14, barW * hpFrac, 8);
                ctx.globalAlpha = 1;
            }
            if (boss.enraged) {
                ctx.strokeStyle = 'rgba(255, 34, 34, 0.8)';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX - 1.5, 12.5, barW + 3, 11);
            }
        }
    }

    // ---- Boss 落地冲击环：自机体底部向两侧扩散的椭圆冲击波，随剩余时间淡出 ----
    if (bossShockTimer > 0 && boss) {
        const shockProg = 1 - bossShockTimer / BOSS_SHOCK_TIME;
        ctx.globalAlpha = (1 - shockProg) * 0.7;
        ctx.strokeStyle = '#ffd23e';
        ctx.lineWidth = 1 + 3 * (1 - shockProg);
        ctx.beginPath();
        ctx.ellipse(boss.x + BOSS_W / 2, boss.y + BOSS_H,
            BOSS_W * 0.5 + shockProg * 160, 6 + shockProg * 26, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // ---- 冲刺残影：青色半透明三角随寿命淡出，形成瞬身拖尾 ----
    for (const g of dashGhosts) {
        ctx.globalAlpha = (1 - g.t / g.life) * 0.35;
        ctx.fillStyle = '#35e0ff';
        ctx.beginPath();
        ctx.moveTo(g.x + PLAYER_W / 2, g.y);
        ctx.lineTo(g.x + PLAYER_W, g.y + PLAYER_H);
        ctx.lineTo(g.x, g.y + PLAYER_H);
        ctx.closePath();
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- 玩家：无敌期闪烁，青色三角飞船 + 护盾光环 ----
    const blinkHide = invincibleTimer > 0 && Math.floor(invincibleTimer * 10) % 2 === 0;
    if (!blinkHide) {
        ctx.fillStyle = '#35e0ff';
        ctx.beginPath();
        ctx.moveTo(player.x + PLAYER_W / 2, player.y);
        ctx.lineTo(player.x + PLAYER_W, player.y + PLAYER_H);
        ctx.lineTo(player.x, player.y + PLAYER_H);
        ctx.closePath();
        ctx.fill();
        // 驾驶舱
        ctx.fillStyle = '#0d1420';
        ctx.fillRect(player.x + PLAYER_W / 2 - 3, player.y + 8, 6, 6);
        // 护盾光环（青色圆环）
        if (hasShield) {
            ctx.strokeStyle = 'rgba(53, 224, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, 26, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // ---- 激光光柱：从机鼻贯穿至画布顶部，外晕+高亮芯柱随时间脉动 ----
    if (laserTimer > 0) {
        const cx = player.x + PLAYER_W / 2;
        const pulse = 0.7 + Math.sin(performance.now() / 60) * 0.3;
        ctx.fillStyle = 'rgba(240, 246, 255, 0.3)';
        ctx.fillRect(cx - LASER_WIDTH / 2, 0, LASER_WIDTH, player.y);
        ctx.fillStyle = `rgba(240, 246, 255, ${0.85 * pulse})`;
        ctx.fillRect(cx - 2, 0, 4, player.y);
    }
    // ---- 磁铁光环：金色动态圆环提示吸引范围生效中 ----
    if (magnetTimer > 0) {
        ctx.strokeStyle = 'rgba(255, 210, 62, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2,
            30 + Math.sin(performance.now() / 150) * 4, 0, Math.PI * 2);
        ctx.stroke();
    }
    // ---- 冲刺冷却条：飞船下方细条，随冷却恢复逐渐填满 ----
    if (dashCdTimer > 0) {
        const cdRatio = 1 - dashCdTimer / DASH_COOLDOWN;
        ctx.fillStyle = 'rgba(232, 232, 255, 0.2)';
        ctx.fillRect(player.x, player.y + PLAYER_H + 5, PLAYER_W, 3);
        ctx.fillStyle = '#35e0ff';
        ctx.fillRect(player.x, player.y + PLAYER_H + 5, PLAYER_W * cdRatio, 3);
    }

    // ---- 玩家子弹：绿色竖条 ----
    ctx.fillStyle = '#39ff6a';
    for (const bl of bullets) ctx.fillRect(bl.x - 2, bl.y - 8, 4, 8);

    // ---- 敌方子弹：粉色竖条 ----
    ctx.fillStyle = '#ff3ea5';
    for (const bl of enemyBullets) ctx.fillRect(bl.x - 2, bl.y, 4, 10);

    // ---- 粒子：随生命进度渐隐（尺寸恒定，池活跃区遍历） ----
    for (let i = 0; i < particlePool.n; i++) {
        const p = particlePool.items[i];
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // ---- 飘字：上浮渐隐，Press Start 2P 像素字 ----
    ctx.font = '10px "Press Start 2P", monospace';
    for (const f of floatTexts) {
        const progress = f.t / f.life;
        ctx.globalAlpha = 1 - progress;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y - progress * 28);
    }
    ctx.globalAlpha = 1;

    // ---- 时停提示边框：生效中常亮，最后 1 秒闪烁预警 ----
    if (enemyFreezeTimer > 0 &&
        (enemyFreezeTimer > 1 || Math.floor(enemyFreezeTimer * 6) % 2 === 0)) {
        ctx.strokeStyle = 'rgba(179, 136, 255, 0.7)';
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, viewW - 3, viewH - 3);
    }
    // ---- 受击红闪：双层粗边框随剩余时间快速淡出，强化掉血反馈 ----
    if (hurtFlashTimer > 0) {
        const hf = Math.min(1, hurtFlashTimer / 0.4) * 0.55;
        ctx.strokeStyle = `rgba(255, 34, 34, ${hf})`;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, viewW - 10, viewH - 10);
        ctx.strokeStyle = `rgba(255, 34, 34, ${hf * 0.5})`;
        ctx.lineWidth = 20;
        ctx.strokeRect(10, 10, viewW - 20, viewH - 20);
    }
    // ---- 濒死警示：仅剩 1 条命时画布边缘红色呼吸脉动 ----
    if (lives === 1 && gameState === 'playing') {
        const breathe = 0.25 + Math.sin(performance.now() / 300) * 0.15;
        ctx.strokeStyle = `rgba(255, 34, 34, ${breathe})`;
        ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, viewW - 14, viewH - 14);
    }
    // ---- 连击金色脉冲：倍率提升瞬间全屏金色泛光淡出 ----
    if (goldPulseTimer > 0) {
        ctx.fillStyle = `rgba(255, 210, 62, ${goldPulseTimer / 0.3 * 0.12})`;
        ctx.fillRect(-10, -10, viewW + 20, viewH + 20);
    }

    // ---- 连击倍率角标：右上角金色常驻标识（倍率 > 1 时显示） ----
    if (comboMult > 1) {
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.font = '11px "Press Start 2P", monospace';
        ctx.fillStyle = '#ffd23e';
        ctx.fillText(`x${comboMult}`, viewW - 10, 32);
    }

    // ---- WAVE 开场横幅：入场滑入 + 尾声淡出，居中大字 ----
    if (waveBanner) {
        const wb = waveBanner;
        const progress = wb.t / wb.life;
        // 前 0.2 秒自左滑入定位，尾声 25% 时间淡出
        const enter = Math.min(1, wb.t / 0.2);
        const fade = progress > 0.75 ? 1 - (progress - 0.75) / 0.25 : 1;
        ctx.globalAlpha = Math.min(enter, fade);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '16px "Press Start 2P", monospace';
        ctx.fillStyle = wb.color;
        ctx.fillText(wb.text, viewW / 2 - (1 - enter) * 60, 200);
        ctx.globalAlpha = 1;
    }

    // ---- Boss 入场警告演出：上下红色警戒斜纹带滚动 + 中央 WARNING 高频闪烁 ----
    if (boss && boss.phase === 'warn' && gameState === 'playing') {
        // 上下警戒带：红底 + 随时间滚动的暗红斜纹，营造警报流动感
        for (const bandY of [0, viewH - 16]) {
            ctx.fillStyle = 'rgba(255, 34, 34, 0.25)';
            ctx.fillRect(-10, bandY, viewW + 20, 16);
            ctx.fillStyle = 'rgba(255, 62, 16, 0.6)';
            const stripeOff = (performance.now() / 6) % 24;
            for (let x = -24 + stripeOff; x < viewW + 24; x += 24) {
                ctx.beginPath();
                ctx.moveTo(x, bandY + 16);
                ctx.lineTo(x + 10, bandY);
                ctx.lineTo(x + 18, bandY);
                ctx.lineTo(x + 8, bandY + 16);
                ctx.closePath();
                ctx.fill();
            }
        }
        // 中央 WARNING 大字 5Hz 闪烁 + 副标题提示（隐现交替制造紧张感）
        if (Math.floor(boss.warnTimer * 5) % 2 === 0) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '20px "Press Start 2P", monospace';
            ctx.fillStyle = '#ff2222';
            ctx.fillText('WARNING', viewW / 2, 160);
            ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#ff3ea5';
            ctx.fillText('!! 巨型蜂王接近中 !!', viewW / 2, 188);
        }
    }

    // ---- 炸弹白闪：全屏白色覆盖随剩余时间淡出 ----
    if (bombFlashTimer > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, bombFlashTimer / BOMB_FLASH_TIME) * 0.85})`;
        ctx.fillRect(-10, -10, viewW + 20, viewH + 20);
    }


    // ---- 暂停遮罩已 DOM 化（#pauseScreen），显示逻辑收敛到 syncPauseOverlay ----

    ctx.restore();
}

/* ===================== 进度镜像快照 ===================== */

/** 进度快照在 localStorage 中的存档键（与游戏厅父页约定的命名；字面量统一收口于顶部 KEYS） */
const SAVE_KEY = KEYS.save;
/** 快照恢复成功的暂停遮罩提示语后缀：随恢复态展示，续玩首帧清除 */
let restoredNotice = '';

/**
 * 同步暂停遮罩 DOM：依据手动暂停/失焦暂停标记与游戏阶段，显示或隐藏暂停面板，
 * 并按标记刷新提示文案与恢复提示行（幂等，可在任意标记变化后调用）
 */
function syncPauseOverlay() {
    const show = (paused || blurPaused) && gameState === 'playing';
    pauseScreen.style.display = show ? 'block' : 'none';
    if (!show) return;
    // 提示文案按暂停来源区分：失焦暂停更醒目，避免玩家误以为游戏卡死
    pauseTipElement.textContent = blurPaused ? '窗口失焦已暂停 · 点击或按任意键继续' : '按 P 键或点击继续';
    // 恢复快照成功后首见遮罩时显示「已恢复上次进度」行（续玩首帧清除 restoredNotice 后不再显示）
    pauseRestoreTipElement.style.display = restoredNotice ? 'block' : 'none';
}

/**
 * 校验数值是否为有限数且处于闭区间 [min, max] 内
 * @param {*} v 待校验值（可能为任意脏数据）
 * @param {number} min 区间下界
 * @param {number} max 区间上界
 * @returns {boolean} 是否为区间内的有限数值
 */
function snapIsNum(v, min, max) {
    return typeof v === 'number' && isFinite(v) && v >= min && v <= max;
}

/**
 * 校验数值是否为区间 [min, max] 内的整数
 * @param {*} v 待校验值（可能为任意脏数据）
 * @param {number} min 区间下界
 * @param {number} max 区间上界
 * @returns {boolean} 是否为区间内的整数
 */
function snapIsInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
}

/**
 * 组装当前局进度镜像快照（纯数据：数值/字符串/布尔/数组，不含函数与 DOM）。
 * v 为首字段协议版本号，恢复时 v !== 1 即整体弃用；
 * 粒子/尾焰/震屏/飘字等纯视觉对象不入档，恢复后按状态清空重建。
 * @returns {object} 快照数据对象（字段与 validate/apply 校验恢复的字段一一对应）
 */
function buildBeeSnapshot() {
    return {
        v: 1,
        score,
        lives,
        wave,
        player: { x: player.x, y: player.y },
        weaponLevel,
        hasShield: !!hasShield,
        invincibleTimer,
        facing,
        dashCount,
        killCount,
        dashCdTimer,
        swarmDir,
        swarmSpeed,
        swarmOffsetX,
        swarmDescend,
        swarmBaseX,
        enemyFireTimer,
        diveTimer,
        enemyFreezeTimer,
        magnetTimer,
        laserTimer,
        laserTickTimer,
        comboCount,
        comboTimer,
        comboMult,
        nextLifeScore,
        livesAtWaveStart,
        waveEvent,
        bullets: bullets.map(b => ({ x: b.x, y: b.y, vx: b.vx })),
        enemyBullets: enemyBullets.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy })),
        powerups: powerups.map(p => ({ x: p.x, y: p.y, type: p.type })),
        bees: bees.map(b => ({
            col: b.col, row: b.row, type: b.type, hp: b.hp,
            alive: !!b.alive, diving: !!b.diving, reenter: !!b.reenter,
            x: b.x, y: b.y, vx: b.vx, vy: b.vy,
            dropped1: !!b.dropped1, dropped2: !!b.dropped2
        })),
        boss: boss ? {
            x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, t: boss.t,
            fanTimer: boss.fanTimer, aimTimer: boss.aimTimer,
            phase: boss.phase, warnTimer: boss.warnTimer, targetY: boss.targetY,
            flash: boss.flash, enraged: !!boss.enraged
        } : null
    };
}

// 存取管线由共享库 snap-common.js 驱动：游戏「进行中或暂停中」（gameState === 'playing'，
// 手动/失焦暂停均不改变该标记）→ 写入镜像（存储异常静默跳过）；
// 未开始/游戏结束界面 → 清除快照键（结束界面在 endGame 已清除，此处兜底）
const snapPipe = Snap.create({
    key: SAVE_KEY,
    canSave: () => gameState === 'playing',
    build: buildBeeSnapshot,
    validate: validateBeeSnapshot,
    apply: applyBeeSnapshot
});

/**
 * 校验快照逐字段类型/范围：协议版本号（v !== 1 即弃用）、画布坐标范围、
 * 血量/分数非负有限、敌人数组元素字段齐全、蜂种/Boss 相位/事件/道具枚举合法。
 * 布尔校验风格：非法一律返回 false 弃档，绝不因脏数据抛错
 * （与共享快照管线的兜底弃档契约一致）。
 * @param {object} s 待校验的快照对象（Arcade.loadJSON 产出，可能为任意脏数据）
 * @returns {boolean} 全部字段合法返回 true，任一非法返回 false
 */
function validateBeeSnapshot(s) {
    // ---- 顶层结构与协议版本校验 ----
    if (!s || typeof s !== 'object' || s.v !== 1) return false;
    // ---- 标量字段类型/范围校验：分数/生命/波次非负有限 ----
    if (!snapIsInt(s.score, 0, 1e9) || !snapIsInt(s.lives, 0, MAX_LIVES) || !snapIsInt(s.wave, 1, 9999)) return false;
    // ---- 玩家位置须在画布坐标范围内，武器等级 1~3，护盾为布尔 ----
    if (!s.player || !snapIsNum(s.player.x, 0, viewW) || !snapIsNum(s.player.y, 0, viewH)) return false;
    if (!snapIsInt(s.weaponLevel, 1, 3) || typeof s.hasShield !== 'boolean') return false;
    if (!snapIsNum(s.invincibleTimer, 0, 3600)) return false;
    if (s.facing !== 1 && s.facing !== -1) return false;
    if (!snapIsInt(s.dashCount, 0, 1e6) || !snapIsInt(s.killCount, 0, 1e6)) return false;
    if (!snapIsNum(s.dashCdTimer, 0, 3600)) return false;
    // ---- 蜂群波次进度状态校验 ----
    if (s.swarmDir !== 1 && s.swarmDir !== -1) return false;
    if (!snapIsNum(s.swarmSpeed, 0, 1000)) return false;
    if (!snapIsNum(s.swarmOffsetX, -1e5, 1e5) || !snapIsNum(s.swarmDescend, -1e5, 1e5) || !snapIsNum(s.swarmBaseX, -1e5, 1e5)) return false;
    // ---- 各类计时器：非负有限且在合理秒数上限内 ----
    if (!snapIsNum(s.enemyFireTimer, 0, 3600) || !snapIsNum(s.diveTimer, 0, 3600)) return false;
    if (!snapIsNum(s.enemyFreezeTimer, 0, 3600) || !snapIsNum(s.magnetTimer, 0, 3600) ||
        !snapIsNum(s.laserTimer, 0, 3600) || !snapIsNum(s.laserTickTimer, 0, 3600)) return false;
    // ---- 连击与里程碑字段校验 ----
    if (!snapIsInt(s.comboCount, 0, 1e6) || !snapIsNum(s.comboTimer, 0, 3600) || !snapIsInt(s.comboMult, 1, COMBO_MAX_MULT)) return false;
    if (!snapIsNum(s.nextLifeScore, 1, 1e9) || !snapIsInt(s.livesAtWaveStart, 0, MAX_LIVES)) return false;
    // ---- 事件波枚举校验 ----
    if (s.waveEvent !== null && s.waveEvent !== 'tide' && s.waveEvent !== 'eliteWall') return false;
    // ---- 玩家子弹数组校验：元素字段齐全且坐标在画布容差范围内 ----
    if (!Array.isArray(s.bullets) || s.bullets.length > 200) return false;
    for (const b of s.bullets) {
        if (!b || !snapIsNum(b.x, -100, viewW + 100) || !snapIsNum(b.y, -100, viewH + 100) || !snapIsNum(b.vx, -1000, 1000)) return false;
    }
    // ---- 敌方子弹数组校验 ----
    if (!Array.isArray(s.enemyBullets) || s.enemyBullets.length > 400) return false;
    for (const b of s.enemyBullets) {
        if (!b || !snapIsNum(b.x, -100, viewW + 100) || !snapIsNum(b.y, -100, viewH + 100) ||
            !snapIsNum(b.vx, -1000, 1000) || !snapIsNum(b.vy, -1000, 1000)) return false;
    }
    // ---- 场上道具数组校验：类型枚举须在 POWERUP_STYLE 表内 ----
    if (!Array.isArray(s.powerups) || s.powerups.length > 50) return false;
    for (const p of s.powerups) {
        if (!p || !snapIsNum(p.x, -100, viewW + 100) || !snapIsNum(p.y, -100, viewH + 100) || !POWERUP_STYLE[p.type]) return false;
    }
    // ---- 敌人数组校验：蜂种枚举合法、编队位在网格内、逐字段类型齐全；
    //      阵亡蜂允许 hp ≤ 0（击落瞬间残留值），存活蜂必须 hp ≥ 1 ----
    if (!Array.isArray(s.bees) || s.bees.length > 400) return false;
    for (const b of s.bees) {
        if (!b) return false;
        if (!snapIsInt(b.col, 0, BEE_COLS - 1) || !snapIsInt(b.row, 0, BEE_ROWS - 1)) return false;
        if (b.type !== 'normal' && b.type !== 'elite' && b.type !== 'splitter' && b.type !== 'bomber' && b.type !== 'mini') return false;
        if (!snapIsInt(b.hp, -99, 99) || (b.alive === true && b.hp < 1)) return false;
        if (typeof b.alive !== 'boolean' || typeof b.diving !== 'boolean' || typeof b.reenter !== 'boolean') return false;
        if (typeof b.dropped1 !== 'boolean' || typeof b.dropped2 !== 'boolean') return false;
        if (!snapIsNum(b.x, -100, viewW + 100) || !snapIsNum(b.y, -100, viewH + 100)) return false;
        if (!snapIsNum(b.vx, -1000, 1000) || !snapIsNum(b.vy, -1000, 1000)) return false;
    }
    // ---- Boss 状态校验（null 表示非 Boss 波或已击败；相位枚举三选一，hp 不超上限） ----
    if (s.boss !== null) {
        const bo = s.boss;
        if (!bo || typeof bo !== 'object') return false;
        if (bo.phase !== 'warn' && bo.phase !== 'enter' && bo.phase !== 'fight') return false;
        if (!snapIsNum(bo.x, -200, viewW + 200) || !snapIsNum(bo.y, -200, viewH + 200)) return false;
        if (!snapIsInt(bo.hp, 1, 9999) || !snapIsInt(bo.maxHp, 1, 9999) || bo.hp > bo.maxHp) return false;
        if (!snapIsNum(bo.t, 0, 1e7)) return false;
        if (!snapIsNum(bo.fanTimer, 0, 3600) || !snapIsNum(bo.aimTimer, 0, 3600) || !snapIsNum(bo.warnTimer, 0, 3600)) return false;
        if (!snapIsNum(bo.targetY, 0, viewH) || !snapIsNum(bo.flash, 0, 1)) return false;
        if (typeof bo.enraged !== 'boolean') return false;
    }
    return true;
}

/**
 * 将已通过校验的快照覆盖到游戏运行状态：const 数组原地重建，纯视觉对象
 * （粒子/飘字/横幅/震屏等）清空重建，刷新 HUD 并立即渲染一帧，
 * 标记「已恢复上次进度」提示（暂停遮罩首见时显示，续玩首帧清除）。
 * @param {object} s 已通过 validateBeeSnapshot 校验的快照对象
 * @returns {boolean} 恒返回 true（应用成功；意外抛错由管线兜底弃档）
 */
function applyBeeSnapshot(s) {
    // ---- 覆盖运行状态（bullets 等为 const 数组，须原地重建） ----
    score = s.score;
    lives = s.lives;
    wave = s.wave;
    player = { x: s.player.x, y: s.player.y };
    weaponLevel = s.weaponLevel;
    hasShield = s.hasShield;
    invincibleTimer = s.invincibleTimer;
    facing = s.facing;
    dashCount = s.dashCount;
    killCount = s.killCount;
    dashCdTimer = s.dashCdTimer;
    dashTimer = 0; // 冲刺位移不跨快照恢复：避免恢复瞬间高速漂移，冷却进度保留
    swarmDir = s.swarmDir;
    swarmSpeed = s.swarmSpeed;
    swarmOffsetX = s.swarmOffsetX;
    swarmDescend = s.swarmDescend;
    swarmBaseX = s.swarmBaseX;
    enemyFireTimer = s.enemyFireTimer;
    diveTimer = s.diveTimer;
    enemyFreezeTimer = s.enemyFreezeTimer;
    magnetTimer = s.magnetTimer;
    laserTimer = s.laserTimer;
    laserTickTimer = s.laserTickTimer;
    comboCount = s.comboCount;
    comboTimer = s.comboTimer;
    comboMult = s.comboMult;
    nextLifeScore = s.nextLifeScore;
    livesAtWaveStart = s.livesAtWaveStart;
    waveEvent = s.waveEvent;
    bullets.length = 0;
    for (const b of s.bullets) bullets.push({ x: b.x, y: b.y, vx: b.vx });
    enemyBullets.length = 0;
    for (const b of s.enemyBullets) enemyBullets.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    powerups.length = 0;
    for (const p of s.powerups) powerups.push({ x: p.x, y: p.y, type: p.type });
    bees.length = 0;
    for (const b of s.bees) {
        bees.push({
            col: b.col, row: b.row, type: b.type, hp: b.hp,
            alive: b.alive, diving: b.diving, reenter: b.reenter,
            x: b.x, y: b.y, vx: b.vx, vy: b.vy,
            dropped1: b.dropped1, dropped2: b.dropped2
        });
    }
    boss = s.boss ? {
        x: s.boss.x, y: s.boss.y, hp: s.boss.hp, maxHp: s.boss.maxHp, t: s.boss.t,
        fanTimer: s.boss.fanTimer, aimTimer: s.boss.aimTimer,
        phase: s.boss.phase, warnTimer: s.boss.warnTimer, targetY: s.boss.targetY,
        flash: s.boss.flash, enraged: s.boss.enraged
    } : null;
    bossHurtFlash = 0;
    // ---- 纯视觉对象不入档：恢复后清空重建，避免残留上一会话的演出残影 ----
    particlePool.clear();
    floatTexts.length = 0;
    dashGhosts.length = 0;
    explosions.length = 0;
    waveBanner = null;
    freezeTimer = 0;
    shakeTime = 0;
    shakeMag = 0;
    hurtFlashTimer = 0;
    goldPulseTimer = 0;
    bombFlashTimer = 0;
    bossShockTimer = 0;
    deathFxTimer = 0;
    deathFxShown = false;
    Ach.close(); // 成就墙强制收起：恢复存档从干净界面开始（常态已关则空操作）
    fireCooldown = 0;
    isNewRecord = false;
    // 键鼠输入态清零：恢复后从静止开始，避免残留方向脉冲或开火态
    for (const k in keys) delete keys[k];
    mouseDir = 0;
    mouseDirTimer = 0;
    mouseDx = 0;
    mouseFire = false;
    // 刷新 HUD 数值并立即渲染一帧，遮罩停留形态由调用方决定
    updateHud();
    render();
    restoredNotice = ' · 已恢复上次进度';
    return true;
}

/**
 * 从 localStorage 恢复进度镜像快照（薄壳）：读档 → 校验 → 应用的管线与
 * 失败清档兜底由共享库 snap-common.js 统一实现，绝不因脏数据抛错。
 * @returns {boolean} 是否成功恢复（true 表示已进入可续玩的恢复态）
 */
function restoreSnapshot() {
    return snapPipe.restore();
}

/* ===================== 主循环与输入 ===================== */

/** 上一帧时间戳（毫秒），用于计算帧间隔 */
let lastTime = 0;

/**
 * 主循环（下一帧排程前置于帧逻辑：先排程后执行，配合帧级 try/catch 守护，
 * 单帧异常只跳过该帧，渲染链永不中断）：顿帧期间冻结逻辑但仍渲染；
 * playing 阶段推进游戏与特效
 * @param {number} now 由 rAF 提供的时间戳（毫秒）
 */
function loop(now) {
    requestAnimationFrame(loop); // 前置排程：先预约下一帧，再执行本帧逻辑（单帧异常不再中断渲染循环）
    try {
        // 计算帧间隔（秒）并限幅，防止切后台回来时 dt 巨大导致穿透
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        if (freezeTimer > 0) {
            // 命中顿帧：冻结游戏逻辑制造打击停顿
            freezeTimer -= dt;
        } else if (gameState === 'playing' && !Ach.isOpen() && !blurPaused && !paused) {
            // 成就面板展开、失焦暂停或手动暂停期间挂起游戏逻辑，仅保留渲染
            updateGame(dt);
            updateEffects(dt);
        } else if (gameState === 'over' && deathFxTimer > 0) {
            // 死亡演出阶段：仅推进特效让爆裂/震动/闪白播放，逻辑已冻结
            updateEffects(dt);
            deathFxTimer -= dt;
            if (deathFxTimer <= 0) {
                // 演出播完：清零计时并二次进入 endGame 弹出结算面板
                deathFxTimer = 0;
                endGame();
            }
        }
        render();
    } catch (err) {
        // 帧级守护：单帧异常仅记录并跳过本帧，渲染循环照常运转（防一次意外抛错冻结画面）
        console.error('[bee] 渲染帧异常（已跳过本帧，循环继续）:', err);
    }
}

/**
 * 读取键盘水平输入（←/→ 或 A/D）
 * @returns {number} -1 左 / 1 右 / 0 无键盘输入
 */
function keyAxis() {
    if (keys['ArrowLeft'] || keys['KeyA']) return -1;
    if (keys['ArrowRight'] || keys['KeyD']) return 1;
    return 0;
}

/**
 * 读取等效水平输入方向（用于冲刺等需要瞬时方向的场景）：
 * 键盘优先；无键盘输入时采用鼠标等效方向（由主动移动脉冲产生，静止时为 0）
 * @returns {number} -1 左移 / 1 右移 / 0 无输入
 */
function moveAxis() {
    const keyDir = keyAxis();
    if (keyDir !== 0) return keyDir;
    return mouseDir;
}

// 鼠标移动监听挂 document（页面级）：movementX 为帧间位移、与光标所在元素无关，
// 因此页面任意位置（含游戏区外）移动鼠标都能持续控制飞船，移出画布不再中断操作；
// 累计 ≥2px 判定为主动移动，按方向设置等效按键并刷新保持窗口；跨窗口进入的巨大
// 跳变（|dx|>60）直接忽略。鼠标静止约 0.15s 后方向自动归零，飞船平滑停住，
// 既不锁光标也不隐藏光标，按钮/链接等 UI 点击完全不受影响
document.addEventListener('mousemove', e => {
    // 暂停中（失焦或手动）不更新方向状态：主循环已冻结、0.15s 保持窗口不再衰减，
    // 此时晃鼠标会把方向残留到恢复瞬间，导致飞船恢复后无故漂移
    if (paused || blurPaused) return;
    const dx = e.movementX || 0;
    // 忽略异常跳变（如鼠标从窗口外快速划入、系统指针重置）
    if (Math.abs(dx) > 60) return;
    mouseDx += dx;
    // 累计位移超过阈值：判定方向，刷新等效按键与保持倒计时
    if (Math.abs(mouseDx) >= 2) {
        mouseDir = mouseDx > 0 ? 1 : -1;
        mouseDirTimer = MOUSE_DIR_HOLD;
        mouseDx = 0;
    }
});
/* 暂停引擎收口共享库 pause-common.js：BGM/音效序列在库内统一，游戏侧注入差异件——
 * 双标记落点（blurPaused 只在失焦来源置真，供遮罩区分失焦/手动文案）与动态文案
 * 遮罩自理（overlay 不传，显隐收口在 syncPauseOverlay） */
const pausePipe = Pause.create({
    isPaused: () => blurPaused || paused, // 双标记合并读取：失焦或手动任一即暂停态
    canToggle: () => gameState === 'playing' && !Ach.isOpen(), // 手动切换准入（成就面板展开时不响应，避免面板开关状态错乱）
    setPaused: (p, byBlur) => {
        paused = p;
        blurPaused = p && byBlur; // 失焦来源置真：syncPauseOverlay 依此区分失焦/手动提示文案
        // 暂停与恢复瞬间都清空键鼠状态，防止切窗/暂停期间残留的移动/开火输入"卡住"
        for (const k in keys) delete keys[k];
        mouseFire = false;
        syncPauseOverlay(); // 同步暂停遮罩显隐与文案（手动/失焦提示区分）
    }
});

// 左键按下（监听 document）：游戏进行中在页面任意处按下均可持续射击，移出画布不中断；
// 点在按钮/链接上时不触发射击，避免误开 UI 功能
document.addEventListener('mousedown', e => {
    if (e.button !== 0 || gameState !== 'playing') return;
    // 排除按钮与链接（含"返回大厅"）：点击 UI 只操作 UI，不开火
    if (e.target.closest('button, a')) return;
    // 暂停中（失焦或手动）：本次按下仅作恢复用，不写入射击输入——恢复动作由
    // 下方 bindOverlayResume 完成，两监听此处分流不再嵌套调用
    if (blurPaused || paused) return;
    mouseFire = true;
});
// 暂停中按下即恢复收口共享库 Pause.bindOverlayResume（bee 模式：document 级
// mousedown 排除 button, a）。注册在上方射击监听之后——恢复按下先被射击监听
// 判定仍处暂停态并跳过（不写入射击输入），再由库内 resume 完成双标记清空 +
// BGM 续播 + UI 恢复音 + 遮罩同步
Pause.bindOverlayResume(pausePipe, { target: 'document', exclude: 'button, a' });
// 左键抬起（监听 document）：无论光标在哪松开都能正确停止射击，无"卡键"风险
document.addEventListener('mouseup', e => {
    if (e.button === 0) mouseFire = false;
});
// 触屏转向通道（监听画布）：移动端没有 mousemove 的 movementX，无法经鼠标通道转向，
// 改由画布 pointer 事件驱动——按下记录触点、拖动按帧间位移折算方向，复用鼠标通道
// 同一套累计判定（≥2px 出方向 / >60px 跳变忽略 / 0.15s 保持窗）；pointerType 判界
// 保证两通道互不叠加（桌面鼠标仍走上方 mousemove，触屏合成的 mousemove 无有效 movementX）
canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return; // 鼠标维持原通道，避免双输入叠加
    touchLastX = e.clientX;
    // 捕获到画布：手指拖出画布区域仍能持续收到 move/up，转向不中断（守卫见 arcade-common.js）
    Arcade.capturePointer(canvas, e.pointerId);
});
canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || touchLastX === null) return;
    const dx = e.clientX - touchLastX;
    touchLastX = e.clientX; // 触点恒随行：暂停期间也刷新，避免恢复瞬间按陈旧坐标折算出跳变
    // 暂停中（失焦或手动）不更新方向状态：与 mousemove 通道守卫一致，防止恢复后漂移
    if (paused || blurPaused) return;
    if (Math.abs(dx) > 60) return; // 忽略异常跳变（与鼠标通道同一阈值）
    mouseDx += dx;
    if (Math.abs(mouseDx) >= 2) {
        mouseDir = mouseDx > 0 ? 1 : -1;
        mouseDirTimer = MOUSE_DIR_HOLD;
        mouseDx = 0;
    }
});
// 抬手/系统接管结束转向手势：清触点与未满阈值的位移残量，方向交给保持窗自然衰减
canvas.addEventListener('pointerup', () => { touchLastX = null; mouseDx = 0; });
canvas.addEventListener('pointercancel', () => { touchLastX = null; mouseDx = 0; });
// 窗口失焦：清空键鼠状态，防止切窗期间按键"卡住"、回来后自动漂移/自动开火；
// 游戏进行中同时进入失焦暂停（静默不发声，与历史行为一致），由主循环挂起逻辑并绘制暂停遮罩。
// blur 与 visibilitychange 双通道接线由共享库 snap-common.js 统一注册
//（visibilitychange 兜底移动端切应用不触发 blur 的场景；双触发经 autoPause 幂等守卫天然去重）
function handleFocusLoss() {
    for (const k in keys) delete keys[k];
    mouseFire = false;
    mouseDir = 0;
    mouseDirTimer = 0;
    mouseDx = 0;
    touchLastX = null; // 触屏转向手势同步终止：切窗后不会补发 pointerup
    if (gameState === 'playing') pausePipe.autoPause(); // 静默失焦暂停：失焦侧 historically 无 UI 暂停音
}
Snap.bindFocusLoss(handleFocusLoss);

// 键盘按下：记录按键状态；空格/方向键阻止页面滚动，Shift 冲刺，V 成就面板（任意状态含手动/失焦暂停可用），Esc 关墙，P 手动暂停/继续
document.addEventListener('keydown', e => {
    // 空格与四方向键为游戏消费键且携带页面滚动默认行为（页面超高/超宽时按方向键
    // 会滚动页面，表现为"页面动了、飞船没动"），统一阻止默认行为；
    // A/D/Shift/P/V 无浏览器默认行为，无需拦截；F 键全屏等其它快捷键由 fullscreen.js 另行处理
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
    // 成就墙键例外：V 开墙 / Esc 关墙不作为失焦恢复键——由共享库 ach-common.js 的窗口级
    // 键盘接线处理（document 监听先于 window 监听触发，此处放行即可）且不解除失焦暂停，
    // 对齐全站惯例「V 任意状态含暂停可用」（snake/pac 等失焦与手动共用同一暂停标记、V 分支天然放行，
    // bee 双标记体系下需显式豁免，否则切窗回来的首次按 V 会被"任意键继续"消费掉弹不出墙）
    const isAchKey = e.code === 'KeyV' || (e.code === 'Escape' && Ach.isOpen());
    // 失焦暂停中：按任意键恢复并一次清空双标记，本次按键不作为游戏输入（防误触发冲刺/成就面板）
    // （恢复序列收口共享库：双标记清空 + BGM 续播 + UI 恢复音 + 遮罩同步）
    if (blurPaused && gameState === 'playing' && !isAchKey) {
        pausePipe.resume();
        return;
    }
    // P 键手动暂停/继续：与失焦暂停相互独立；守卫（游戏进行中 + 成就面板未展开）收口在
    // pausePipe.canToggle；!e.repeat 防长按连发反复切换暂停
    if (e.code === 'KeyP') {
        if (!e.repeat) pausePipe.toggle();
        return;
    }
    // V 开墙 / Esc 关墙由共享库 ach-common.js 的窗口级键盘接线处理，本监听不再重复接管
    // 手动暂停中：P 已在上方处理，其余按键不作为游戏输入
    if (paused && gameState === 'playing') {
        for (const k in keys) delete keys[k];
        return;
    }
    // 成就墙打开期间：主循环已冻结游戏更新（墙面覆盖进行中画面），按键不再写入
    // keys[]——否则冻结期按下的方向键/空格会在关墙后残留按下态，引发自动移动/
    // 自动开火（对齐 tetris/snake「成就墙冻结期输入闭锁」惯例；V/Esc 已在上方放行）
    if (Ach.isOpen()) return;
    keys[e.code] = true;
    // Shift 触发冲刺闪避（左右 Shift 均可；!e.repeat 防长按连发反复冲刺，与 P 键守卫一致）
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) performDash();
});
// 键盘抬起：清除按键状态
document.addEventListener('keyup', e => {
    keys[e.code] = false;
});

// CRT 开关机音收口共享库 fullscreen.js（FS.onCrtAudio）：独立打开的 fullscreenchange
// 与 iframe 嵌入的 arcade:fs 广播两条路径在库内统一分发——仅真实翻转时发声，首条嵌入
// 广播（hello 回复的现状同步）静默校准不发声，嵌入页开场不再误响开机音
FS.onCrtAudio({ on: () => SFX.crtOn(), off: () => SFX.crtOff() });

// 快照触发点 a（父页游戏厅关闭 iframe 覆盖层前下发 arcade:save 消息 → 立即镜像当前局进度）
// 与触发点 b（页面卸载兜底：关闭/刷新/父页移除 iframe 均触发）两处接线收口于 snap-common.js
// （Snap.bindAutoSave）：进行中写入快照，非进行中清除残留（快照管线内部按 canSave 分流；
// 游戏结束界面已清档，触发时仅幂等兜底）
Snap.bindAutoSave(snapPipe);

// 进度镜像快照恢复：核心状态创建完成后、进入默认新局（开始画面等待）前尝试恢复上次进度。
// 成功 → 进入「进行中 + 手动暂停」态：隐藏开始遮罩，停在暂停遮罩面板上等待玩家继续
//        （防恢复即死），并预装载 BGM 后立即挂起（与手动暂停态一致，继续时 resume() 可正常续播）；
// 失败 → 不做任何处理，维持原开始画面新局流程不变
if (restoreSnapshot()) {
    try {
        gameState = 'playing';
        paused = true;
        syncPauseOverlay(); // 恢复快照成功：显示暂停遮罩（含「已恢复上次进度」提示行）
        startScreen.style.display = 'none';
        SFX.bgm.start('bee');
        SFX.bgm.pause();
    } catch (e) {
        // 恢复分支兜底：此时尚未启动渲染循环，一旦抛错将中断初始化链导致页面白屏
        console.error('[bee] 快照恢复分支异常（已跳过恢复演出）:', e);
    }
}

// 启动渲染循环（lastTime 初始为 0，首帧超大 dt 由循环内 0.05s 限幅兜底）
requestAnimationFrame(loop);

// 游玩时长统计上报（返回大厅/关页时结算）+ 键帽实时高亮（按住时点亮说明面板键帽）
FX.playtime.init('bee');
FX.KeyLight.init();

/* ===================== 行为冒烟测试钩子（URL 带 ?behavior=1 才激活，tests/behavior.html 汇总） ===================== */
// 用例直调本文件内部函数：先布置全局再断言，finally 恢复原值避免用例间污染；
// 失败以抛错表达，由 FX.behavior 统一捕获汇总后 postMessage 上报父页
window.__ARCADE_TESTS__ = [
    // 碰撞盒判定：区域重叠命中、仅边缘相贴不命中、完全分离不命中（严格不等式边界）
    { name: 'isHit 重叠/相贴/分离', fn: () => {
        if (isHit(0, 0, 10, 10, 5, 5, 5, 5) !== true) throw new Error('重叠区域未判命中');
        if (isHit(0, 0, 10, 10, 10, 0, 5, 5) !== false) throw new Error('边缘相贴被误判命中');
        if (isHit(0, 0, 10, 10, 20, 20, 5, 5) !== false) throw new Error('完全分离被误判命中');
    } },
    // 连击倍率：起步 1、每 COMBO_STEP 升一级、COMBO_MAX_MULT 封顶
    { name: 'calcMult 起步/升级/封顶', fn: () => {
        const old = comboCount;
        try {
            comboCount = 0;
            if (calcMult() !== 1) throw new Error('零连击倍率非 1');
            comboCount = COMBO_STEP - 1;
            if (calcMult() !== 1) throw new Error('升级前倍率非 1');
            comboCount = COMBO_STEP;
            if (calcMult() !== 2) throw new Error('升级阈值倍率非 2');
            comboCount = COMBO_STEP * (COMBO_MAX_MULT - 1) + 99;
            if (calcMult() !== COMBO_MAX_MULT) throw new Error('封顶倍率非 ' + COMBO_MAX_MULT);
        } finally { comboCount = old; }
    } },
    // 结算段位：分数/波数双阈值按 S/A/B/C 逐级判定
    { name: 'computeBeeRank 段位阈值', fn: () => {
        const oldScore = score, oldWave = wave;
        try {
            const probes = [[13000, 1, 'S'], [7000, 1, 'A'], [3000, 1, 'B'], [100, 1, 'C'], [100, 10, 'S']];
            const got = [];
            for (const p of probes) {
                score = p[0];
                wave = p[1];
                got.push(computeBeeRank());
            }
            if (got.join('') !== 'SABCS') throw new Error('段位序列不符: ' + got.join(''));
        } finally { score = oldScore; wave = oldWave; }
    } },
];
FX.behavior('bee', window.__ARCADE_TESTS__);
