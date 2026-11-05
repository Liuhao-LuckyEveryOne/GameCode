/* ==================================================================
   像素街机厅 · 大厅脚本（index.js）
   由 index.html 内联脚本外置而来（2026-11-04，结构优化：html 只留结构与样式），
   逻辑零改动，仅剥除原内联时的 8 空格基础缩进；
   于 body 尾部、公共库（audio.js / fx.js / fullscreen.js）之后同步加载，
   普通外部脚本顶层声明仍为全局作用域，HTML 行内 on* 处理器可正常引用。

   职责（对应大厅全部 JS 动效与逻辑）：
   开机层移除 + 星空粒子/流星/网格动画 + 霓虹故障闪烁 + 全标题故障 +
   游戏覆盖层开关（LOADING 霓虹过渡 / 游戏期冻结大厅动效 / 关闭时下发 arcade:save 快照保存）+
   七段卡片预览动画 + 卡片 3D 视差 + 鼠标光晕 + 卡片音效分派 +
   提示条淡出 + 待机吸引模式 + 投币口金币飞入 +
   成就殿堂开关与渲染（鎏金覆盖层 / 称号里程碑 / 七游戏分区相片墙瀑布钉墙入场）
   ================================================================== */
'use strict';
// ---------- 跨帧消息投递目标：供大厅向游戏 iframe 投递存档通知等消息使用 ----------
/** 消息投递目标：file:// 直开时各帧为独立 opaque origin，需回退 '*' 维持跨帧通信；http(s) 同源部署收紧为 '/'（仅同源可投） */
const POST_MSG_TARGET = (location.protocol === 'file:') ? '*' : '/';

// ---------- 大厅动效总开关：false 期间各 rAF 循环跳过绘制（时间基准同步重置） ----------
// 有两个 false 窗口：
// ① CRT 开机遮罩期间（初始 false，约 0.85s）：开机瞬间整页首渲染 + 字体加载是主线程
//    最重的时刻，星空/7 个预览 canvas/光晕等约十个循环若同时启动会满帧空转抢预算，
//    挤压白幕动画的合成调度，造成开机卡顿——挂起它们让主线程全力服务首屏光栅化；
// ② 游戏覆盖层打开期间（既有行为）：游戏运行于同源 iframe，与大厅共享渲染进程主线程，
//    打开游戏时冻结大厅动效（CSS 动画由 body.game-open 暂停，JS 循环由本开关跳过），
//    关闭时在关机演出启动前恢复，黑底淡出露出大厅的瞬间动效已是活动状态，衔接无缝。
const lobbyFx = { active: false };

// ---------- 减少动态效果：跟随系统 prefers-reduced-motion ----------
// 为真时 JS 侧动画循环（星空/7 个预览 canvas 等）只绘制静态首帧后终止调度，
// CSS 侧由 @media (prefers-reduced-motion: reduce) 停用循环动画，两侧保持一致
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- CRT 开机层：白线展开动画播完后移除覆盖层，还原可交互页面 ----------
(function () {
    const boot = document.getElementById('crtBoot');
    if (!boot) return;
    // 白幕开始淡出（0.86s，动画 82% 处）前恢复各动效循环：揭幕瞬间大厅已处于活动状态，
    // 衔接无缝；开机窗口内星空/预览等循环处于挂起态（lobbyFx.active 初始 false），
    // 主线程全力服务整页首次光栅化与字体加载，避免开机白幕期间卡顿
    setTimeout(() => { lobbyFx.active = true; }, 850);
    // 两个伪元素动画任一结束即整层移除（forwards 已保持透明态）
    boot.addEventListener('animationend', () => boot.remove());
    // 兜底：后台标签动画暂停等极端情况下 animationend 不触发，超时强制移除
    setTimeout(() => { if (boot.isConnected) boot.remove(); }, 1600);
})();

// ---------- 卡片最高分与「上次游玩」：读取各游戏写入的 localStorage 记录 ----------
// 各游戏最高分键与语义方向（与游戏页内读写代码严格一致）：
// snake/tetris/pac/bee/pinball/1024 均为分数（越大越好）；
// klotski 为最少步数（越小越好，0 表示无纪录），按 难度×布局 拆为 18 键 + 3 个旧版布局键
const BEST_DEFS = [
    { id: 'snake', keys: ['snakeHighScore'], direction: 'high' },
    { id: 'tetris', keys: ['tetrisHighScore'], direction: 'high' },
    { id: 'pac', keys: ['pacHighScore'], direction: 'high' },
    { id: 'bee', keys: ['beeHighScore'], direction: 'high' },
    { id: 'pinball', keys: ['pinballHighScore'], direction: 'high' },
    {
        id: 'klotski', direction: 'low',
        keys: [
            'klotskiBest_easy_hengdao', 'klotskiBest_easy_zhihui', 'klotskiBest_easy_jiezu',
            'klotskiBest_easy_guowu', 'klotskiBest_easy_jinzai', 'klotskiBest_easy_binglin',
            'klotskiBest_normal_hengdao', 'klotskiBest_normal_zhihui', 'klotskiBest_normal_jiezu',
            'klotskiBest_normal_guowu', 'klotskiBest_normal_jinzai', 'klotskiBest_normal_binglin',
            'klotskiBest_hard_hengdao', 'klotskiBest_hard_zhihui', 'klotskiBest_hard_jiezu',
            'klotskiBest_hard_guowu', 'klotskiBest_hard_jinzai', 'klotskiBest_hard_binglin',
            // 旧版（无难度维度）键：进阶难度仍会回读，聚合一并纳入
            'klotskiBest_hengdao', 'klotskiBest_zhihui', 'klotskiBest_jiezu'
        ]
    },
    { id: '1024', keys: ['1024BestScore'], direction: 'high' }
];
const LAST_PLAYED_KEY = 'arcade_last'; // 「上次游玩」记录键：值为最近启动的游戏 id

/**
 * 从卡片 href 提取游戏 id：去掉缓存版本号查询串与 .html 后缀（snake.html?v=1 → snake）
 * @param {string} href 卡片链接地址
 * @returns {string} 游戏 id
 */
function cardGameId(href) {
    return (href || '').split('?')[0].replace(/\.html$/, '');
}

/**
 * 聚合读取某游戏的最佳纪录：遍历全部候选键取最值
 * @param {string[]} keys 候选 localStorage 键列表
 * @param {'high'|'low'} direction 语义方向：high=分数越大越好；low=步数越小越好（0 视为无纪录）
 * @returns {number|null} 最佳纪录数值；全部键均无有效纪录时为 null
 */
function readBest(keys, direction) {
    let best = null;
    for (let i = 0; i < keys.length; i++) {
        // 隐私模式等场景访问 localStorage 会抛错：捕获后按无纪录（null）处理，
        // 避免中断整个顺序初始化链导致所有角标与总分失效
        let raw = null;
        try { raw = localStorage.getItem(keys[i]); } catch (e) { /* localStorage 不可用：按无纪录处理 */ }
        const value = parseInt(raw, 10);
        if (Number.isNaN(value)) continue; // 键不存在或非数字：跳过
        if (direction === 'low') {
            // 步数语义：0 为「无纪录」占位值；取所有非零纪录的最小值
            if (value <= 0) continue;
            if (best === null || value < best) best = value;
        } else {
            // 分数语义：取所有非负纪录的最大值（负值视为脏数据跳过）
            if (value < 0) continue;
            if (best === null || value > best) best = value;
        }
    }
    // 缺失此行会导致函数恒返回 undefined——BEST 角标显示「BEST undefined」，
    // 且 readTotal 中 undefined !== null 恒真、0 + undefined = NaN，总分条显示「TOTAL NaN」
    return best;
}

/** 成就殿堂数据源：各游戏存档键、中文墙区名与成就相片表，顺序与大厅卡片排列一致
 *  （七款游戏均已升级 v2 对象存档 {unlocked:{id:时间戳}, best:{统计}}）。
 *  photos 为殿堂相片墙的展示用精简拷贝，五元组 [id, 名称, emoji 示意图, 稀有度, 描述]，
 *  id 与各游戏 ACHIEVEMENTS 定义表一一对应（snake.js/tetris.js/pac.js/bee.js/
 *  pinball.js/klotski.js/1024.js），游戏侧增删成就时须同步本表；
 *  成就数量：snake/tetris/pac/pinball/klotski/1024 各 8 条，bee 10 条，全站共 58 条 */
const ACH_DEFS = [
    {
        id: 'snake', key: 'arcade_ach_snake', name: '贪吃蛇', photos: [
            ['score100', '百分俱乐部', '🏆', 'rare', '单局得分达到 100'],
            ['score250', '得分大师', '👑', 'epic', '单局得分达到 250'],
            ['length30', '长蛇盘踞', '🐍', 'common', '蛇身长度达到 30 节'],
            ['length50', '巨蟒传说', '🐲', 'legendary', '蛇身长度达到 50 节'],
            ['combo5', '连击好手', '⚡', 'common', '单局连击达到 ×5'],
            ['combo8', '连击风暴', '🌟', 'rare', '单局连击达到 ×8'],
            ['gold5', '淘金高手', '💰', 'rare', '单局捕获 5 枚金苹果'],
            ['eat100', '大胃王', '🍎', 'epic', '单局吃掉 100 个食物']
        ]
    },
    {
        id: 'tetris', key: 'arcade_ach_tetris', name: '俄罗斯方块', photos: [
            ['score10000', '得分好手', '🎯', 'rare', '单局得分达到 10,000'],
            ['score30000', '得分专家', '💠', 'epic', '单局得分达到 30,000'],
            ['score100000', '十万俱乐部', '👑', 'legendary', '单局得分达到 100,000'],
            ['lines40', '行云流水', '🧱', 'common', '累计消除 40 行'],
            ['lines100', '消行大师', '🏗️', 'epic', '累计消除 100 行'],
            ['level5', '高速运转', '⚡', 'common', '等级达到 5'],
            ['level10', '十级高手', '🌟', 'legendary', '等级达到 10'],
            ['tetris4', 'TETRIS！', '💥', 'rare', '单次消除 4 行']
        ]
    },
    {
        id: 'pac', key: 'arcade_ach_pac', name: '吃豆人', photos: [
            ['dots500', '豆豆大胃王', '🍒', 'common', '跨局累计吃豆 500 颗'],
            ['score5000', '街机新秀', '🎯', 'common', '单局得分达到 5000'],
            ['ghost2', '连环反杀', '👻', 'common', '单次能量期吃掉 2 只幽灵'],
            ['allDots', '颗粒归仓', '🧹', 'rare', '单关吃光全部豆子'],
            ['level3', '深入迷宫', '🗺️', 'rare', '单局推进到第 3 关'],
            ['score20000', '高分传说', '🏆', 'epic', '单局得分达到 20000'],
            ['dots2000', '千豆百炼', '💠', 'epic', '跨局累计吃豆 2000 颗'],
            ['combo4', '四连反杀', '⚡', 'legendary', '单次能量期吃掉 4 只幽灵']
        ]
    },
    {
        id: 'bee', key: 'arcade_ach_bee', name: '小蜜蜂', photos: [
            ['firstBlood', '初战告捷', '🚀', 'common', '击落第一只蜜蜂'],
            ['hundred', '百人斩', '💯', 'rare', '累计击落 100 只蜜蜂'],
            ['combo10', '十连击', '🔥', 'common', '单局连击数达到 10'],
            ['combo25', '连击大师', '⚡', 'epic', '单局连击数达到 25'],
            ['boss1', '弑君者', '👑', 'epic', '击败一只蜂王 Boss'],
            ['wave10', '十波坚守', '🛡️', 'rare', '单局到达第 10 波'],
            ['score10k', '万分俱乐部', '🏆', 'legendary', '单局得分达到 10000'],
            ['bomb10', '爆破专家', '💣', 'rare', '累计使用 10 枚炸弹道具'],
            ['dash30', '幻影步', '💨', 'common', '单局冲刺 30 次'],
            ['perfect', '完美防御', '✨', 'epic', '任意一波未掉命通关']
        ]
    },
    {
        id: 'pinball', key: 'arcade_ach_pinball', name: '3D弹球', photos: [
            ['score20k', '两万分俱乐部', '🎯', 'common', '单局得分达到 20,000'],
            ['score100k', '十万俱乐部', '💠', 'epic', '单局得分达到 100,000'],
            ['score500k', '五十万传奇', '👑', 'legendary', '单局得分达到 500,000'],
            ['combo30', '连击三十', '🔥', 'common', '连击计数达到 30 次'],
            ['combo100', '连击破百', '⚡', 'epic', '连击计数达到 100 次'],
            ['mult5', '倍率全开', '✖️', 'common', '连击倍率提升至 ×5'],
            ['jackpot', '头奖时刻', '🎰', 'rare', '触发一次 JACKPOT 大奖'],
            ['multiball3', '三球齐飞', '🎱', 'rare', '同场保持 3 颗弹球']
        ]
    },
    {
        id: 'klotski', key: 'arcade_ach_klotski', name: '华容道', photos: [
            ['firstWin', '初出茅庐', '🚩', 'common', '首次通关任意布局'],
            ['steps50', '渐入佳境', '👣', 'common', '单局滑动步数达到 50 步'],
            ['wins5', '常胜将军', '🎖️', 'rare', '累计通关 5 次'],
            ['rankS', '神机妙算', '🧠', 'epic', '任意布局以 S 级评级通关'],
            ['wins20', '百战不殆', '⚔️', 'epic', '累计通关 20 次'],
            ['speed300', '兵贵神速', '⚡', 'epic', '单局 5 分钟内通关'],
            ['optimal', '一步不差', '👑', 'legendary', '以理论最少步数通关任意布局'],
            ['allClear', '十八连破', '🏰', 'legendary', '全部 18 个难度×布局均已通关']
        ]
    },
    {
        id: '1024', key: 'arcade_ach_1024', name: '1024!', photos: [
            ['merge256', '初窥门径', '🌱', 'common', '合成出 256 方块'],
            ['max512', '更上层楼', '🔢', 'rare', '单局合成出 512 方块'],
            ['merge1024', '巅峰达成', '👑', 'legendary', '合成出 1024 方块'],
            ['score3000', '小有所成', '🎯', 'common', '单局得分达到 3000'],
            ['score10000', '万分俱乐部', '🏆', 'epic', '单局得分达到 10000'],
            ['merges100', '百合并', '✨', 'rare', '单局合并次数达到 100 次'],
            ['merges1000', '千锤百炼', '⚒️', 'epic', '累计合并次数达到 1000 次'],
            ['moves2000', '步步为营', '👣', 'common', '单局滑动步数达到 2000 步']
        ]
    }
];
/** 参与游玩时长统计的游戏 id（与卡片 href 解析出的 game id 一致） */
const PLAYTIME_IDS = ['snake', 'tetris', 'pac', 'bee', 'pinball', 'klotski', '1024'];
/** 全站成就总数（进度环分母）：由相片表逐游戏聚合派生，避免平行维护 total 数字 */
const ACH_TOTAL = ACH_DEFS.reduce((sum, def) => sum + def.photos.length, 0);

/**
 * 读取某游戏的成就解锁映射：兼容三代存档格式——
 * ① v1 纯数组 [id1, id2...] → {id: 0}（旧档无时间戳，仅「已达成」语义）；
 * ② 过渡对象 { unlocked: [...] } → 同上转换；
 * ③ v2 对象 { unlocked: {id: 时间戳} }（现行格式）→ 原样返回 unlocked 映射
 * @param {{id: string, key: string, name: string, photos: Array}} def 成就定义项
 * @returns {Object} 解锁映射（键为成就 id，值为解锁时间戳，0 = 旧档迁移）；
 *                   键缺失 / JSON 损坏 / 存储不可用时为空对象
 */
