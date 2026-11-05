/* ==================================================================
   像素街机厅 · 手柄支持公共库（gamepad.js）
   2026-11-04 新增。Gamepad API 与街机厅形态天然契合——本库把手柄输入
   边沿触发地合成为标准 KeyboardEvent 派发到 document，大厅导航与各游戏
   的方向键 / AB 键位零改动即可用手柄游玩（无需修改任何页面协议）。

   工作方式：
   ① requestAnimationFrame 循环轮询 navigator.getGamepads()（该 API 为
     轮询式：按钮/摇杆的即时值只在轮询时刷新，无原生按键事件）；
   ② 对比上一帧状态做「边沿触发」：按键从松开→按下时派发一次 keydown、
     按下→松开时派发一次 keyup（各游戏普遍过滤 e.repeat，按住=一次
     keydown 与原生键盘状态模型一致，兼容俄罗斯方块 DAS/ARR 按住机制）；
   ③ 合成事件同时携带标准 key 与 code 双属性（方向键 key==code、空格
     key=' ' code='Space'、字母 key='p' code='KeyP'……），与真实键盘事件
     完全同构——各游戏按 e.key 或 e.code 监听均可命中，fx.js 键帽高亮
     面板按 e.code 点亮亦自动联动；
   ④ 事件派发到 document（而非 window）：window 的 capture 监听
     （audio.js 静音 / fullscreen.js 全屏）、各游戏 document 监听与大厅
     window 监听（投币）均位于事件路径上，全部正常接收。

   映射表（标准手柄布局 standard mapping）：
   ┌ 十字键 上/下/左/右（buttons 12/13/14/15）＋ 左摇杆 → ↑↓←→ 方向键
   ├ A（buttons 0）        → 空格：射击 / 硬降 / 蓄力 / 暂停（贪吃蛇/华容道）
   ├ B（buttons 1）        → Esc：关闭成就墙 / 音量面板等弹层
   ├ X（buttons 2）        → P：暂停 / 继续（五款游戏，另两款暂停即空格）
   ├ Y（buttons 3）        → V：成就墙（全站统一开墙键，Esc 可关）
   ├ Select（buttons 8）   → M：一键静音 / 恢复
   └ Start（buttons 9）    → 回车：大厅投币 / 吃豆人与 1024 的面板确认
   （右摇杆 / 扳机 / L3 R3 无惯用街机语义，不映射防误触）

   注意事项：
   · 游戏在大厅 iframe 内运行时，本库随游戏页各自实例化轮询。Gamepad
     feature policy 默认仅 'self'：http(s) 同源部署 iframe 天然可用；
     file:// 直开时各帧为 opaque origin，需大厅 index.js 创建 iframe 时
     声明 frame.allow 含 'gamepad' 方可授权（已同步处理）。
   · 页面隐藏 / 手柄断开时立即补发全部 keyup 释放——防止俄罗斯方块
     DAS 左右键等「按住状态」跨场景卡死。
   · 合成事件不产生浏览器 user activation：AudioContext 自动播放解锁
     仍需首次真实点击 / 按键（audio.js warm() 在真实手势后自动补启）。
   · 大厅待机态下手柄任意映射键按下即触发「按任意键投币」，与键盘
     行为一致——拿起手柄按键即可唤醒街机。

   加载位置：须置于 fullscreen.js 之后（tests/check.py 公共库加载序规则：
   三件套之外的 js 最小加载序不得早于 fullscreen.js）。库加载即自动
   初始化，页面侧 JS 零改动，仅需在 html 中追加一行 <script>。
   ================================================================== */
'use strict';

// ---------- 对外暴露的最小状态对象：对齐 SFX / FX / FS 全局命名 ----------
/** 手柄支持全局状态：connected 标识当前是否有已连接手柄（供页面按需查询；本库自治运行，不要求页面调用） */
var GP = { connected: false };