function readUnlockMap(def) {
    try {
        const data = JSON.parse(localStorage.getItem(def.key));
        if (!data) return {}; // 键不存在：无任何解锁
        // v1 纯数组档与过渡数组档统一转为「已解锁、时间戳 0」的映射
        const list = Array.isArray(data) ? data : (Array.isArray(data.unlocked) ? data.unlocked : null);
        if (list) {
            const m = {};
            for (let i = 0; i < list.length; i++) m[list[i]] = 0;
            return m;
        }
        const map = data.unlocked;
        return map && typeof map === 'object' ? map : {};
    } catch (e) { return {}; } // JSON 损坏 / 存储不可用：按空映射处理，不中断面板渲染
}

/**
 * 累计某游戏游玩时长（嵌入模式子页经 arcade:playtime 消息上报，独立运行由子页直写本键）
 * @param {string} id 游戏 id
 * @param {number} seconds 本次上报秒数（>0，四舍五入为整数秒累加）
 */
function addPlaytime(id, seconds) {
    try {
        const old = parseInt(localStorage.getItem('arcade_playtime_' + id), 10) || 0;
        localStorage.setItem('arcade_playtime_' + id, String(old + Math.round(seconds)));
    } catch (e) { /* 隐私模式：写失败静默 */ }
}

/**
 * 读取某游戏累计游玩分钟数（秒→分钟向下取整）
 * @param {string} id 游戏 id
 * @returns {number} 累计分钟数；无记录或存储不可用时为 0
 */
function readPlaytimeMinutes(id) {
    try {
        return Math.floor((parseInt(localStorage.getItem('arcade_playtime_' + id), 10) || 0) / 60);
    } catch (e) { return 0; }
}

/** 刷新全部卡片的游玩时长角标：累计不足 1 分钟隐藏，有记录显示「N 分钟」 */
function refreshTimeBadges() {
    for (let i = 0; i < PLAYTIME_IDS.length; i++) {
        const el = document.getElementById('pt-' + PLAYTIME_IDS[i]);
        if (!el) continue;
        const mins = readPlaytimeMinutes(PLAYTIME_IDS[i]);
        el.hidden = mins <= 0;
        el.textContent = mins + ' 分钟';
    }
}

/**
 * 计算六款分数型游戏最高分总和（华容道为步数语义，不参与总分聚合）
 * @returns {number|null} 总分；六款全部无纪录时为 null
 */
function readTotal() {
    let total = null;
    for (let i = 0; i < BEST_DEFS.length; i++) {
        const def = BEST_DEFS[i];
        if (def.direction !== 'high') continue; // 步数语义（华容道）不计入总分
        const best = readBest(def.keys, def.direction);
        if (best !== null) total = (total === null ? 0 : total) + best; // 任一款有纪录即开始累计
    }
    return total;
}

/** 上一次刷新显示的总分缓存：用于检测涨分以触发总分条金色脉冲（null 表示尚未显示过） */
let lastShownTotal = null;

/**
 * 刷新全部卡片的 BEST 显示：分数类显示「BEST 123」，klotski 步数类显示「BEST 42 步」，
 * 无任何纪录显示「BEST --」；并同步刷新标题下方的六款游戏总分条
 */
function refreshBest() {
    for (let i = 0; i < BEST_DEFS.length; i++) {
        const def = BEST_DEFS[i];
        const el = document.getElementById('best-' + def.id);
        if (!el) continue;
        const best = readBest(def.keys, def.direction);
        // 步数语义附加单位标注，与纯分数显示区分开
        el.textContent = best === null ? 'BEST --'
            : (def.direction === 'low' ? 'BEST ' + best + ' 步' : 'BEST ' + best);
    }
    // 总分条同步刷新：六款分数型游戏最高分求和；涨分时触发金色脉冲
    const totalEl = document.getElementById('totalScore');
    if (totalEl) {
        const total = readTotal();
        // 总分滚动补间（FX.tweenNumber，128ms）：变化时从当前显示值平滑滚到目标值；
        // 无纪录（-- 无数字起点）保持直写，reduced-motion 下 tween 内部自动降级直写
        if (total === null) totalEl.textContent = 'TOTAL --';
        else FX.tweenNumber(totalEl, total, 128, v => 'TOTAL ' + v);
        // 仅在已有显示且实际上涨时触发（首次显示与回落均不触发）；重挂 class 前先移除并强制回流以重启动画
        if (lastShownTotal !== null && total !== null && total > lastShownTotal) {
            totalEl.classList.remove('total-bump');
            void totalEl.offsetWidth;
            totalEl.classList.add('total-bump');
        }
        lastShownTotal = total;
    }
}

/**
 * 刷新「上次游玩」角标：仅 arcade_last 记录对应的卡片加 .is-last 显示角标
 */
function refreshLastBadge() {
    let lastId = null;
    try { lastId = localStorage.getItem(LAST_PLAYED_KEY); } catch (e) { /* 隐私模式：读失败按无纪录处理 */ }
    const cards = document.querySelectorAll('.card');
    for (let i = 0; i < cards.length; i++) {
        cards[i].classList.toggle('is-last', cardGameId(cards[i].getAttribute('href')) === lastId);
    }
}

// ---------- 初始化：首屏填充 BEST/角标 + 设初始焦点 + 跨文档 storage 同步 ----------
(function () {
    // 大厅 BGM：请求播放迎宾曲；浏览器自动播放策略下需首次手势，
    // 由 audio.js 的 warm() 在首次按下/按键后自动补启
    SFX.bgm.start('lobby');
    // 总分脉冲演出结束即摘除 .total-bump（与 CSS 注释「animationend 自动回落」保持一致；
    // 常驻监听 + 幂等 remove，重复涨分时 refreshBest 内 remove/add 仍可正常重启动画）
    const totalScoreEl = document.getElementById('totalScore');
    if (totalScoreEl) totalScoreEl.addEventListener('animationend', () => totalScoreEl.classList.remove('total-bump'));
    refreshBest();
    refreshLastBadge();
    refreshTimeBadges();
    // 存在「上次游玩」记录：把初始键盘焦点放到对应卡片，进场即可回车续玩
    let lastId = null;
    try { lastId = localStorage.getItem(LAST_PLAYED_KEY); } catch (e) { /* 隐私模式：读失败按无记录处理 */ }
    if (lastId) {
        const cards = document.querySelectorAll('.card');
        for (let i = 0; i < cards.length; i++) {
            if (cardGameId(cards[i].getAttribute('href')) === lastId) {
                cards[i].focus({ preventScroll: true });
                break;
            }
        }
    }
    // 游戏运行于同源 iframe（另一文档），其写入的最高分会触发本页 storage 事件；
    // 任意键变化统一重刷（两个刷新均幂等且开销极小），关闭游戏时另有主动刷新兜底
    window.addEventListener('storage', () => { refreshBest(); refreshLastBadge(); refreshTimeBadges(); });
})();

// ---------- 成就殿堂：全站成就旗舰展示覆盖层（七游戏共 58 项），入口按钮 / V 键开合 / Esc / 点暗幕 / ✕ 关闭 ----------
/** 成就殿堂最近一次关闭的时刻（performance.now()，初始极小值）：供投币监听豁免「刚关闭殿堂」的手势——
    殿堂关闭监听挂 document、投币监听挂 window，冒泡阶段 document 先于 window 触发，
    关闭手势先行把殿堂置 hidden，投币监听再查 hidden 已失效，须以时间戳判定 */
let trophyClosedAt = -1e9;
(function () {
    const hall = document.getElementById('trophyHall');
    const btn = document.getElementById('trophyToggle');
    if (!hall || !btn) return; // 殿堂结构缺失时整段跳过，不影响其余大厅功能
    const totalEl = document.getElementById('thTotal');
    const ringFg = document.getElementById('thRingFg');
    const ringText = document.getElementById('thRingText');
    const rankEl = document.getElementById('thRank');
    const rankBarEl = document.getElementById('thRankBar'); // 称号位阶进度条（当前档内推进水位）
    const rankHintEl = document.getElementById('thRankHint'); // 距更高阶称号差值提示
    const mileEl = document.getElementById('thMile');
    const gridEl = document.getElementById('thGrid');
    const RING_LEN = 2 * Math.PI * 56; // 进度环周长（r=56 与 SVG 圆一致）
    /** 奖杯 SVG 图标（material emoji_events 24×24 路径，currentColor 继承行状态色：完成金亮/未完成暗灰） */
    const CUP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.73 1.75 2.29 3.05 4.11 3.4V19H9v2h6v-2h-2.5v-2.66c1.82-.35 3.38-1.65 4.11-3.4C18.08 12.63 20 10.55 20 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z"/></svg>';
    /** 各游戏主题霓虹色（与大厅卡片呼应）：行铭牌文字色与进度条渐变起点 */
    const HUES = {
        snake: '#39ff6a', tetris: '#35e0ff', pac: '#ffd23e', bee: '#ff3ea5',
        pinball: '#ff9a3e', klotski: '#b06cff', '1024': '#6ea8ff'
    };
    /** 殿堂称号阶梯：min 为达成该称号所需的全站成就数（从上到下取首个达成档；封顶档 min=ACH_TOTAL） */
    const RANKS = [
        { min: ACH_TOTAL, name: '传说收藏家' },
        { min: 44, name: '殿堂大师' },
        { min: 29, name: '街机名匠' },
        { min: 15, name: '小有名气' },
        { min: 1, name: '崭露头角' },
        { min: 0, name: '初入殿堂' }
    ];
    /** 全站里程碑节点（成就数阶梯，与头部四阶轨道一一对应） */
    const MILESTONES = [10, 25, 40, ACH_TOTAL];
    /** 记录上一次渲染的称号：变更时给称号重挂 .th-rank-pop 弹出动画 */
    let lastRank = null;

    /**
     * 聚合渲染殿堂：七游戏分区相片墙（墙区铭牌 + 拍立得成就相片钉墙）
     * + 总进度环 + 殿堂称号 + 里程碑轨道；全成就墙区点亮奖杯，满环触发面板鎏金 perfect 态
     * @param {boolean} opening 是否为开幕渲染（相片瀑布钉墙入场 + 进度环从零弧线扫入
     *                          + 中心百分数滚动 + 满环烟花礼赞）；常规刷新无入场动画，避免闪烁
     */
    function render(opening) {
        let unlocked = 0;
        let gi = 0; // 全局线性索引：驱动开幕瀑布钉墙入场的 animation-delay
        let secs = '';
        for (let i = 0; i < ACH_DEFS.length; i++) {
            const def = ACH_DEFS[i];
            const map = readUnlockMap(def); // 单游戏一次读取，循环内逐成就查表，禁止重复 IO
            const hue = HUES[def.id] || '#ffd23e';
            let got = 0;
            let cards = '';
            for (let p = 0; p < def.photos.length; p++) {
                const ph = def.photos[p]; // 五元组 [id, 名称, emoji, 稀有度, 描述]
                const has = map[ph[0]] !== undefined; // v2 映射键存在即已解锁（值可能为 0 = 旧档迁移）
                if (has) { got++; unlocked++; } // got 计单游戏数、unlocked 计全站总数（驱动进度环/称号/里程碑与下方各行同步）
                // 确定性伪随机微倾角（±2.2°）与胶带转角：相片错落钉墙，每次渲染不跳变
                const tilt = (((i * 37 + p * 11) % 9) - 4) * 0.55;
                const tape = ((i + p) % 2) ? 3.5 : -4;
                let tip = ph[4];
                if (has) {
                    const ts = Number(map[ph[0]]);
                    tip += '　' + (ts > 0 ? '解锁于 ' + new Date(ts).toLocaleString() : '已解锁（旧档迁移）');
                } else {
                    tip += '　尚未解锁（悬停可显影）';
                }
                // --d 为瀑布入场 delay；--tilt/--tape 微倾角；--hue 主题色（墙区/相片引用）；
                // --hue-bg 为主题色 18% 透明底（8 位 hex），仅作相片图案区渐变叠色
                cards += '<figure class="th-photo' + (has ? ' is-got' : '')
                    + ' rar-' + ph[3] + (opening && !REDUCED_MOTION ? ' th-in' : '')
                    + '" style="--tilt:' + tilt + 'deg;--tape:' + tape + 'deg;--hue:' + hue
                    + ';--hue-bg:' + hue + '2e;--d:' + (0.16 + gi * 0.018).toFixed(3)
                    + 's" title="' + tip + '">'
                    + '<i class="th-tape" aria-hidden="true"></i>'
                    + '<span class="th-shot"><span class="th-emoji" aria-hidden="true">' + ph[2]
                    + '</span>' + (has ? '' : '<span class="th-q" aria-hidden="true">?</span>')
                    + '</span>'
                    + '<span class="th-rar" aria-hidden="true"></span>'
                    + '<figcaption class="th-name">' + ph[1] + '</figcaption></figure>';
                gi++;
            }
            const done = got >= def.photos.length; // 全成就墙区：铭牌旁点亮奖杯
            secs += '<section class="th-sec" style="--hue:' + hue + ';--hue-bg:' + hue + '2e">'
                + '<div class="th-sec-head' + (opening && !REDUCED_MOTION ? ' th-in' : '')
                + '" style="--d:' + (0.06 + (gi - def.photos.length) * 0.018).toFixed(3) + 's">'
                + '<i class="th-pin" aria-hidden="true"></i><b>' + def.name + '</b>'
                + '<span class="th-sec-count">' + got + '<i>/' + def.photos.length + '</i></span>'
                + (done ? '<span class="th-sec-cup">' + CUP_SVG + '</span>' : '')
                + '<span class="th-sec-line" aria-hidden="true"></span></div>'
                + '<div class="th-sec-wall">' + cards + '</div></section>';
        }
        gridEl.innerHTML = secs;
        totalEl.textContent = unlocked + ' / ' + ACH_TOTAL;
        // 满环 perfect 态：面板金辉呼吸与奖牌脉冲由 #trophyHall.is-perfect 驱动
        hall.classList.toggle('is-perfect', unlocked >= ACH_TOTAL);
        // 称号阶梯：从上到下取首个达成档（RANKS 为降序，i 即当前档索引）；变更时重挂节点触发 th-rank-pop 弹出（首次渲染静默就位）
        let rank = RANKS[RANKS.length - 1].name;
        let rankIdx = RANKS.length - 1;
        for (let i = 0; i < RANKS.length; i++) {
            if (unlocked >= RANKS[i].min) { rank = RANKS[i].name; rankIdx = i; break; }
        }
        if (rank !== lastRank) {
            rankEl.textContent = rank;
            rankEl.classList.remove('th-rank-pop');
            if (lastRank !== null) {
                void rankEl.offsetWidth; // 强制回流：复位已播完的弹出动画，使其可重放
                rankEl.classList.add('th-rank-pop');
            }
            lastRank = rank;
        }
        // 位阶进度条：当前称号档内的推进水位 = (unlocked - 本档min) / (更高档min - 本档min)，
        // 与进度环同节奏缓动；封顶档恒满格；提示行标注距更高称号还差几项
        if (rankIdx > 0) {
            const top = RANKS[rankIdx - 1].min;
            const base = RANKS[rankIdx].min;
            rankBarEl.style.width = Math.round((unlocked - base) / (top - base) * 100) + '%';
            rankHintEl.textContent = '距「' + RANKS[rankIdx - 1].name + '」还差 ' + (top - unlocked) + ' 项';
        } else {
            rankBarEl.style.width = '100%';
            rankHintEl.textContent = '位阶已满 · 传说达成';
        }
        // 里程碑轨道：水位 = 全站进度（--mile-prog，CSS 0.9s 过渡与进度环同节奏推进）；
        // 节点按 值/58 真实比例落位（--x）；达成的点亮 is-on，首个未达成阶呼吸描边 is-next
        mileEl.style.setProperty('--mile-prog', Math.min(unlocked / ACH_TOTAL * 100, 100).toFixed(2) + '%');
        let nextIdx = -1;
        let pips = '<span class="th-pip th-pip-zero" style="--x:0%"><i></i><em>0</em></span>'; // 原点刻度：进度条零位（弱化灰点，非成就节点）
        for (let i = 0; i < MILESTONES.length; i++) {
            const on = unlocked >= MILESTONES[i];
            if (!on && nextIdx === -1) nextIdx = i;
            pips += '<span class="th-pip' + (on ? ' is-on' : (i === nextIdx ? ' is-next' : ''))
                + '" style="--x:' + (MILESTONES[i] / ACH_TOTAL * 100).toFixed(2) + '%'
                + '"><i></i><em>' + MILESTONES[i] + '</em></span>';
        }
        mileEl.innerHTML = pips;
        // 进度环：SVG stroke-dashoffset 控制露出弧长（dasharray 周长恒定，初始化时已设）
        const target = RING_LEN * (1 - unlocked / ACH_TOTAL);
        if (opening && !REDUCED_MOTION) {
            // 开幕弧线扫入：先瞬时置满偏移（整环隐藏）→ 强制回流 → 恢复 CSS 过渡 → 设目标值，
            // 0.9s 缓动从零弧长平滑扫到实际进度；中心百分数由补间滚动跟随
            ringFg.style.transition = 'none';
            ringFg.style.strokeDashoffset = RING_LEN.toFixed(1);
            void ringFg.getBoundingClientRect(); // 强制回流：确保零弧长状态先落盘再恢复过渡
            ringFg.style.transition = '';
            ringFg.style.strokeDashoffset = target.toFixed(1);
            FX.tweenNumber(ringText, Math.round(unlocked / ACH_TOTAL * 100), 900, v => v + '%');
            // 满环开幕：进度环扫满之际补一发全屏金色烟花礼赞（recordBurst 内部自检减弱动效）
            if (unlocked >= ACH_TOTAL) setTimeout(() => { FX.recordBurst({ count: 60 }); }, 650);
        } else {
            // 常规刷新（storage 实时更新 / 减弱动效）：直接到位，环与进度条走 CSS 过渡
            ringFg.style.strokeDashoffset = target.toFixed(1);
            ringText.textContent = Math.round(unlocked / ACH_TOTAL * 100) + '%';
        }
    }

    /** 统一开启：开幕渲染（扫入演出）→ 揭开殿堂 → 播鎏金揭幕仪式音 */
    function open() { render(true); hall.hidden = false; SFX.hallOpen(); }
    /** 统一关闭：收起殿堂并盖时间戳（trophyClosedAt 供投币监听豁免本次手势，见顶部注释） */
    function close() { hall.hidden = true; trophyClosedAt = performance.now(); SFX.uiClick(); }
    /** 开合切换：关态开墙、开态关墙（入口按钮与 V 键共用同一入口） */
    function toggle() { if (hall.hidden) open(); else close(); }
    btn.addEventListener('click', toggle);
    // V 键开合（全站统一开墙键，与各游戏内成就墙一致：关态按 V 开、开态按 V 关）。
    // 全屏模式下 Esc 会被浏览器优先接管用于退出全屏，V 是不受影响的开合键
    document.addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat) toggle(); });
    document.getElementById('thClose').addEventListener('click', close);
    // 点击暗幕（veil）关闭；点击殿堂与入口按钮之外的区域也关闭（pointerdown 覆盖鼠标/触屏）
    hall.querySelector('.th-veil').addEventListener('pointerdown', close);
    document.addEventListener('pointerdown', e => {
        if (hall.hidden) return;
        if (!hall.contains(e.target) && !btn.contains(e.target)) close();
    });
    // Esc 关闭（次选关墙键：仅非全屏场景可靠，全屏下浏览器优先响应退出全屏，改用 V 键开合）
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !hall.hidden) close(); });
    // 游戏在 iframe 内解锁成就后本页 storage 事件触发：殿堂打开期间实时刷新进度（非开幕渲染，环平滑过渡到新值）
    window.addEventListener('storage', () => { if (!hall.hidden) render(false); });
    // 初始化进度环 dasharray 周长（后续渲染仅改 offset）
    ringFg.style.strokeDasharray = RING_LEN.toFixed(1);
})();

// ---------- CRT 开关机音：进入全屏播通电音、退出播断电音，呼应显像管开关机演出 ----------
// 与 fullscreen.js 各自独立监听同一标准事件互不干扰；SFX 内部自检音效开关，关闭时静默；
// 页面首次加载不触发 fullscreenchange（不播声属预期）
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) SFX.crtOn();
    else SFX.crtOff();
});

// ---------- 键盘导航：方向键在卡片网格间移动焦点，Enter/Space 启动游戏 ----------
// 网格常规为 4 列（≤1080px 退化为 2 列），按当前实际列数计算上下移动步长；
// 游戏打开期间（body.game-open）不响应，避免在覆盖层里玩游戏时方向键误移大厅焦点。
// 卡片列表与列数缓存在此处（模块级），resize 时刷新；keydown 高频路径零 DOM 查询
let navCards = [];   // 缓存的卡片数组（替代每次 keydown 的 querySelectorAll）
let navColCount = 1; // 网格当前生效列数（解析自 grid-template-columns 计算值）
/**
 * 刷新键盘导航缓存：重新收集卡片并解析网格列数（列数随窗口断点在 4/2 列间切换）
 */
function refreshNavCache() {
    navCards = Array.from(document.querySelectorAll('.card'));
    // 当前生效列数：解析 grid-template-columns 计算值（如 "232px 232px 232px 232px"）
    navColCount = getComputedStyle(document.querySelector('.cards')).gridTemplateColumns.split(' ').length;
}
refreshNavCache();
window.addEventListener('resize', refreshNavCache);
document.addEventListener('keydown', e => {
    if (document.body.classList.contains('game-open')) return;
    if (document.body.classList.contains('pre-coin')) return; // 投币待机：卡片锁定导航休眠，按键交由投币模块接管（任意键投币）
    // 先过滤按键：非方向键/空格立即返回，不做任何 DOM 查询与样式计算
    const key = e.key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp' && key !== ' ') return;
    const idx = navCards.indexOf(document.activeElement);
    if (idx === -1) return; // 焦点不在卡片上（如右上角按钮）时不接管
    let target = -1;
    if (key === 'ArrowRight') target = idx + 1;               // 右：下一张
    else if (key === 'ArrowLeft') target = idx - 1;           // 左：上一张
    else if (key === 'ArrowDown') target = idx + navColCount; // 下：下移一整行
    else if (key === 'ArrowUp') target = idx - navColCount;   // 上：上移一整行
    else {
        // <a> 不响应空格键：手动触发 click 启动游戏，并阻止页面滚动
        e.preventDefault();
        navCards[idx].click();
        return;
    }
    e.preventDefault(); // 阻止方向键默认的页面滚动
    // 越界（首行上移/末行下移/两端左右越界）原地不动
    if (target >= 0 && target < navCards.length) {
        navCards[target].focus({ preventScroll: true });
        // 键盘切卡与鼠标悬停同反馈：派发 mouseenter 复用卡片音效模块的悬停签名音（自带未投币静音守卫）
        navCards[target].dispatchEvent(new Event('mouseenter'));
    }
});

// ---------- 星空粒子背景：像素星点缓慢下落 + 亮度呼吸，少数霓虹彩星点缀 ----------
(function () {
    const cv = document.getElementById('starfield');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const COLORS = ['#39ff6a', '#ff3ea5', '#ffd23e', '#35e0ff']; // 霓虹彩星候选色
    let stars = []; // 星点数组 { x, y, r, v, tw, ts, color }
    // 流星列表与下一次生成的倒计时（秒）、last 动画计时基准（毫秒）：三者前移至此声明，
    // 因为减动效模式下 resize() 末尾会补绘静态首帧，绘制路径会提前触达这些变量
    let meteors = [];
    let meteorTimer = 2.5;
    let last = 0;
    /**
     * 按窗口尺寸重建画布与星点（数量随屏幕面积缩放）
     */
    function resize() {
        cv.width = window.innerWidth;
        cv.height = window.innerHeight;
        stars = [];
        const count = Math.round(cv.width * cv.height / 16000); // 密度：约每 16000px² 一颗
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * cv.width,
                y: Math.random() * cv.height,
                r: Math.random() < 0.85 ? 1 : 2, // 大多 1px 小星，少数 2px 亮星
                v: 6 + Math.random() * 18,       // 下落速度（px/s，缓慢漂移）
                tw: Math.random() * Math.PI * 2, // 闪烁初相位
                ts: 0.5 + Math.random() * 2,     // 闪烁角速度（rad/s）
                color: Math.random() < 0.12 ? COLORS[(Math.random() * COLORS.length) | 0] : '#cfd4ff'
            });
        }
        // 减少动效模式：上面的 width/height 赋值会清空画布，须补绘静态首帧避免星空永久空白
        if (REDUCED_MOTION) drawStaticFrame();
    }
    /**
     * 绘制减少动效模式下的静态首帧：临时接通动效总开关复用 tick(0) 一次性绘制
     * 最终画面后立即关闭（tick 对后续帧直接终止，不会进入持续动画循环）；
     * 初始载入与 resize 重设尺寸两条路径统一走本函数，避免手法散落失同步
     */
    function drawStaticFrame() {
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    }
    resize();
    window.addEventListener('resize', resize);

    /**
     * 绘制底部合成波透视网格：纵线向消失点汇聚，横线随时间向屏幕下方滚动，
     * 二次映射让靠近地平线的行更密集，营造纵深
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function drawGrid(t) {
        const horizon = cv.height * 0.8; // 地平线高度
        const cx = cv.width / 2;         // 消失点横坐标
        ctx.strokeStyle = 'rgba(90, 90, 255, 0.09)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // 纵向发散线：底部端点间距宽，向消失点方向收拢
        for (let j = -7; j <= 7; j++) {
            ctx.moveTo(cx + j * 6, horizon);
            ctx.lineTo(cx + j * cv.width / 8, cv.height);
        }
        // 横向滚动线：k∈[0,1) 随时间推进，行向观察者移动
        const ROWS = 9, SPEED = 0.22; // 行数与滚动速度（行/秒）
        for (let i = 0; i < ROWS; i++) {
            const k = ((i / ROWS) + t / 1000 * SPEED) % 1;
            const y = horizon + (cv.height - horizon) * k * k;
            ctx.moveTo(0, y);
            ctx.lineTo(cv.width, y);
        }
        ctx.stroke();
        // 地平线微光
        ctx.fillStyle = 'rgba(90, 90, 255, 0.06)';
        ctx.fillRect(0, horizon - 1, cv.width, 2);
    }

    /**
     * 更新并绘制流星：按倒计时随机生成（方向、速度、颜色随机），
     * 生命周期内先亮后暗，尾迹为沿速度反方向的渐隐线段
     * @param {number} dt 帧间隔（秒，已限幅）
     */
    function drawMeteors(dt) {
        meteorTimer -= dt;
        if (meteorTimer <= 0) {
            const dir = Math.random() < 0.5 ? 1 : -1; // 随机朝左或朝右划过
            meteors.push({
                x: cv.width * (0.2 + Math.random() * 0.6),
                y: -20 + Math.random() * cv.height * 0.25,
                vx: dir * (240 + Math.random() * 220),
                vy: 100 + Math.random() * 120,
                life: 0,
                max: 0.7 + Math.random() * 0.6,
                color: COLORS[(Math.random() * COLORS.length) | 0]
            });
            meteorTimer = 3.5 + Math.random() * 5; // 下一次生成的间隔
        }
        for (let i = meteors.length - 1; i >= 0; i--) {
            const m = meteors[i];
            m.life += dt;
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            if (m.life >= m.max) { meteors.splice(i, 1); continue; }
            const a = Math.sin(Math.PI * m.life / m.max); // 先亮后暗的亮度包络
            const tx2 = m.x - m.vx * 0.16, ty2 = m.y - m.vy * 0.16; // 尾迹端点
            const grad = ctx.createLinearGradient(m.x, m.y, tx2, ty2);
            grad.addColorStop(0, m.color);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = a * 0.9;
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(tx2, ty2);
            ctx.lineTo(m.x, m.y);
            ctx.stroke();
            ctx.fillStyle = '#ffffff'; // 亮头部
            ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
    /**
     * 星空动画主循环：星点缓慢下落并以正弦呼吸明暗，落出底边后回到顶部
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过全部绘制仅保留调度，恢复时重置计时基准避免跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = Math.min((t - last) / 1000, 0.05); // 限幅帧间隔，防切后台跳变
        last = t;
        ctx.clearRect(0, 0, cv.width, cv.height);
        drawGrid(t);     // 底部合成波透视网格
        drawMeteors(dt); // 流星更新与绘制
        for (const s of stars) {
            s.y += s.v * dt;   // 匀速下落
            s.tw += s.ts * dt; // 推进闪烁相位
            if (s.y > cv.height + 2) { s.y = -2; s.x = Math.random() * cv.width; }
            ctx.globalAlpha = 0.22 + 0.55 * (0.5 + 0.5 * Math.sin(s.tw)); // 亮度呼吸
            ctx.fillStyle = s.color;
            ctx.fillRect(s.x, s.y, s.r, s.r); // 像素方块星
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：绘制静态首帧（首帧即最终画面），不进入持续动画
        drawStaticFrame();
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 霓虹灯故障闪烁：随机让一根 ARCADE 字母像老灯管般跳闪几下 ----------
(function () {
    const spans = document.querySelectorAll('.arcade-title span');
    if (!spans.length) return;
    if (REDUCED_MOTION) return; // 减少动效：不触发灯管闪烁
    /**
     * 随机挑选一根字母触发 tubeFlicker 动画，结束后移除类以便下次重新触发
     */
    function flicker() {
        const s = spans[(Math.random() * spans.length) | 0];
        s.classList.add('flicker');
        s.addEventListener('animationend', () => s.classList.remove('flicker'), { once: true });
        // 下一次故障：大多安静数秒，营造偶发感
        setTimeout(flicker, 1400 + Math.random() * 3800);
    }
    setTimeout(flicker, 1800); // 开机动画后再开始闪烁
})();

// ---------- 全标题 RGB 色差故障：偶发让 ARCADE 标题整体抖动并分离出粉/青残影 ----------
(function () {
    const title = document.querySelector('.arcade-title');
    if (!title) return;
    if (REDUCED_MOTION) return; // 减少动效：不触发全标题故障
    /**
     * 随机触发一次全标题色差故障动画，结束后移除类以便下次重新触发
     */
    function glitch() {
        // 未投币待机期不演出故障：色差动画的 filter 会覆盖静态灰度（动画优先级高于声明），
        // 彩色闪烁会击穿黑白待机的「未通电」沉浸感；点亮演出结束后恢复演出。
        // 点亮演出期间（lights-on）同样跳过本轮挂类：标题灯管点火动画（lightsOnTube）
        // 接管标题，故障闪烁暂停避免冲突（防止灯管 animationend 误摘 glitch 类或动画互相压制）
        if (!document.body.classList.contains('pre-coin')
            && !document.body.classList.contains('lights-on')) {
            title.classList.add('glitch');
            title.addEventListener('animationend', () => title.classList.remove('glitch'), { once: true });
        }
        // 下一次故障间隔大多安静数秒，保持偶发感
        setTimeout(glitch, 5000 + Math.random() * 7000);
    }
    setTimeout(glitch, 3600); // 开机与首轮灯管闪烁之后登场
})();