(function () {
    // ---------- 能力检测：无 Gamepad API 的环境（旧浏览器等）静默退出 ----------
    if (typeof navigator.getGamepads !== 'function') return;

    // ---------- 按钮映射表：标准布局按钮索引 → 合成的键盘键 [key, code] ----------
    // key 与 code 取浏览器原生键盘事件的标准值，保证按 e.key / e.code 监听的两类页面均可命中
    var BUTTON_MAP = {
        0: [' ', 'Space'],      // A → 空格
        1: ['Escape', 'Escape'], // B → Esc
        2: ['p', 'KeyP'],       // X → P（暂停）
        3: ['v', 'KeyV'],       // Y → V（成就墙：全站统一开墙键）
        8: ['m', 'KeyM'],       // Select → M（静音）
        9: ['Enter', 'Enter']   // Start → 回车（投币 / 确认）
    };
    // 十字键映射表：标准布局 buttons 12=上 13=下 14=左 15=右 → 方向键（key 与 code 同名）
    var DPAD_MAP = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };
    // 左摇杆触发阈值（推杆幅度归一化 -1~1）：越过 0.5 判定按下、回落至 0.35 以内判定松开
    // ——双阈值滞回防止推杆停在临界值附近时反复触发「按下/松开」抖动
    var AXIS_ON = 0.5;
    var AXIS_OFF = 0.35;

    // ---------- 按下状态表：code → 本库是否处于「按下中」（用于边沿判定与卡键兜底释放） ----------
    // 方向键按 code 去重：十字键与左摇杆推同一方向共用一条状态，天然合并互不重复
    var held = Object.create(null);
    // 左摇杆四向的滞回状态（true=该方向处于按下中），与十字键分开记录便于独立判定
    var stick = { up: false, down: false, left: false, right: false };

    /**
     * 合成并派发一个标准键盘事件到 document
     * （事件路径覆盖 window capture / document / window bubble 三类监听）
     * @param {string} type 事件类型：'keydown' 或 'keyup'
     * @param {string} key 原生键值（e.key）：如 'ArrowUp'、' '（空格）、'p'
     * @param {string} code 物理键码（e.code）：如 'ArrowUp'、'Space'、'KeyP'
     */
    function synth(type, key, code) {
        document.dispatchEvent(new KeyboardEvent(type, {
            key: key,
            code: code,
            bubbles: true,    // 冒泡：document 派发可上浮至 window 监听
            cancelable: true, // 允许各页面 preventDefault（与原生键盘事件一致）
            composed: true    // 可穿越 Shadow DOM 边界（当前无自定义元素，声明以对齐原生行为）
        }));
    }

    /**
     * 模拟某键按下（边沿触发：已处于按下中则忽略，不模拟连发）
     * @param {string} key 合成的 e.key 值
     * @param {string} code 合成的 e.code 值
     */
    function press(key, code) {
        if (held[code]) return;
        held[code] = true;
        synth('keydown', key, code);
    }

    /**
     * 模拟某键松开（未按下则忽略）；键盘事件构造用 key 与 code 同值的方向键约定
     * @param {string} code 目标键 code（方向键 key==code，与 press 时的 key 一致）
     */
    function release(code) {
        if (!held[code]) return;
        held[code] = false;
        synth('keyup', code, code);
    }

    /**
     * 释放全部按下中的键并清零摇杆滞回状态（页面隐藏 / 手柄断开时调用，
     * 防止 tetris DAS 左右移动等「按住状态」跨场景卡死）
     */
    function releaseAll() {
        for (var code in held) release(code);
        stick.up = stick.down = stick.left = stick.right = false;
    }

    // ---------- 连接提示 toast：样式由本库动态注入（对齐 audio.js 面板模式，页面侧零改动） ----------
    var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var toastEl = null;
    var toastTimer = 0;

    /**
     * 显示手柄连接 / 断开提示条（顶部居中，约 2.6 秒后淡出）
     * @param {string} text 提示文案（含手柄名或断开说明）
     */
    function showToast(text) {
        // 样式一次性注入：霓虹描边对齐街机厅视觉；独立内联样式不依赖页面 CSS 变量；
        // 减少动态效果：不加淡出过渡（prefers-reduced-motion 豁免，到点直接隐没）
        if (!toastEl) {
            var style = document.createElement('style');
            style.textContent =
                '#gpToast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
                'padding:10px 18px;background:rgba(18,18,42,.92);border:2px solid #39ff6a;border-radius:6px;' +
                'box-shadow:0 0 16px rgba(57,255,106,.55);color:#e8e8ff;font:13px/1.5 "Microsoft YaHei",sans-serif;' +
                'letter-spacing:1px;pointer-events:none;opacity:0;' +
                (REDUCED_MOTION ? '' : 'transition:opacity .3s;') + '}';
            document.head.appendChild(style);
            toastEl = document.createElement('div');
            toastEl.id = 'gpToast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2600);
    }

    /**
     * 截取手柄识别名用于提示文案（厂商字符串可能很长且含编号）
     * @param {Gamepad} pad 手柄对象
     * @returns {string} 截断至 24 字符的识别名
     */
    function padName(pad) {
        var id = (pad && pad.id) ? String(pad.id).replace(/\(.*?\)/g, '').trim() : '手柄';
        return id.length > 24 ? id.slice(0, 24) + '…' : (id || '手柄');
    }

    // ---------- 主轮询：rAF 循环逐帧读取手柄状态并做边沿判定 ----------
    var hadPad = false; // 上一帧是否存在可用手柄（检测轮询侧的掉线兜底）

    function poll() {
        requestAnimationFrame(poll);
        // 页面隐藏时跳过轮询（rAF 本身会被浏览器暂停，此处双保险）；恢复可见由 visibilitychange 统一释放
        if (document.hidden) return;
        var pads;
        try { pads = navigator.getGamepads(); } catch (e) { pads = null; }
        if (!pads) { if (hadPad) { hadPad = false; releaseAll(); } return; }
        // 取第一个已连接的手柄（多手柄场景取索引最小者，与「插第一个玩第一个」直觉一致）
        var pad = null;
        for (var i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
        }
        if (!pad) {
            // 轮询侧掉线兜底（gamepaddisconnected 事件未触发的异常场景）：静默释放全部按键
            if (hadPad) { hadPad = false; releaseAll(); }
            return;
        }
        hadPad = true;
        GP.connected = true;

        // ----- 功能按钮边沿判定：buttons[i].pressed（部分手柄为模拟量，value>0.5 视为按下） -----
        for (var idx in BUTTON_MAP) {
            var btn = pad.buttons[idx];
            var isDown = !!(btn && (btn.pressed || btn.value > AXIS_ON));
            var map = BUTTON_MAP[idx];
            if (isDown) press(map[0], map[1]);
            else release(map[1]);
        }

        // ----- 十字键边沿判定（与功能按钮同规则） -----
        for (var d in DPAD_MAP) {
            var dpad = pad.buttons[d];
            var dDown = !!(dpad && (dpad.pressed || dpad.value > AXIS_ON));
            if (dDown) press(DPAD_MAP[d], DPAD_MAP[d]);
            else release(DPAD_MAP[d]);
        }

        // ----- 左摇杆滞回判定：axes[0] 水平（右正）axes[1] 垂直（下正），触发/释放双阈值 -----
        var ax = pad.axes;
        if (ax && ax.length >= 2) {
            var x = ax[0] || 0;
            var y = ax[1] || 0;
            // 右推：越过 +0.5 按下，回落到 +0.35 以内松开（其余三向对称）
            if (!stick.right && x > AXIS_ON) { stick.right = true; press('ArrowRight', 'ArrowRight'); }
            else if (stick.right && x < AXIS_OFF) { stick.right = false; release('ArrowRight'); }
            if (!stick.left && x < -AXIS_ON) { stick.left = true; press('ArrowLeft', 'ArrowLeft'); }
            else if (stick.left && x > -AXIS_OFF) { stick.left = false; release('ArrowLeft'); }
            if (!stick.down && y > AXIS_ON) { stick.down = true; press('ArrowDown', 'ArrowDown'); }
            else if (stick.down && y < AXIS_OFF) { stick.down = false; release('ArrowDown'); }
            if (!stick.up && y < -AXIS_ON) { stick.up = true; press('ArrowUp', 'ArrowUp'); }
            else if (stick.up && y > -AXIS_OFF) { stick.up = false; release('ArrowUp'); }
        }
    }

    // ---------- 连接 / 断开事件：更新状态、提示与卡键兜底 ----------
    window.addEventListener('gamepadconnected', function (e) {
        GP.connected = true;
        showToast('🎮 手柄已连接：' + padName(e.gamepad));
    });
    window.addEventListener('gamepaddisconnected', function (e) {
        // 断开即清空提示并补发全部 keyup（该手柄的按住状态不能跨断开残留）
        releaseAll();
        GP.connected = false;
        showToast('🎮 手柄已断开');
    });
    // 页面转后台：立即释放全部按键（后台期间轮询暂停，恢复后由下一帧重建状态）
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) releaseAll();
    });

    // 启动轮询循环
    requestAnimationFrame(poll);
})();