// ---------- 贪吃蛇预览动画：小蛇沿环形路径爬行，食物闪烁 ----------
(function () {
    const cv = document.getElementById('snakePreview');
    const ctx = cv.getContext('2d');
    const G = 20, N = 8; // 8×8 网格，格 20px
    // 外圈环形路径（顺时针）
    const path = [];
    for (let x = 0; x < N; x++) path.push([x, 0]);
    for (let y = 1; y < N; y++) path.push([N - 1, y]);
    for (let x = N - 2; x >= 0; x--) path.push([x, N - 1]);
    for (let y = N - 2; y >= 1; y--) path.push([0, y]);
    const LEN = 7;       // 蛇身长度
    let idx = 0;         // 蛇头在路径上的位置
    let acc = 0, last = 0;
    /**
     * 贪吃蛇预览动画主循环：按 150ms 的节奏沿环形路径推进蛇头一格，
     * 每帧绘制闪烁的食物与带渐隐效果的蛇身
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { acc = 0; last = t; requestAnimationFrame(tick); return; }
        acc += t - last;
        last = t;
        if (acc > 150) { acc = 0; idx = (idx + 1) % path.length; }
        ctx.clearRect(0, 0, 160, 160);
        // 闪烁的食物（放在环形路径内部）
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t / 200);
        ctx.fillStyle = '#ff3ea5';
        ctx.fillRect(3 * G + 4, 3 * G + 4, G - 8, G - 8);
        ctx.globalAlpha = 1;
        // 蛇身（头部更亮）
        for (let i = 0; i < LEN; i++) {
            const p = path[(idx - i + path.length * 2) % path.length];
            const head = i === 0;
            ctx.fillStyle = head ? '#7dffa4' : '#39ff6a';
            ctx.globalAlpha = head ? 1 : 0.85 - i * 0.08;
            ctx.fillRect(p[0] * G + 2, p[1] * G + 2, G - 4, G - 4);
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 俄罗斯方块预览动画：方块依次下落堆叠，堆高后清盘重来 ----------
(function () {
    const cv = document.getElementById('tetrisPreview');
    const ctx = cv.getContext('2d');
    const G = 16, COLS = 10, ROWS = 10;
    // 预演序列：形状（相对坐标）、颜色、落点列
    const seq = [
        { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], color: '#c17bff', col: 3 }, // T
        { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: '#4d79ff', col: 0 }, // J
        { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: '#39ff6a', col: 6 }, // S
        { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: '#ffd23e', col: 7 }, // O
        { cells: [[0, 0], [0, 1], [0, 2], [0, 3]], color: '#35e0ff', col: 2 }, // I
        { cells: [[0, 0], [1, 0], [2, 0], [2, 1]], color: '#ff9a3e', col: 5 }  // L
    ];
    let stack = [];  // 已固定的格子 { x, y, color }
    let si = 0;      // 当前块序号
    let py = -4;     // 当前块的行位置（负值 = 顶部界外滑入）
    let acc = 0, last = 0;

    /**
     * 查询某列堆顶行号（无方块时返回 ROWS）
     * @param {number} col 列号
     * @returns {number} 该列最高已固定格的行号
     */
    function stackTopAt(col) {
        let top = ROWS;
        for (const s of stack) {
            if (s.x === col && s.y < top) top = s.y;
        }
        return top;
    }

    /**
     * 计算当前块的落定行位置
     * @param {object} item 预演序列项
     * @returns {number} 落定行位置
     */
    function landingY(item) {
        let land = ROWS;
        for (const [dx, dy] of item.cells) {
            land = Math.min(land, stackTopAt(item.col + dx) - dy - 1);
        }
        return land;
    }

    /**
     * 绘制一枚像素风小格：主色方块 + 顶部高光带（不发光，光晕由调用方控制）
     * @param {number} x 格列号
     * @param {number} y 格行号
     * @param {string} color 颜色
     */
    function drawCellPx(x, y, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * G + 1, y * G + 1, G - 2, G - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x * G + 3, y * G + 3, G - 7, 2);
    }

    /**
     * 俄罗斯方块预览动画主循环：按 80ms 的节奏让当前块下落一行，
     * 触底后写入固定堆（越顶则清盘重来）并切换到预演序列的下一块；
     * 每帧依次绘制淡网格线、固定堆、幽灵投影（半透明）与当前块
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { acc = 0; last = t; requestAnimationFrame(tick); return; }
        acc += t - last;
        last = t;
        const item = seq[si];
        const land = landingY(item);
        if (acc > 80) {
            acc = 0;
            if (py < land) {
                py++;
            } else {
                // 落定：写入堆（越顶则清盘重来）
                let overflow = false;
                for (const [dx, dy] of item.cells) {
                    const yy = py + dy;
                    if (yy < 0) overflow = true;
                    else stack.push({ x: item.col + dx, y: yy, color: item.color });
                }
                if (overflow) stack = [];
                si = (si + 1) % seq.length;
                py = -4;
            }
        }
        // 绘制
        ctx.clearRect(0, 0, 160, 160);
        // 淡网格线
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        for (let c = 1; c < COLS; c++) { ctx.moveTo(c * G + 0.5, 0); ctx.lineTo(c * G + 0.5, 160); }
        for (let r = 1; r < ROWS; r++) { ctx.moveTo(0, r * G + 0.5); ctx.lineTo(160, r * G + 0.5); }
        ctx.stroke();
        // 已固定堆
        for (const s of stack) drawCellPx(s.x, s.y, s.color);
        // 当前块 + 幽灵投影
        if (land >= -4) {
            ctx.globalAlpha = 0.22;
            for (const [dx, dy] of item.cells) {
                const yy = land + dy;
                if (yy >= 0) drawCellPx(item.col + dx, yy, item.color);
            }
            ctx.globalAlpha = 1;
            for (const [dx, dy] of item.cells) {
                const yy = py + dy;
                if (yy >= 0) drawCellPx(item.col + dx, yy, item.color);
            }
        }
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 吃豆人预览动画：吃豆人横向吃豆，两只幽灵在后方紧追 ----------
(function () {
    const cv = document.getElementById('pacPreview');
    const ctx = cv.getContext('2d');
    const DOTS = [];   // 一行豆子 { x, eaten }
    for (let x = 10; x <= 150; x += 14) DOTS.push({ x: x, eaten: false });
    let px = -40;      // 吃豆人横向位置（负值 = 界外滑入）
    let last = 0;

    /**
     * 绘制小型吃豆人（朝右、嘴巴开合）
     * @param {number} x 像素 x
     * @param {number} y 像素 y
     * @param {number} mouth 嘴巴半张角（弧度）
     */
    function drawPacMini(x, y, mouth) {
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, 11, mouth, Math.PI * 2 - mouth);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * 绘制小型幽灵（顶半圆 + 锯齿裙边 + 眼睛）
     * @param {number} x 像素 x
     * @param {number} y 像素 y
     * @param {string} color 身体颜色
     */
    function drawGhostMini(x, y, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y - 2, 10, Math.PI, 0);
        ctx.lineTo(x + 10, y + 8);
        const fw = 5;
        for (let i = 0; i < 4; i++) {
            ctx.lineTo(x + 10 - fw * (i + 0.5), y + 10);
            ctx.lineTo(x + 10 - fw * (i + 1), y + 8);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x - 4, y - 3, 3, 0, Math.PI * 2);
        ctx.arc(x + 4, y - 3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b1bd0';
        ctx.beginPath();
        ctx.arc(x - 2.5, y - 3, 1.6, 0, Math.PI * 2);
        ctx.arc(x + 5.5, y - 3, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * 吃豆人预览动画主循环：吃豆人按恒定速度从左侧界外滑入并向右横移，
     * 沿途吞食豆子，两只幽灵紧随其后；走完全程（px > 200）后重置位置与豆子
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = t - last;
        last = t;
        px += dt * 0.045;
        if (px > 200) {
            px = -40;
            for (const d of DOTS) d.eaten = false; // 走完全程后豆子重置
        }
        // 吃豆判定
        for (const d of DOTS) {
            if (!d.eaten && Math.abs(d.x - px) < 6) d.eaten = true;
        }
        ctx.clearRect(0, 0, 160, 160);
        // 豆子
        ctx.fillStyle = '#ffd7a8';
        for (const d of DOTS) {
            if (!d.eaten) ctx.fillRect(d.x - 2, 78, 4, 4);
        }
        // 幽灵在后方紧追（红色在前、青色在后），吃豆人最前
        drawGhostMini(px - 58, 80, '#35e0ff');
        drawGhostMini(px - 34, 80, '#ff3b3b');
        drawPacMini(px, 80, 0.12 + 0.24 * Math.abs(Math.sin(t / 90)));
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 3D弹球预览动画：金属球沿 8 字轨迹穿梭弹柱间，双挡板周期拍动 ----------
(function () {
    const cv = document.getElementById('pinballPreview');
    const ctx = cv.getContext('2d');
    // 三枚弹柱 { x, y, r, flash }（flash：撞击闪光强度 0~1，随时间衰减）
    const bumps = [
        { x: 52, y: 52, r: 11, flash: 0 },
        { x: 108, y: 52, r: 11, flash: 0 },
        { x: 80, y: 92, r: 11, flash: 0 }
    ];
    let ph = 0;  // 轨迹相位（弧度）
    let last = 0;

    /**
     * 3D弹球预览动画主循环：金属球沿确定性 Lissajous 轨迹穿梭三枚弹柱，
     * 靠近弹柱时触发闪白渐隐，底部双挡板随相位周期收拢/拍起
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = Math.min((t - last) / 1000, 0.05);
        last = t;
        ph += dt * 1.7;
        // 球沿 8 字轨迹运动（确定性路径，无物理积分，永不停摆）
        const bx = 80 + 54 * Math.sin(ph);
        const by = 74 + 40 * Math.sin(ph * 2 + 1.1);
        // 挡板摆角：0.45 收拢 ↔ -0.4 拍起（sin>0 区间拍起）
        const ang = 0.45 - Math.max(0, Math.sin(ph)) * 0.85;

        ctx.clearRect(0, 0, 160, 160);
        // 弹柱：粉色霓虹圆，球接近时闪白并增强光晕
        for (const b of bumps) {
            const near = Math.hypot(bx - b.x, by - b.y) < b.r + 14;
            b.flash = near ? 1 : Math.max(0, b.flash - dt * 5);
            ctx.fillStyle = b.flash > 0.5 ? '#ffffff' : '#ff3ea5';
            ctx.shadowColor = '#ff3ea5';
            ctx.shadowBlur = 8 + b.flash * 10;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
        // 双挡板：青色圆头粗线，轴点在底部两角，尖端朝台面中央
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#35e0ff';
        ctx.shadowColor = '#35e0ff';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 7;
        for (const [ax, side] of [[32, 1], [128, -1]]) {
            ctx.beginPath();
            ctx.moveTo(ax, 136);
            ctx.lineTo(ax + side * Math.cos(ang) * 30, 136 + Math.sin(ang) * 30);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
        // 金属弹球：左上高光 → 灰蓝 → 暗边径向渐变
        const g = ctx.createRadialGradient(bx - 4, by - 4, 1, bx, by, 9);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.4, '#cfd4e8');
        g.addColorStop(1, '#4a4f6b');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, 9, 0, Math.PI * 2);
        ctx.fill();
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 小蜜蜂预览动画：蜂群编队随波摆动，玩家飞船往返扫射，被击中的蜂闪白后重生 ----------
(function () {
    const cv = document.getElementById('beePreview');
    const ctx = cv.getContext('2d');
    // 蜂群编队：3 行 × 5 列，每只蜂记录存活状态与受击闪光/重生倒计时
    const BEES = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
            BEES.push({ col: c, row: r, alive: true, respawn: 0, flash: 0 });
        }
    }
    const BULLET_SPEED = 150; // 子弹上升速度（像素/秒）
    const bullets = [];       // 场上子弹列表 { x, y }
    let ph = 0;      // 蜂群摆动相位（弧度）
    let fireCd = 0;  // 射击冷却剩余秒数
    let last = 0;

    /**
     * 计算指定蜂当前的世界坐标（整体左右摆动 + 行/列相位差的水平波浪与纵向轻微起伏）
     * @param {Object} bee 蜂条目 { col, row, ... }
     * @returns {number[]} [x, y] 蜂中心坐标
     */
    function beePos(bee) {
        const sway = 12 * Math.sin(ph);                            // 编队整体左右摆动
        const wave = 6 * Math.sin(ph * 2 + bee.row) + 3 * Math.sin(ph * 2.4 + bee.col); // 水平波浪位移（相位随行/列错开）
        return [80 + (bee.col - 2) * 26 + sway + wave, 36 + bee.row * 20 + 4 * Math.sin(ph * 1.8 + bee.col)]; // 纵向轻微起伏（相位随列错开）
    }

    /**
     * 绘制一只迷你小蜜蜂（椭圆身体 + 黄黑条纹 + 双翼扑动）
     * @param {number} x 蜂中心 x 坐标
     * @param {number} y 蜂中心 y 坐标
     * @param {number} flash 受击闪白强度 0~1，大于 0.5 时整体画白
     */
    function drawBeeMini(x, y, flash) {
        const white = flash > 0.5;
        const flap = Math.sin(ph * 18) * 2.2; // 翅膀高频扑动幅度
        // 双翼：半透明白，随扑动上下翻飞
        ctx.fillStyle = white ? '#ffffff' : 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.ellipse(x - 5, y - 3 - flap, 3.2, 1.8, -0.5 - flap * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 5, y - 3 - flap, 3.2, 1.8, 0.5 + flap * 0.1, 0, Math.PI * 2); ctx.fill();
        // 身体：黄色椭圆 + 霓虹光晕
        const body = white ? '#ffffff' : '#ffd23e';
        ctx.fillStyle = body;
        ctx.shadowColor = body;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.ellipse(x, y, 4.2, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        // 黑色条纹（受击闪白时省略，保持剪影干净）
        if (!white) {
            ctx.fillStyle = 'rgba(40,20,0,0.7)';
            ctx.fillRect(x - 1.6, y - 2.8, 1.5, 5.6);
            ctx.fillRect(x + 1.6, y - 2.2, 1.3, 4.4);
        }
    }

    /**
     * 小蜜蜂预览动画主循环：蜂群摆动、飞船扫射、子弹命中判定与重生调度
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = Math.min((t - last) / 1000, 0.05);
        last = t;
        ph += dt * 1.6;
        // 玩家飞船底部往返巡航
        const px = 80 + 38 * Math.sin(ph * 0.75 + 1);
        // 周期性发射子弹
        fireCd -= dt;
        if (fireCd <= 0) {
            bullets.push({ x: px, y: 134 });
            fireCd = 0.55;
        }
        // 子弹上升 + 蜂群命中判定（命中则闪白消失并进入重生倒计时）
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.y -= BULLET_SPEED * dt;
            let hit = false;
            for (const bee of BEES) {
                if (!bee.alive) continue;
                const [bx, by] = beePos(bee);
                if (Math.abs(b.x - bx) < 7 && Math.abs(b.y - by) < 7) {
                    bee.alive = false;
                    bee.respawn = 1.6;
                    bee.flash = 1;
                    hit = true;
                    break;
                }
            }
            if (hit || b.y < 8) bullets.splice(i, 1);
        }
        // 受击闪光衰减 + 被击落之蜂的重生倒计时
        for (const bee of BEES) {
            bee.flash = Math.max(0, bee.flash - dt * 4);
            if (!bee.alive) {
                bee.respawn -= dt;
                if (bee.respawn <= 0) bee.alive = true;
            }
        }

        ctx.clearRect(0, 0, 160, 160);
        // 蜂群编队
        for (const bee of BEES) {
            if (!bee.alive) continue;
            const [bx, by] = beePos(bee);
            drawBeeMini(bx, by, bee.flash);
        }
        // 子弹：白色霓虹细条
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ff3ea5';
        ctx.shadowBlur = 5;
        for (const b of bullets) ctx.fillRect(b.x - 1, b.y - 5, 2, 8);
        ctx.shadowBlur = 0;
        // 玩家飞船：青色三角战机
        ctx.fillStyle = '#35e0ff';
        ctx.shadowColor = '#35e0ff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(px, 132);
        ctx.lineTo(px - 8, 148);
        ctx.lineTo(px + 8, 148);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 华容道预览动画：横将让路 → 曹操 2×2 深红鎏金块探身出门 → 依次归位，出口微光呼吸 ----------
(function () {
    const cv = document.getElementById('klotskiPreview');
    const ctx = cv.getContext('2d');
    const G = 30, OX = 20, OY = 5; // 格 30px，棋盘 120×150，画布内水平居中
    // 静态棋子底座：竖将×4（青）+ 兵×2（粉），全程不动
    const statics = [
        { x: 0, y: 0, w: 1, h: 2, c: '#35e0ff' },
        { x: 3, y: 0, w: 1, h: 2, c: '#35e0ff' },
        { x: 0, y: 3, w: 1, h: 2, c: '#35e0ff' },
        { x: 3, y: 3, w: 1, h: 2, c: '#35e0ff' },
        { x: 1, y: 0, w: 1, h: 1, c: '#ff3ea5' },
        { x: 2, y: 0, w: 1, h: 1, c: '#ff3ea5' }
    ];
    // 动子：曹操 2×2 深红鎏金块 与 横将关羽 2×1 橙块
    const cao = { x: 1, y: 1, w: 2, h: 2 };
    const guan = { x: 1, y: 3, w: 2, h: 1 };
    // 循环动作脚本：横将下滑让路 → 曹操探身出门 → 曹操缩回 → 横将归位
    const script = [
        { p: guan, dx: 0, dy: 1 },
        { p: cao, dx: 0, dy: 1 },
        { p: cao, dx: 0, dy: -1 },
        { p: guan, dx: 0, dy: -1 }
    ];
    let si = 0;     // 当前动作序号
    let prog = 0;   // 当前动作滑动进度 0~1
    let wait = 0.5; // 动作间停顿倒计时（秒），>0 表示在停顿、无滑动补间
    let ph = 0;     // 出口呼吸相位
    let last = 0;

    /**
     * 绘制一枚像素风棋子：主色方块 + 顶部高光带（与街机厅像素星风格统一）
     * @param {object} p 棋子 { x, y, w, h }（格坐标）
     * @param {string} color 主色
     * @param {number} ox 滑动补间的像素偏移 x
     * @param {number} oy 滑动补间的像素偏移 y
     */
    function drawPiece(p, color, ox, oy) {
        const px = OX + p.x * G + ox, py = OY + p.y * G + oy;
        ctx.fillStyle = color;
        ctx.fillRect(px + 2, py + 2, p.w * G - 4, p.h * G - 4);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; // 顶部高光带
        ctx.fillRect(px + 4, py + 4, p.w * G - 8, 4);
    }

    /**
     * 华容道预览动画主循环：按"停顿 → 160ms 滑动一格"的节奏推进动作脚本，
     * 曹操探身到 y=2 时镀上金色光晕脉冲，底部出口同步呼吸微光
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = Math.min((t - last) / 1000, 0.05);
        last = t;
        ph += dt;
        // 动作调度：停顿倒计时归零后开始当前动作的滑动补间，滑满一格落位并进入下一停顿
        if (wait > 0) {
            wait -= dt;
        } else {
            prog += dt / 0.16; // 160ms 完成一格滑动
            if (prog >= 1) {
                const mv = script[si];
                mv.p.x += mv.dx; // 落格：写入整格坐标
                mv.p.y += mv.dy;
                si = (si + 1) % script.length;
                prog = 0;
                wait = 0.5; // 停顿半秒再走下一步，节奏从容
            }
        }
        // 当前动作的补间偏移（ease-out 收敛）
        const moving = wait > 0 ? null : script[si];
        const k = moving ? Math.min(prog, 1) : 0;
        const e = 1 - (1 - k) * (1 - k);
        const mox = moving ? moving.dx * G * e : 0;
        const moy = moving ? moving.dy * G * e : 0;

        ctx.clearRect(0, 0, 160, 160);
        // 棋盘底：深红木色 + 淡网格线
        ctx.fillStyle = '#1a0f12';
        ctx.fillRect(OX, OY, 4 * G, 5 * G);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let c = 1; c < 4; c++) { ctx.moveTo(OX + c * G + 0.5, OY); ctx.lineTo(OX + c * G + 0.5, OY + 5 * G); }
        for (let r = 1; r < 5; r++) { ctx.moveTo(OX, OY + r * G + 0.5); ctx.lineTo(OX + 4 * G, OY + r * G + 0.5); }
        ctx.stroke();
        // 出口开口：底边中央两格宽的红色缺口 + 呼吸金光（曹操的逃生门）
        const ex = OX + G, ew = 2 * G, ey = OY + 5 * G;
        ctx.strokeStyle = '#ff5540';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(OX, ey); ctx.lineTo(ex, ey);       // 底边左段
        ctx.moveTo(ex + ew, ey); ctx.lineTo(OX + 4 * G, ey); // 底边右段
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 210, 62, ${0.25 + 0.35 * (0.5 + 0.5 * Math.sin(ph * 2.4))})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(ex, ey - 2, ew, 4); // 出口呼吸微光条
        // 竖将与兵（静态）
        for (const s of statics) drawPiece(s, s.c, 0, 0);
        // 横将关羽：橙块（带滑动补间）
        drawPiece(guan, '#ff9a3e', mox, moy);
        // 曹操：金框深红块，探身到 y=2（临门）时叠加金色光晕脉冲
        const near = cao.y >= 2 || (moving && moving.p === cao && moving.dy > 0 && k > 0.5);
        if (near) {
            ctx.shadowColor = '#ffd23e';
            ctx.shadowBlur = 10 + 8 * Math.sin(ph * 5);
        }
        drawPiece(cao, '#8b2020', mox, moy);
        ctx.shadowBlur = 0;
        // 曹操鎏金"曹"字（中心 2×2 块内，含补间偏移）
        ctx.fillStyle = '#ffd23e';
        ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('曹', OX + cao.x * G + G + mox, OY + cao.y * G + G + moy);
        // 关羽"关"字（含补间偏移）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
        ctx.fillText('关', OX + guan.x * G + G + mox, OY + guan.y * G + G / 2 + moy);
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 1024预览动画：数字方块滑向同伴合并翻倍，白闪+光晕脉冲后数值逐级递升循环 ----------
(function () {
    const cv = document.getElementById('n1024Preview');
    const ctx = cv.getContext('2d');
    const G = 36, OX = 8, OY = 8; // 4×4 网格，格 36px，棋盘四周留 8px 边距
    // 数值 → 霓虹色映射（数值越高越暖，与游戏页方块配色阶梯呼应）
    const COLORS = { 2: '#35e0ff', 4: '#39ff6a', 8: '#ffd23e', 16: '#ff9a3e', 32: '#ff3ea5' };
    const CYCLE = 4;   // 单轮合并循环时长（秒）
    let ph = 0;        // 当前循环内已推进的时间（秒）
    let v = 2;         // 当前参与合并的数值（每轮翻倍，32 后回到 2）
    let last = 0;

    /**
     * 二次缓出插值（滑动收尾减速手感）
     * @param {number} k 归一化进度 0~1
     * @returns {number} 缓出后的进度
     */
    function easeOut(k) { k = Math.min(Math.max(k, 0), 1); return 1 - (1 - k) * (1 - k); }

    /**
     * 绘制一枚像素风数字方块：主色底 + 顶部高光带 + 数值文字，支持白闪与霓虹光晕
     * @param {number} gx 格列号（支持小数，用于滑动补间）
     * @param {number} gy 格行号
     * @param {number} val 方块数值
     * @param {number} flash 白闪强度 0~1（大于 0.5 时整体画白）
     * @param {number} glow 霓虹光晕强度 0~1
     */
    function drawTile(gx, gy, val, flash, glow) {
        const px = OX + gx * G, py = OY + gy * G;
        const c = COLORS[val] || '#ffffff';
        if (glow > 0) { ctx.shadowColor = c; ctx.shadowBlur = 14 * glow; }
        ctx.fillStyle = flash > 0.5 ? '#ffffff' : c;
        ctx.fillRect(px + 2, py + 2, G - 4, G - 4);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'; // 顶部高光带
        ctx.fillRect(px + 4, py + 4, G - 8, 3);
        // 数值文字：深底色反衬（Press Start 2P 缺省时退回等宽字体）
        ctx.fillStyle = '#0a0a14';
        ctx.font = 'bold 12px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(val, px + G / 2, py + G / 2 + 1);
    }

    /**
     * 1024预览动画主循环：时间轴分四段——滑动块滑入相邻格 → 停顿 →
     * 滑入目标块位置合并 → 翻倍块白闪+光晕脉冲展示；右下角四个小数值块静态展示配色阶梯
     * @param {number} t 当前帧时间戳（毫秒，由 requestAnimationFrame 传入）
     */
    function tick(t) {
        // 减少动效模式：只应答启动时的手动静态首帧（t=0），后续帧终止循环不再调度
        if (REDUCED_MOTION && t !== 0) return;
        // 游戏覆盖层打开期间跳过绘制仅保留调度，重置计时基准避免恢复时跳帧
        if (!lobbyFx.active) { last = t; requestAnimationFrame(tick); return; }
        const dt = Math.min((t - last) / 1000, 0.05);
        last = t;
        ph += dt;
        if (ph >= CYCLE) { ph = 0; v = v >= 32 ? 2 : v * 2; } // 一轮结束：数值翻倍并循环

        ctx.clearRect(0, 0, 160, 160);
        // 棋盘底与淡网格线
        ctx.fillStyle = '#0d1420';
        ctx.fillRect(OX, OY, 4 * G, 4 * G);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
            ctx.moveTo(OX + i * G + 0.5, OY); ctx.lineTo(OX + i * G + 0.5, OY + 4 * G);
            ctx.moveTo(OX, OY + i * G + 0.5); ctx.lineTo(OX + 4 * G, OY + i * G + 0.5);
        }
        ctx.stroke();

        // 阶段时间轴：[0,1.2) 滑入相邻格 / [1.2,1.7) 停顿 / [1.7,2.3) 滑入合并 / [2.3,4) 展示
        const T1 = 1.2, T2 = 1.7, T3 = 2.3;
        const row = 1; // 合并发生在第 1 行（0 起算）
        if (ph < T3) {
            // 滑动块 B：两段滑动均用 ease-out 补间（列号 0→1→2）
            let col;
            if (ph < T1) col = easeOut(ph / T1);
            else if (ph < T2) col = 1;
            else col = 1 + easeOut((ph - T2) / (T3 - T2));
            // 目标块 A：被合并前保持原值，B 到位时被其覆盖形成"并入"视觉
            drawTile(2, row, v, 0, 0);
            drawTile(col, row, v, 0, 0);
        } else {
            // 合并完成：翻倍块白闪渐隐 + 光晕呼吸脉冲
            const k = (ph - T3) / (CYCLE - T3);
            const flash = k < 0.25 ? 1 - k * 4 : 0;
            const glow = 0.55 + 0.45 * Math.sin(k * Math.PI);
            drawTile(2, row, v * 2, flash, glow);
        }
        // 右下角静态装饰块：展示数值→颜色的阶梯（2/4/8/16）
        drawTile(2, 2, 2, 0, 0);
        drawTile(3, 2, 4, 0, 0);
        drawTile(2, 3, 8, 0, 0);
        drawTile(3, 3, 16, 0, 0);
        requestAnimationFrame(tick);
    }
    if (REDUCED_MOTION) {
        // 减少动效：临时接通总开关手动绘制静态首帧（首帧即最终画面），不进入持续动画
        lobbyFx.active = true; tick(0); lobbyFx.active = false;
    } else {
        requestAnimationFrame(tick);
    }
})();

// ---------- 游戏覆盖层：以 iframe 打开所选游戏（不发生顶层导航，全屏状态跨大厅/游戏无缝保持） ----------
(function () {
    let overlay = null; // 当前覆盖层根元素（同一时间只保留一个游戏窗口）
    let totalBeforeOpen = null; // 打开游戏时的总分快照（返回大厅时比较是否涨分，涨分播破纪录号角）
    let openedCard = null; // 本次打开的游戏对应卡片元素（关机时作为末帧缩略图的飞回落点）
    const MIN_LOADING_MS = 450;      // LOADING 过渡最短展示时长，避免一闪而过显得突兀
    const LOADING_TIMEOUT_MS = 8000; // 加载超时兜底：load 事件迟迟不来也强制放行进入游戏

    /**
     * 关闭游戏覆盖层并还原页面滚动
     * 关闭不再直接淡出，而是播放 CRT 关机演出：游戏画面坍缩为过曝亮线（crtShrink）→
     * 白热余辉收束熄灭（crtDie）→ 黑底末段淡出露出大厅（overlayOut），0.55s 与开机
     * 白幕的仪式感形成"断电 → 通电"闭环；覆盖层左下角 ✕ 按钮经此路径
     */
    function closeGame() {
        if (!overlay) return;
        const el = overlay;
        overlay = null;
        document.body.style.overflow = '';
        // 通知游戏页保存进度镜像快照：关机动画（0.55s）期间 iframe 仍存活，
        // 子页在该消息处理器内同步写 localStorage，随后才随覆盖层移除，保存无感完成。
        // 游戏已结束时子页自行走清除分支，父页无需感知游戏状态
        const frame = el.querySelector('iframe');
        if (frame && frame.contentWindow) {
            // targetOrigin 取 POST_MSG_TARGET（见本脚本顶部定义）：http(s) 同源收紧为 '/'，file:// 直开回退 '*' 维持跨帧通信
            try { frame.contentWindow.postMessage({ type: 'arcade:save' }, POST_MSG_TARGET); } catch (e) { /* 忽略 */ }
        }
        // 关气回流缩略：截取游戏画布末帧，CRT 坍缩为过曝亮线后缩略图接棒绽放、缩放飞回
        // 对应卡片（叙事闭环——"画面装回卡带"）。截图/动画全链路 try-catch，任何失败
        // （跨源、画布为空、LOADING 中关闭）静默跳过，退回原 CRT 关机演出；减动效不启动
        flyBackSnapshot(frame, openedCard);
        openedCard = null; // 落点引用用后即清，防止异常路径残留
        // 关机演出启动前先恢复大厅动效与 BGM：演出进行到黑底开始淡出（64%）时，
        // 露出的大厅已处于活动状态，BGM 恰在演出结束前后淡入，衔接无缝
        document.body.classList.remove('game-open');
        lobbyFx.active = true;
        SFX.bgm.resume(); // 恢复大厅迎宾曲（音效总开关关闭或未请求播放时为无害空操作）
        el.classList.add('overlay-out');
        let removed = false;
        const remove = () => {
            if (removed) return;
            removed = true;
            el.remove();
            // 从游戏返回大厅：主动刷新 BEST（游戏在 iframe 内写入的最高分即时上屏，
            // 与 storage 事件兜底双保险）
            refreshBest();
            // 游玩时长角标同步刷新：子页 arcade:playtime 上报的累计秒数已随游玩落盘
            refreshTimeBadges();
            // 总分上涨（本次游玩刷新了某款最高分）：播放破纪录号角庆祝
            const totalNow = readTotal();
            if ((totalBeforeOpen || 0) < (totalNow || 0)) SFX.newRecord();
            totalBeforeOpen = null; // 快照用后即清，防止异常路径误触发
        };
        // 演出结束后再移除节点；只认覆盖层自身的 animationend——✕ 按钮 0.15s 快速隐去、
        // iframe 坍缩等子元素动画的 animationend 会冒泡上来，按 target 过滤避免提前摘层
        el.addEventListener('animationend', e => { if (e.target === el) remove(); });
        // 兜底：系统禁用动画、后台标签暂停等极端场景下超时强制移除
        setTimeout(remove, 600);
    }

    /**
     * 关气回流缩略演出：截取游戏 iframe 内主画布的最后一帧，待 CRT 关机坍缩为过曝亮线后
     * （起飞延时 0.28s，衔接 crtShrink 55% ≈ 0.30s 亮线时刻），缩略图先"绽放"回全屏末帧
     * 画面，再缩放飞向启动该游戏的卡片原位（FLIP：布局直接定在落点、起始帧用 transform
     * 反演回全屏位置），落卡时卡片辉光脉冲点亮（card-reflow）——完成"游戏关机 → 画面
     * 装回卡带"的叙事闭环；总时长约 0.64s，与 0.55s 关机窗口尾部重叠、覆盖层移除后收尾
     * @param {HTMLIFrameElement|null} frame 游戏 iframe（内含游戏主画布）
     * @param {Element|null} card 启动该游戏的卡片元素（飞回落点）；null 或截图失败时整体跳过
     */
    function flyBackSnapshot(frame, card) {
        if (REDUCED_MOTION || !frame || !card) return; // 减少动效：仅保留原 CRT 关机演出
        try {
            // 从 iframe 内挑选像素面积最大的画布作为游戏主画布（部分游戏存在静态层等辅助画布）
            const doc = frame.contentDocument;
            if (!doc) return;
            let best = null, bestArea = 0; // bestArea：当前最大画布像素面积
            const list = doc.querySelectorAll('canvas');
            for (let i = 0; i < list.length; i++) {
                const area = (list[i].width || 0) * (list[i].height || 0);
                if (area > bestArea) { bestArea = area; best = list[i]; }
            }
            if (!best) return; // 游戏页尚未就绪（LOADING 中关闭）等场景：跳过演出
            const data = best.toDataURL('image/png'); // 同步截帧：阻塞仅数毫秒，置于 save 消息之后不影响保存
            if (data.length < 128) return; // 空画布（toDataURL 返回 "data:,"）时跳过演出
            // FLIP 反演参数：f = 全屏起始矩形（iframe），c = 卡片落点矩形
            const f = frame.getBoundingClientRect();
            const c = card.getBoundingClientRect();
            if (!f.width || !c.width) return;
            const img = new Image();
            img.className = 'reflow-shot';
            img.src = data;
            img.alt = '';
            // 缩略图描边/辉光跟随所玩游戏的卡片主题色，飞回途中与落点卡片色彩同源
            img.style.setProperty('--reflow-glow', card.style.getPropertyValue('--glow').trim() || '255, 210, 62');
            // 布局直接落在卡片矩形（正向），动画帧内再反演到全屏位置（反向）
            img.style.left = c.left + 'px';
            img.style.top = c.top + 'px';
            img.style.width = c.width + 'px';
            img.style.height = c.height + 'px';
            document.body.appendChild(img);
            // 起飞延时 0.28s：等 CRT 画面坍缩为过曝亮线（crtShrink 55% ≈ 0.30s）再接棒绽放
            setTimeout(() => {
                const sx = f.width / c.width, sy = f.height / c.height; // 全屏 → 卡片的缩放比
                const tx = f.left - c.left, ty = f.top - c.top;         // 全屏 → 卡片的平移量
                const anim = img.animate([
                    // 亮线形态起飞：全屏宽、纵向压扁与 CRT 断电亮线衔接，中心对准原画面垂直中线
                    { transform: 'translate(' + tx + 'px, ' + (ty + f.height / 2) + 'px) scale(' + sx + ', 0.004)', opacity: 1, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
                    // 绽放为完整末帧：缩略图撑满原游戏画面区域（光点"回放"出最后一帧）
                    { transform: 'translate(' + tx + 'px, ' + ty + 'px) scale(' + sx + ', ' + sy + ')', opacity: 1, offset: 0.3, easing: 'cubic-bezier(0.5, 0.05, 0.35, 1)' },
                    // 缩放飞落卡片原位：画面"装回卡带"
                    { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 0.95 }
                ], { duration: 360, fill: 'forwards' });
                anim.onfinish = () => {
                    // 落卡：卡片辉光脉冲点亮（承接飞回的余温），缩略图短淡出后移除
                    card.classList.add('card-reflow');
                    setTimeout(() => card.classList.remove('card-reflow'), 700);
                    img.style.transition = 'opacity 0.16s ease-out';
                    img.style.opacity = '0';
                    setTimeout(() => img.remove(), 180);
                };
            }, 280);
        } catch (e) { /* 跨源 / 画布被清空 / 加载中关闭等异常：静默跳过，退回原关机演出 */ }
    }

    /**
     * 打开游戏覆盖层：iframe 加载指定游戏页（附加 embed=1 通知子页启用嵌入通信模式）。
     * 先以黑底霓虹 LOADING 占位并冻结大厅动效（把主线程让给游戏首秒渲染），
     * 游戏页加载完成后交叉淡入，避免白屏闪跳，体验如同插上卡带
     * @param {string} url 游戏页地址（来自卡片 href）
     * @param {string} glowRgb 卡片霓虹色 RGB 串（如 "255, 210, 62"），用于 LOADING 文案配色
     * @param {Element} card 被点击的卡片元素，记为关机回流缩略的飞回落点
     */
    function openGame(url, glowRgb, card) {
        if (overlay) return; // 防连点重入：已有覆盖层时忽略本次激活（快速连点第二下不再触发"关闭-重开"导致游戏重复加载）；覆盖层存在时卡片本就被遮罩不可点，此处仅兜底
        // 打开游戏：挂起大厅 BGM（游戏页 iframe 内有自己的 AudioContext 播各自曲目，互不混音），
        // 并快照当前总分，返回大厅时比较是否涨分
        SFX.bgm.pause();
        totalBeforeOpen = readTotal();
        openedCard = card || null; // 记录落点：closeGame 时末帧缩略图飞回这张卡片
        overlay = document.createElement('div');
        overlay.id = 'gameOverlay';
        // 冻结大厅动效：CSS 动画由 body.game-open 暂停，JS 动画循环由 lobbyFx 开关跳过绘制
        document.body.classList.add('game-open');
        lobbyFx.active = false;
        const frame = document.createElement('iframe');
        // 全屏状态由本页（顶层文档）持有，iframe 切换游戏不触发导航，故全屏全程保持
        frame.src = url + (url.includes('?') ? '&' : '?') + 'embed=1';
        // feature policy 授权：fullscreen 允许游戏页内的全屏按钮请求全屏（全屏状态由本页持有，
        // iframe 切换游戏不触发导航，故全屏全程保持）；gamepad 允许游戏 iframe 内的 gamepad.js
        // 轮询手柄——Gamepad feature policy 默认仅 'self'，file:// 直开时各帧为 opaque origin，
        // 不显式授权则 iframe 内拿不到手柄数据，手柄会在游戏内失效
        frame.allow = 'fullscreen; gamepad';
        frame.title = '游戏窗口';
        // LOADING 占位层：霓虹文案 + 流光进度条，配色跟随所点卡片的主题色
        const loading = document.createElement('div');
        loading.className = 'overlay-loading';
        loading.style.setProperty('--loading-glow', glowRgb || '255, 210, 62');
        loading.innerHTML = '<div class="loading-text">LOADING</div><div class="loading-bar"><i></i></div>';
        const openedAt = performance.now(); // 用于保证 LOADING 最短展示时长
        let done = false; // 防止 load 与超时兜底重复触发 reveal
        /**
         * 加载完成（或超时放行）后的交叉淡入：游戏画面淡入、LOADING 占位层淡出
         */
        const reveal = () => {
            if (done || !frame.isConnected) return; // 覆盖层已被关闭则直接放弃
            done = true;
            // 不足最短展示时长时延迟到满，保证过渡节奏稳定
            const wait = Math.max(0, MIN_LOADING_MS - (performance.now() - openedAt));
            setTimeout(() => {
                frame.classList.add('frame-in');      // 游戏画面淡入
                loading.classList.add('loading-out'); // LOADING 层淡出
                // 占位层过渡（0.4s）结束后移除，让 iframe 独占覆盖层
                setTimeout(() => loading.remove(), 450);
                // 加载完成后聚焦游戏窗口，保证键盘操作无需先点击一次
                try { frame.contentWindow.focus(); } catch (e) { /* 忽略 */ }
            }, wait);
        };
        frame.addEventListener('load', reveal);
        setTimeout(reveal, LOADING_TIMEOUT_MS);
        const close = document.createElement('button');
        close.className = 'overlay-close';
        close.textContent = '✕ 返回游戏厅';
        // ✕ 按钮配色跟随所点卡片主题色（与该游戏页音效/全屏开关、页内返回链接同源）
        close.style.setProperty('--close-glow', glowRgb || '255, 210, 62');
        close.addEventListener('click', closeGame);
        overlay.appendChild(frame);
        overlay.appendChild(loading);
        overlay.appendChild(close);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden'; // 冻结底层大厅滚动
    }

    // 拦截卡片默认跳转，改为覆盖层打开；href 保留作为无 JS 环境的回退入口
    document.querySelectorAll('.card').forEach(card => {
        card.setAttribute('draggable', 'false'); // 禁用链接原生拖拽：按住卡片轻微拖动不再出现拖影/吞掉点击（mouseup 落点偏移致 click 不触发的"点了没反应"）
        card.addEventListener('click', e => {
            e.preventDefault();
            if (overlay) return; // 防重入早退：覆盖层已存在（游戏打开中/快速连点/长按 Enter 键系统重复激活）时忽略本次点击，避免重复写 localStorage 与刷新角标
            // 点亮过渡守卫：点击卡片的 pointerdown 投币已同步摘除 pre-coin 门禁，同一手势
            // 后续派发的 click 若放行会立刻启动游戏（卡带过渡盖住金币演出）。lights-on 类
            // 存续期间（投币后约 6.0 秒 = 金币飞行 2.7s + 分层点亮波浪最长约 3.0s）静默吞掉本次点击——只投币，不启动
            if (document.body.classList.contains('lights-on')) return;
            // 记录本次启动的游戏为「上次游玩」（本页写入不触发本页 storage 事件，需手动刷角标）
            try {
                localStorage.setItem(LAST_PLAYED_KEY, cardGameId(card.getAttribute('href')));
            } catch (e) { /* 隐私模式：写失败静默，游戏照常启动 */ }
            refreshLastBadge();
            // 取卡片内联的霓虹色作为 LOADING 过渡主题色，并把卡片本身传入作为关机回流缩略落点
            openGame(card.getAttribute('href'), card.style.getPropertyValue('--glow').trim(), card);
        });
    });

    // 子页消息：arcade:playtime = 游玩时长冲账（父页累计落盘 arcade_playtime_<id> 并刷新卡片角标）
    window.addEventListener('message', e => {
        // 来源校验：仅接受同源消息；file:// 直开时本页与子页 origin 字面量均为 "null"，
        // 仅当本页自身也是 file:// 协议时一并放行；其余来源（第三方页面嵌入本页等）一律
        // 忽略，防止伪造关闭覆盖层。http(s) 部署下不再永久豁免 'null' 来源
        if (e.origin !== location.origin && !(e.origin === 'null' && location.protocol === 'file:')) return;
        const d = e.data;
        // 游玩时长上报：子页 FX.playtime 周期冲账，父页累计落盘并刷新卡片角标
        if (d && d.type === 'arcade:playtime' && PLAYTIME_IDS.indexOf(d.id) !== -1
            && typeof d.seconds === 'number' && d.seconds > 0) {
            addPlaytime(d.id, d.seconds);
            refreshTimeBadges();
        }
    });
})();

// ---------- 卡片音效：悬停播放对应游戏特色音，点击播放该游戏的另一款代表音效 ----------
(function () {
    // 卡片链接 → 音效映射（不同游戏不同音色）
    const cardSfx = {
        'snake.html': { hover: SFX.cardSnake, click: SFX.start },
        'tetris.html': { hover: SFX.cardTetris, click: SFX.tLevelUp },
        'pac.html': { hover: SFX.cardPac, click: SFX.pacReady },
        'pinball.html': { hover: SFX.cardPinball, click: SFX.pinLaunch },
        'bee.html': { hover: SFX.cardBee, click: SFX.start },
        'klotski.html': { hover: SFX.cardKlotski, click: SFX.klSelect },
        '1024.html': { hover: SFX.cardN1024, click: () => SFX.n1024Merge(32) }
    };
    document.querySelectorAll('.card').forEach(card => {
        // 以去掉缓存版本号（?v=...）后的路径为键查表，避免带版本号的 href 匹配失效
        const sfx = cardSfx[card.getAttribute('href').split('?')[0]];
        if (!sfx) return;
        // 未投币（机台未通电）时悬停/点击不出声，投币点亮后恢复音效反馈
        card.addEventListener('mouseenter', () => {
            if (!document.body.classList.contains('pre-coin')) sfx.hover();
        });
        card.addEventListener('click', () => {
            if (!document.body.classList.contains('pre-coin')) sfx.click();
        });
    });
})();

// ---------- 卡片 3D 视差倾斜：光标在卡片内移动时轻微 3D 倾斜，移开平滑复位 ----------
(function () {
    if (REDUCED_MOTION) return; // 减少动效：卡片不进行 3D 倾斜跟随
    const MAX_TILT = 8; // 最大倾角（度），保证细腻不夸张
    // 卡片 → 矩形缓存：mousemove 高频路径只读缓存并只写 transform，避免读写交替强制回流；
    // 缓存于 mouseenter 时测量，此时卡片尚无倾斜 transform，测量不受其影响
    const rects = new Map();
    // 窗口缩放/页面滚动都会改变卡片视口矩形：整体作废缓存，下次进入卡片时重新测量
    window.addEventListener('resize', () => rects.clear());
    window.addEventListener('scroll', () => rects.clear(), { passive: true });
    document.querySelectorAll('.card').forEach(card => {
        // 进入卡片：测量一次矩形并缓存
        card.addEventListener('mouseenter', () => rects.set(card, card.getBoundingClientRect()));
        /**
         * 光标移动：按相对卡片中心的偏移计算 rotateX/rotateY（叠加悬停上浮量）
         * @param {MouseEvent} e 鼠标移动事件
         */
        card.addEventListener('mousemove', e => {
            let r = rects.get(card);
            // 兜底：悬停期间缓存被 resize/scroll 作废，此处补测一次后继续复用
            if (!r) { r = card.getBoundingClientRect(); rects.set(card, r); }
            const nx = (e.clientX - r.left) / r.width * 2 - 1;  // 横向偏移归一化 -1~1
            const ny = (e.clientY - r.top) / r.height * 2 - 1;  // 纵向偏移归一化 -1~1
            // perspective() 写在每张卡片自身 transform 内：灭点即卡片中心，
            // 与卡片在网格中的位置无关，所有卡片倾斜程度完全一致（贪吃蛇同参数标准）
            // 内联 transform 优先于 CSS 悬停规则，故需自带 translateY(-6px)
            card.style.transform = `perspective(900px) translateY(-6px) rotateX(${(-ny * MAX_TILT).toFixed(2)}deg) rotateY(${(nx * MAX_TILT).toFixed(2)}deg)`;
        });
        // 移开卡片：清空内联 transform，回落到 CSS 规则并借助过渡平滑复位；矩形缓存一并丢弃
        card.addEventListener('mouseleave', () => { rects.delete(card); card.style.transform = ''; });
    });
})();

// ---------- 鼠标霓虹光晕：光斑经 lerp 平滑追随光标，悬停卡片时同步该卡片的霓虹色 ----------
(function () {
    if (REDUCED_MOTION) return; // 减少动效：光晕不跟随光标（CSS 侧已停用其过渡）
    const glow = document.createElement('div');
    glow.id = 'mouseGlow';
    document.body.appendChild(glow);
    const DEFAULT_BG = 'radial-gradient(circle, rgba(108, 108, 255, 0.10), transparent 65%)';
    const coinSlot = document.getElementById('coinSlot'); // 页脚投币口（悬停卡片换色联动）
    const SLOT_GOLD = '255, 210, 62';                     // 投币口默认金色
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2; // 目标位置（光标）
    let x = tx, y = ty;                                          // 当前位置（经缓动）
    let shown = false;
    window.addEventListener('pointermove', e => {
        tx = e.clientX;
        ty = e.clientY;
        // 首次移动才显示，避免触屏设备一进页面就出现光斑
        if (!shown) { shown = true; x = tx; y = ty; glow.style.opacity = '1'; }
    });
    // 悬停卡片时光晕与页脚投币口染上该卡片的霓虹色，移开后恢复默认蓝紫/金色
    document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            // --glow 为内联样式变量（每张卡片 HTML 均已写入），直接读内联免去 getComputedStyle 强制样式计算
            const rgb = card.style.getPropertyValue('--glow').trim();
            glow.style.background = `radial-gradient(circle, rgba(${rgb}, 0.13), transparent 65%)`;
            if (coinSlot) coinSlot.style.setProperty('--slot-glow', rgb); // 投币口同步悬停卡片色
        });
        card.addEventListener('mouseleave', () => {
            glow.style.background = DEFAULT_BG;
            if (coinSlot) coinSlot.style.setProperty('--slot-glow', SLOT_GOLD); // 投币口回默认金色
        });
    });
    (function loop() {
        // 游戏覆盖层打开期间跳过光晕跟随仅保留调度，恢复后从当前位置继续平滑追随
        if (!lobbyFx.active) { requestAnimationFrame(loop); return; }
        x += (tx - x) * 0.12; // 线性插值产生拖尾跟随感
        y += (ty - y) * 0.12;
        glow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        requestAnimationFrame(loop);
    })();
})();

// ---------- 音效激活提示：浏览器策略要求首次交互后才能出声，交互后淡出 ----------
(function () {
    const hint = document.getElementById('soundHint');
    if (!hint) return;
    // 音效已关闭时无需提示，直接移除
    if (!SFX.enabled) { hint.remove(); return; }
    /**
     * 首次交互（点击或按键）后淡出提示条：加 hide 类触发 0.5s 透明度过渡，
     * 600ms 后从 DOM 移除，并解除两个事件监听避免重复触发
     */
    const dismiss = () => {
        hint.classList.add('hide'); // 触发淡出过渡
        setTimeout(() => hint.remove(), 600);
        window.removeEventListener('pointerdown', dismiss);
        window.removeEventListener('keydown', dismiss);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
})();

// ---------- 投币口：机台未通电黑白待机（pre-coin），投币点亮恢复霓虹并解锁卡片 ----------
// 街机「投币开机」仪式：页面载入即黑白待机，INSERT COIN 快闪 + 投币口呼吸发光引导；
// 点击屏幕任意处（或按任意键）即投币——金币先在屏幕中央放大展示、蓄力光环迸发，
// 再沿抛物线逐渐缩小飞入投币口吞币（SFX.coin 投币音效）；首次投币与 audio.js 首次
// 手势的解锁双音同刻，而全场点亮（lights-on）延迟到币落缝口的吞币瞬间才分层启动
// （动画延迟 2.7s = 金币两幕演出总时长），解锁卡片；此后投币口点击或回车键均可
// 重复投币演出（纯装饰，点亮态保持常驻）。回车为投币专用键（默认激活被阻断，不会
// 误启动聚焦的游戏卡片），启动游戏统一走空格或鼠标；投币后约 6.0s（金币飞行 2.7s +
// 分层点亮波浪最长约 3.0s）内的卡片点击被静默吞没，防止投币同手势直接开游戏
(function () {
    const slot = document.getElementById('coinSlot');
    if (!slot) return;
    let inserted = false; // 点亮解锁仅一次：黑白待机经首次投币切换为霓虹常亮
    // 币面铭文 SVG（站名 Flag 沿币缘弧形环排，模拟纪念币版式）：上弧「姜米条条的」顺弧拱起
    // （字头朝外），下弧「像素街机厅」倒拱正读（path 逆时针方向使字头顶向圆心，实体币惯例）；
    // 配外缘珠点环（圆点虚线描边仿铣边珠纹）、两侧菱形饰（填补上下弧铭文在 3/9 点位的间隙）、
    // 中央章面 + 四芒星徽记；铭文双层叠印——亮金垫层整体下移 0.55 单位露出下缘受光高光，
    // 暗金主体层在上，合成凹刻浮雕感。
    // viewBox 100×100 与 .coin-fly（14px 币体）同构：字号 10 单位在 scale 9.5 展示态约
    // 13.3px 清晰可读，飞行缩小随币等比渐隐——SVG 文本不受浏览器最小字号限制，任意缩放不糊。
    // 上下弧 path 半径错层（34 / 40）：上弧字身向外长、下弧字身向内长，两行铭文带居中对称
    const COIN_FACE_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true">' +
        '<defs>' +
        '<path id="coinArcTop" d="M16,50 A34,34 0 0 1 84,50"/>' + // 上弧：自左经顶至右（顺时针），弧半径 34
        '<path id="coinArcBottom" d="M10,50 A40,40 0 0 0 90,50"/>' + // 下弧：自左经底至右（逆时针），字头朝圆心正读
        '</defs>' +
        // 外缘珠点环
        '<circle cx="50" cy="50" r="45.5" fill="none" stroke="rgba(122,72,0,.5)" stroke-width="1.6" stroke-dasharray="0.1 4.3" stroke-linecap="round"/>' +
        // 中央章面 + 四芒星徽记
        '<circle cx="50" cy="50" r="24" fill="rgba(255,247,207,.4)" stroke="rgba(124,74,0,.35)" stroke-width="0.7"/>' +
        '<path d="M50,40 L52.2,47.8 L60,50 L52.2,52.2 L50,60 L47.8,52.2 L40,50 L47.8,47.8 Z" fill="rgba(124,74,0,.82)"/>' +
        // 两侧菱形饰
        '<rect x="11.4" y="48.4" width="3.2" height="3.2" transform="rotate(45 13 50)" fill="rgba(124,74,0,.75)"/>' +
        '<rect x="85.4" y="48.4" width="3.2" height="3.2" transform="rotate(45 87 50)" fill="rgba(124,74,0,.75)"/>' +
        // 铭文亮金垫层（凹刻下缘受光高光）
        '<g fill="rgba(255,244,200,.6)" transform="translate(0,.55)" font-size="10" font-weight="700" letter-spacing="2.5" text-anchor="middle">' +
        '<text><textPath href="#coinArcTop" startOffset="50%">姜米条条的</textPath></text>' +
        '<text><textPath href="#coinArcBottom" startOffset="50%">像素街机厅</textPath></text></g>' +
        // 铭文暗金主体层
        '<g fill="rgba(124,74,0,.92)" font-size="10" font-weight="700" letter-spacing="2.5" text-anchor="middle">' +
        '<text><textPath href="#coinArcTop" startOffset="50%">姜米条条的</textPath></text>' +
        '<text><textPath href="#coinArcBottom" startOffset="50%">像素街机厅</textPath></text></g>' +
        '</svg>';
    /**
     * 投币演出（两幕）：播投币音效后——
     * 第一幕·中央展示（1.65s）：大金币（币缘弧形环排站名铭文，内嵌 SVG，见 COIN_FACE_SVG）
     *   在屏幕正中回弹式弹出（scale 9.5，直径约 133px），轻微摇摆悬停展示约 1.15s 供玩家
     *   看清币面铭文，末段蓄力脉冲（先胀后收 + 摆幅晃动），1.42s 时迸发一圈蓄力光环；
     * 第二幕·抛物线飞入（1.05s）：自屏幕中央起跳，先减速上抛过拱顶、再加速下坠收进投币口，
     *   全程逐渐缩小（9.5 → 7.2 → 0.55）并自旋一周，抵达时吞币演出——投币口脉冲震颤
     *   + 缝口闪光圈 + 金火花四溅 + 金属吞币落箱音（SFX.coinSwallow）；
     * 币落缝口瞬间即首次投币的点亮时刻（lights-on 波浪动画延迟 2.7s = 两幕总时长，
     * 恰在此刻启动，见 insertCoin）；点亮前后每次触发均重播（重复投币为纯装饰演出）
     */
    function coinDrop() {
        SFX.coin(); // 投币音效（静音时静默；首次与解锁双音同款叠加，更响亮醒耳）
        if (REDUCED_MOTION) return; // 减少动效偏好：仅出声，无飞行演出
        const r = slot.getBoundingClientRect();
        const tx = r.left + r.width / 2, ty = r.top + r.height / 2; // 投币口中心（终点）
        const cx = innerWidth / 2, cy = innerHeight / 2; // 屏幕正中：金币展示台（起点）
        const coin = document.createElement('i'); // 一次性飞行金币（fixed 定位不参与布局）
        coin.className = 'coin-fly';
        coin.innerHTML = COIN_FACE_SVG; // 币缘环排站名铭文（SVG 随币等比缩放，版式见 COIN_FACE_SVG 注释）
        // 内联基线与展示首帧一致（中心 scale 0 隐身）：两幕动画衔接的空档帧退回基线时
        // 不会闪现左上角小币，展示结束到起飞动画接管之间保持隐形
        coin.style.transform = `translate(${cx}px, ${cy}px) scale(0)`;
        coin.style.opacity = '0';
        document.body.appendChild(coin);
        // 第一幕：回弹式弹出 → 悬停展示 → 末段蓄力脉冲（胀起再收拢）。
        // rotateY 仅做 ±14° 轻微摇摆（不再整周自旋）：币面刻字始终朝向观众清晰可读，
        // 摇摆本身呈现「蓄力晃动」的实体感；rotateY 幅度小则币面永不侧翻压扁
        coin.animate([
            { transform: `translate(${cx}px, ${cy}px) rotateY(-14deg) scale(0)`, opacity: 0, easing: 'cubic-bezier(.34,1.4,.64,1)' }, // 回弹弹出（过冲回落）
            { transform: `translate(${cx}px, ${cy}px) rotateY(10deg) scale(9.5)`, opacity: 1, offset: 0.16 }, // 弹至全大（直径约 133px）
            { transform: `translate(${cx}px, ${cy}px) rotateY(-12deg) scale(9)`, offset: 0.7 },  // 悬停展示（轻微摇摆）
            { transform: `translate(${cx}px, ${cy}px) rotateY(9deg) scale(10.5)`, offset: 0.86, easing: 'ease-in' }, // 蓄力胀起
            { transform: `translate(${cx}px, ${cy}px) rotateY(0deg) scale(9.5)` } // 收拢摆正待发
        ], { duration: 1650 });
        // 蓄力高峰（约 1.42s，脉冲顶点）迸发一圈金色光环：自中心扩散淡出，为起飞送行
        setTimeout(() => {
            const ring = document.createElement('i');
            ring.className = 'coin-burst';
            document.body.appendChild(ring);
            ring.animate([
                { transform: `translate(${cx}px, ${cy}px) scale(0.8)`, opacity: 0.95 },
                { transform: `translate(${cx}px, ${cy}px) scale(5.8)`, opacity: 0 } // 终径约 174px，完整包住 133px 大币
            ], { duration: 440, easing: 'cubic-bezier(.22,.61,.36,1)' }).onfinish = () => ring.remove();
        }, 1420);
        // 第二幕：展示结束（1.65s）自屏幕中央起跳——三关键帧抛物线：中央减速上抛 →
        // 拱顶（水平行程 45% 处、抬升幅度随垂直行程放大，构成先扬后落的饱满抛物弧）→
        // 加速下坠收进投币口；分段缓动模拟重力（上抛 ease-out / 下坠 ease-in）；全程逐渐缩小。
        // 关键：三帧必须显式携带 opacity:1——元素内联基线 opacity 为 0（两幕衔接空档帧隐形用），
        // 动画缺 opacity 属性时会保持内联值导致第二幕全程隐形飞行（曾因此只见展示不见飞入）。
        // 飞行中 rotateY 自旋一周（0→360°）：实体硬币翻转感，落币时刻恰好回正
        setTimeout(() => {
            const rise = Math.max(130, Math.round((cy - ty) * 0.32)); // 拱顶抬升：随起终点垂直行程放大（长视口弧更饱满），矮视口保底 130px
            const mx = cx + (tx - cx) * 0.45, my = Math.min(cy, ty) - rise; // 拱顶：起终点连线中点上方再抬升
            coin.animate([
                { transform: `translate(${cx}px, ${cy}px) rotateY(0deg) scale(9.5)`, opacity: 1, easing: 'cubic-bezier(.22,.61,.36,1)' }, // 上抛减速（离手势）
                { transform: `translate(${mx}px, ${my}px) rotateY(180deg) scale(7.2)`, opacity: 1, offset: 0.45, easing: 'cubic-bezier(.5,.05,.72,.32)' }, // 拱顶折返（翻转至背面一瞬），重力加速坠落
                { transform: `translate(${tx}px, ${ty}px) rotateY(360deg) scale(0.55)`, opacity: 1 } // 缩为小币回正落入缝中
            ], { duration: 1050 }).onfinish = () => {
                coin.remove();
                // 吞币脉冲：弹起放大 + 机械震颤（先复位动画基线，连点投币每次都重播脉冲）
                slot.classList.remove('swallow');
                void slot.offsetWidth;
                slot.classList.add('swallow');
                setTimeout(() => slot.classList.remove('swallow'), 500);
                // 吞币音效：低频落箱"咚" + 金属余韵（与投币双音形成「起币/落币」呼应）
                SFX.coinSwallow();
                // 缝口闪光圈 + 金火花四溅：币片撞入金属缝口的碰撞演出（吞币收尾的娱乐性增彩）
                spawnSlotFlash(tx, ty);
                spawnSlotSparks(tx, ty);
            };
        }, 1650);
    }

    /**
     * 吞币闪光：金币抵达投币口瞬间，缝口迸出一圈金色椭圆光圈快速扩散淡出
     * （一次性元素，动画结束即移除；与蓄力光环同思路，为吞币收尾补一道高光）
     * @param {number} x 投币口中心 X（光圈源点）
     * @param {number} y 投币口中心 Y（光圈源点）
     */
    function spawnSlotFlash(x, y) {
        const flash = document.createElement('i');
        flash.className = 'slot-flash';
        document.body.appendChild(flash);
        flash.animate([
            { transform: `translate(${x}px, ${y}px) scale(0.5)`, opacity: 0.95 },
            { transform: `translate(${x}px, ${y}px) scale(2.4)`, opacity: 0 } // 扩散至约 62×29px 淡出
        ], { duration: 460, easing: 'cubic-bezier(.22,.61,.36,1)' }).onfinish = () => flash.remove();
    }

    /**
     * 吞币火花：金币撞击缝口迸出 10 颗金色小火花——左右交替向斜上方抛射，
     * 随后受重力坠落、缩小淡出（每颗独立 WAAPI 动画，结束即移除；
     * 散射距离与时长均随机，让每次吞币的火星迸溅形态都不重样）
     * @param {number} x 投币口中心 X（火花源点）
     * @param {number} y 投币口中心 Y（火花源点）
     */
    function spawnSlotSparks(x, y) {
        for (let i = 0; i < 10; i++) {
            const spark = document.createElement('i');
            spark.className = 'coin-spark';
            document.body.appendChild(spark);
            const side = i % 2 ? 1 : -1;                        // 左右两侧交替喷溅（对称感）
            const dx = side * (8 + Math.random() * 26);         // 水平散射距离（8~34px）
            const dy = -(6 + Math.random() * 18);               // 先向上迸起（6~24px）
            const fall = dy + 16 + Math.random() * 14;          // 坠落终点（抛物顶点后再落 16~30px）
            spark.animate([
                { transform: `translate(${x}px, ${y}px) scale(${0.8 + Math.random() * 0.5})`, opacity: 1 },
                { transform: `translate(${x + dx * 0.55}px, ${y + dy}px) scale(1)`, opacity: 0.9, offset: 0.38 }, // 抛物顶点
                { transform: `translate(${x + dx}px, ${y + fall}px) scale(0.35)`, opacity: 0 } // 受重力坠落淡出
            ], { duration: 380 + Math.random() * 240, easing: 'cubic-bezier(.25,.5,.45,1)' }).onfinish = () => spark.remove();
        }
    }
    /**
     * 首次投币解锁：挂 lit 点亮投币口、摘 pre-coin 门禁并挂 lights-on——
     * 其分层通电动画延迟 2.7s（= 金币两幕演出总时长），恰在币落缝口的吞币瞬间
     * 才自灰度逐层亮起（环境电源层 → 副标题 → 标题灯管三抽搐点火 → 总分条 →
     * 七张卡片幕帘逐张点亮）、解锁游戏卡片（仅首次触发，重复调用幂等短路；点亮态此后常驻）
     */
    function insertCoin() {
        if (inserted) return;
        inserted = true;
        slot.classList.add('lit'); // 点亮投币口：减少动效偏好下仅静态亮起，无飞行演出
        // 通电点亮：摘黑白待机态、挂点亮类——金币飞行途中动画处于延迟等待，全场经
        // fill-mode both 保持 0% 灰度帧（黑白待机观感不变）；2.7s 后币落缝口、波浪
        // 点亮启动（环境光层先亮，副标题/标题/总分条/卡片区按阶梯依次通电），
        // 两态关键帧首尾一致故同帧切换无闪跳；减少动效偏好下无飞行演出、CSS 亦停用
        // 动画（延迟随之失效），摘类即瞬变彩色
        document.body.classList.add('lights-on');
        document.body.classList.remove('pre-coin');
        setTimeout(() => document.body.classList.remove('lights-on'), 6000); // 金币演出 2.7s + 最晚卡片幕帘 5.25s + 动画 0.45s ≈ 5.7s，留余量摘类清理
    }
    // 鼠标路径：点击投币口即投币——每次点击都有完整的中央展示+抛物线飞入演出；
    // 首次投币顺带点亮解锁（insertCoin 幂等）。事件继续冒泡到 window，
    // audio.js 首次手势监听据此解锁音频，coin 音与解锁双音同刻呈现
    slot.addEventListener('pointerdown', () => {
        coinDrop();
        insertCoin();
    });
    // 全屏任意点击：未点亮时点屏幕任何位置都视为投币开机（无需瞄准小小的投币口）；
    // 右上角音效/全屏按钮与音量面板豁免灰度常驻全彩可用，点击不应误触发开机仪式；
    // 投币口自身已有投币监听同样排除——否则同一次按下 slot 与 window 各投一枚、双音效。
    // 成就殿堂交互豁免：点殿堂内（查看）、点入口按钮（开合）或刚关闭殿堂（点暗幕/Esc 的
    // 关闭手势已被殿堂 document 级监听先行消费置 hidden，故以 400ms 内关闭时间戳判定，
    // 规避 document 先于 window 的监听时序）均不触发投币仪式——否则"关闭成就殿堂"就变成
    // "投币"；点亮后此处不再接管，点击交还卡片等正常交互（重复投币走投币口/回车）
    window.addEventListener('pointerdown', e => {
        if (!document.body.classList.contains('pre-coin')) return;
        if (e.target.closest('.sound-toggle, .fs-toggle, #sfxPanel, #coinSlot, #trophyToggle')) return;
        const hall = document.getElementById('trophyHall');
        if (hall && (!hall.hidden || performance.now() - trophyClosedAt < 400)) return;
        coinDrop();
        insertCoin();
    });
    // 键盘路径：未点亮时按任意键即投币开机（键盘输入无指向性，任意键视为上机）；
    // 点亮后回车键是投币专用键（重复投币纯装饰演出，不启动游戏；大厅启动统一走
    // 空格或鼠标）。游戏打开期间（body.game-open）不响应，长按触发的系统重复键
    // （e.repeat）忽略防连发刷屏
    window.addEventListener('keydown', e => {
        if (e.repeat || document.body.classList.contains('game-open')) return;
        if (document.body.classList.contains('pre-coin')) {
            // 浏览器/系统快捷键不投币：Ctrl/Meta/Alt 组合键、修饰键本身、Tab（焦点切换）
            // 与 F 功能键（F5 刷新、F12 开发者工具等）原样放行，避免误投币兼误杀默认行为
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const k = e.key;
            if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Tab' || /^F\d+$/.test(k)) return;
            // 成就殿堂打开时按 Esc：意图是关闭殿堂，不触发投币仪式——殿堂 document 级
            // 关闭监听先行置 hidden，故连同 400ms 内刚关闭的时间戳一并豁免
            const hall = document.getElementById('trophyHall');
            if (k === 'Escape' && hall && (!hall.hidden || performance.now() - trophyClosedAt < 400)) return;
            // 焦点在音效/全屏/音量控件上时放行回车/空格：应激活控件本身而非投币
            if ((k === 'Enter' || k === ' ') && e.target instanceof Element && e.target.closest('.sound-toggle, .fs-toggle, #sfxPanel, #trophyToggle')) return;
            // 关键修复：阻断按键派发结束后的默认动作——投币会同步摘除 pre-coin 门禁，
            // 若放行默认动作，回车激活聚焦卡片合成的 click 会立刻打开游戏、盖住金币演出
            e.preventDefault();
            coinDrop();
            insertCoin();
        } else if (e.key === 'Enter') {
            // 焦点在音效/全屏/音量控件上时放行：回车激活控件本身而非投币
            if (e.target instanceof Element && e.target.closest('.sound-toggle, .fs-toggle, #sfxPanel')) return;
            e.preventDefault(); // 回车让给投币：阻止聚焦卡片的默认启动（大厅启动用空格/鼠标）
            coinDrop(); // 点亮后回车重复投币（纯装饰演出）
        }
    });
})();

// ---------- 大厅待机吸引模式（Attract Mode）：闲置 20s 自动进入演示轮播，任意输入立即退出 ----------
// 街机厅传统：无人操作时机台自动演示吸引玩家。轮播逐张聚光游戏卡片，并派发合成
// mouseenter 事件直接复用既有「卡片悬停音效 + 光晕换色」监听（零逻辑重复）；演示期间
// 大厅预览动画与 BGM 照常运转（卡片 Canvas 预览本身就是最好的演示内容）
(function () {
    const IDLE_MS = 20000; // 闲置阈值：20 秒无任何输入进入演示
    const STEP_MS = 3400;  // 每张卡片聚光停留时长（节奏接近街机演示换面）
    const cards = Array.from(document.querySelectorAll('.card'));
    const coinSlot = document.getElementById('coinSlot'); // 页脚投币口（聚光换色联动）
    const banner = document.createElement('div'); // DEMO 横幅（常驻节点，演示期外 hidden）
    banner.id = 'attractBanner';
    banner.innerHTML = '<span class="attract-demo">DEMO</span>' +
        '<span class="attract-game"></span>' +
        '<span class="attract-hint">任意输入返回</span>';
    banner.hidden = true;
    document.body.appendChild(banner);
    const gameEl = banner.querySelector('.attract-game');

    let idleTimer = null;                // 闲置检查定时器（常驻单实例，到点按剩余时间续挂）
    let stepTimer = null;                // 轮播步进倒计时
    let index = 0;                       // 当前聚光卡片下标（循环递增）
    let running = false;                 // 演示进行中标记
    let lastInputTs = performance.now(); // 最近一次用户输入时间戳（时间戳 + 单定时器模式）

    /**
     * 闲置定时器回调：距上次输入满 IDLE_MS 才尝试进入演示；
     * 不足则按剩余时间续挂一次，高频输入事件因此无需反复 clearTimeout+setTimeout 重挂
     */
    function idleTick() {
        idleTimer = null;
        const remain = IDLE_MS - (performance.now() - lastInputTs);
        if (remain > 0) { idleTimer = setTimeout(idleTick, remain); return; } // 中途有输入：续挂剩余时间
        // 到点复查守卫条件：游戏覆盖层打开/页面隐藏等场景下顺延一轮再查
        if (canStart()) start(); else reset();
    }

    /**
     * 重置闲置倒计时；演示进行中先退出（任意输入即退出演示）。
     * 高频路径仅更新时间戳并保证定时器在途：已有挂起定时器时直接返回，由 idleTick 按剩余时间续挂
     */
    function reset() {
        stop();
        lastInputTs = performance.now();
        if (idleTimer !== null) return; // 定时器在途：时间戳已更新，无需重挂
        idleTimer = setTimeout(idleTick, IDLE_MS);
    }

    /**
     * 当前是否允许进入演示：大厅动效总开关接通（CRT 开机完成、非游戏覆盖层期）、
     * 页面可见、且已完成投币并结束点亮演出（黑白待机期以投币引导为唯一主视觉；
     * 点亮演出期主视觉为通电波浪，聚光轮播不闯入避免两套演出打架）
     * @returns {boolean} 允许进入返回 true
     */
    function canStart() {
        return lobbyFx.active && !document.body.classList.contains('game-open')
            && !document.hidden
            && !document.body.classList.contains('pre-coin')
            && !document.body.classList.contains('lights-on'); // 点亮演出期间不进入：避免聚光演出闯入通电序列
    }

    /**
     * 进入演示模式：挂 attract-mode 类压暗卡片、点亮 DEMO 横幅并聚光第一张卡片
     */
    function start() {
        running = true;
        document.body.classList.add('attract-mode');
        banner.hidden = false;
        // 下一帧再点亮 show 类：先以 opacity:0 参与渲染，保证淡入过渡真实生效
        requestAnimationFrame(() => banner.classList.add('show'));
        step();
    }

    /**
     * 轮播步进：聚光下一张卡片，横幅游戏名与霓虹色跟随卡片主题，并播报该游戏代表音
     */
    function step() {
        const card = cards[index % cards.length];
        index += 1;
        cards.forEach(c => c.classList.toggle('attract-active', c === card));
        gameEl.textContent = card.querySelector('h2').textContent;
        // 横幅游戏名与页脚投币口配色同步卡片霓虹色（缺失时兜底金色）
        const rgb = card.style.getPropertyValue('--glow').trim() || '255, 210, 62';
        banner.style.setProperty('--glow', rgb);
        if (coinSlot) coinSlot.style.setProperty('--slot-glow', rgb);
        // 合成 mouseenter：直接复用悬停音效与光晕换色的既有监听（音色与手动悬停完全一致）
        card.dispatchEvent(new MouseEvent('mouseenter'));
        stepTimer = setTimeout(step, STEP_MS);
    }

    /**
     * 退出演示模式：摘除压暗/聚光类与横幅，并对最后聚光卡片派发 mouseleave 复位光晕颜色
     */
    function stop() {
        if (!running) return;
        running = false;
        clearTimeout(stepTimer);
        document.body.classList.remove('attract-mode');
        banner.classList.remove('show');
        // 淡出过渡（0.4s）结束后再整体隐藏，避免闪断
        setTimeout(() => { if (!running) banner.hidden = true; }, 400);
        const active = document.querySelector('.card.attract-active');
        if (active) {
            active.classList.remove('attract-active');
            active.dispatchEvent(new MouseEvent('mouseleave')); // 光晕颜色复位
        }
        if (coinSlot) coinSlot.style.setProperty('--slot-glow', '255, 210, 62'); // 投币口复位默认金色
    }

    // 任意输入（光标移动/点击/按键/滚轮/触摸）都视为用户回归：退出演示并重置倒计时
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => {
        window.addEventListener(type, reset, { passive: true });
    });
    // 页面转入后台：退出演示并重置倒计时，避免后台标签空播音效
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) reset();
    });
    reset();
})();

// ---------- 音频驱动灯带：SFX.level() 实时频谱 → 环绕灯带亮度/色相 + 投币口脉冲 ----------
// 大厅 edgeBeam 旋转光束与页脚投币口随声音律动：低频能量驱动亮度与饱和度（鼓点闪亮）、
// 高频能量驱动色相偏移（高音流彩）；声音经 audio.js 静音/音量增益后才采样，静音即全零、
// 灯带自然回暗至 CSS 基态（音乐真响灯带真亮）。每帧仅读一次频谱并写两个内联样式，
// 不触碰星空渲染主循环；游戏覆盖层打开期间挂起写入；点亮演出（lights-on）与黑白待机
// （pre-coin）期的 filter 均由 CSS 规则/动画全权负责，JS 不插手避免内联样式反盖灰度
(() => {
    if (REDUCED_MOTION) return; // 减少动效偏好：常驻动画已停，频谱驱动一并禁用
    const beam = document.getElementById('edgeBeam'); // 视口环绕光带（CSS 旋转锥形渐变，四色霓虹）
    const slot = document.getElementById('coinSlot'); // 页脚投币口（lit 态双层辉光随低音脉冲）
    if (!beam && !slot) return;
    let smB = 0, smT = 0; // 低频/高频平滑值：升快降慢的指数平滑，跟拍利落且收光不闪烁

    /**
     * 频谱驱动主循环：读取一帧三路能量，平滑后映射为灯带 filter 与投币口亮度脉冲；
     * 双双静默时清空内联 filter 回落 CSS 基态（无声音时不残留恒等 filter，零渲染开销）
     */
    function tick() {
        requestAnimationFrame(tick);
        if (!lobbyFx.active) return; // 游戏覆盖层打开：大厅不可见，挂起写入（子页声音来自其自身音频实例，父页频谱本就无声）
        const lv = SFX.level();
        // 指数平滑：上行系数大（快速跟拍鼓点），下行系数小（余韵式收光，避免逐帧抖闪）
        smB += (lv.b - smB) * (lv.b > smB ? 0.45 : 0.07);
        smT += (lv.t - smT) * (lv.t > smT ? 0.35 : 0.05);
        // 待机灰度期与点亮演出期：filter 归 CSS 规则/动画管辖（lightsOnPower 动画含 fill 覆盖，
        // 内联样式在级联中低于动画值，白写还会掩盖摘类瞬间的过渡）——跳过写入
        if (document.body.classList.contains('pre-coin')) return;
        if (document.body.classList.contains('lights-on')) return;
        if (smB < 0.01 && smT < 0.01) { // 双静默：清空内联 filter，回落 CSS 基态
            if (beam.style.filter) beam.style.filter = '';
            if (slot.style.filter) slot.style.filter = '';
            return;
        }
        const boost = Math.min(smB, 1); // 低频亮度增益钳位 0~1（多音轨叠加时防过曝）
        if (beam) {
            // 亮度/饱和度随低频提振，色相随高频流彩偏移（四色霓虹整体旋移，最高约 70°）
            beam.style.filter = 'brightness(' + (1 + boost * 0.9).toFixed(3) + ') saturate('
                + (1 + boost * 0.5).toFixed(3) + ') hue-rotate(' + (Math.min(smT, 1) * 70).toFixed(1) + 'deg)';
        }
        if (slot) {
            // 投币口整体亮度脉冲：增益系数更高（小面积辉光元素，脉冲感更醒目）
            slot.style.filter = 'brightness(' + (1 + boost * 1.6).toFixed(3) + ')';
        }
    }
    requestAnimationFrame(tick);
})();
