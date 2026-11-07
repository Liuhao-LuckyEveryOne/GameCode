'use strict';
/**
 * 像素街机厅公共音效库 v2
 * 基于 Web Audio API 程序化合成 8-bit 风格音效，无需外部音频文件
 * v2（20261021）：新增 SFX/BGM 分层增益、BGM 音序器（曲库 + 前瞻调度 + 淡入淡出 + 页面隐藏自动暂停）、
 *                跨游戏通用音效（alarm/uiPause/uiResume/comboUp/newRecord/pinCharge/crtOn/crtOff）
 * v2.1（20261022）：新增俄罗斯方块 T-SPIN（tSpin）与全消（allClear）音效
 * v2.2（20261022）：新增大厅 BGM 曲目（lobby）与 BGM/SFX 双通道 4 档音量分级（键 arcadeVol 持久化 + 嵌入模式父子页同步）
 * v2.3（20261022）：音控统一重构——3 个英文按钮（SOUND/MUSIC/SFX）合并为 1 个中文单按钮：
 *                单击=一键静音/恢复（档位无损保留，快捷键 M）；长按/右键=展开中文音量面板
 *                （全部声音开关 + 音乐/音效各 4 档点选）。状态合并存于新键 arcadeAudio，
 *                首次运行自动从旧键 arcadeSound/arcadeVol 迁移；嵌入模式协议统一为 arcade:audio 单消息
 * v2.3.1（20261022）：音控交互修复——嵌入 hello 握手指纹对齐（type:arcade:audio + act:hello，原 arcade:audio:hello 父页不识别）、
 *                长按阈值 350→450ms（避免慢速点击被误判为长按吞掉）、静音方向补播下滑确认音（原静音点击零反馈）、
 *                面板展开时单击主键改为收起面板、面板标题栏加 ✕ 关闭钮、主按钮加 user-select/touch-action 防移动端长按误触
 * v2.3.2（20261022）：主按钮与面板总开关文案分隔符「:」/「：」统一换为「·」（视觉更美观）；
 *                8 页按钮同步加粗展示（font-weight:700 由各页样式承载）
 * v2.3.3（20261022）：主按钮与面板总开关文案语义反转为动作提示（与全屏键同口径）——
 *                有声显示「声音 · 关」（提示可关闭）、静音显示「声音 · 开」（提示可开启）
 * v2.4（20261101）：小蜜蜂音效专属化——新增武器/护盾/1UP 三种道具专属拾取音
 *                （beePowerupWeapon/beePowerupShield/beePowerupLife，替换通用拾取音），
 *                并为 Boss 入场演出补充配套音效（beeBossAlarm 长警报、beeBossLand 落地冲击）
 * v2.5（20261103）：大厅投币音效 coin——投币金属双音 + 高音闪光尾音，投币口每次投币播放
 * v2.6（20261103）：新增吞币落箱音 coinSwallow——低频"咚" + 火花杂音 + 金属余韵叮响，
 *                金币抵达投币口瞬间播放，与投币双音形成「起币/落币」呼应
 * v2.7（20261104）：嵌入协议同源豁免收紧——接收侧消息守卫由 origin==='null' 一律放行收紧为仅 file:// 直开豁免，
 *                http(s) 部署下伪造 origin:'null' 的跨源报文不再被误收（与发送侧 POST_MSG_TARGET 配套）
 * v2.8（20261104）：新增立体声定位 SFX.pan(x)——主输出链串接 StereoPannerNode（旧浏览器缺失时自动跳过），
 *                声像临时拨向左(-1)~右(+1)，静默 holdMs 后自动回中；挡板/滑动等方位事件传入 ±0.x 即可
 * v2.9（20261104）：新增实时频谱采样 SFX.level()——主输出链末端（destination 前）串接 AnalyserNode，
 *                返回 { b 低频, t 高频, e 全频 } 三路 0~1 归一化能量（经静音/音量增益后的最终信号，
 *                静音即全零）；大厅据此驱动环绕灯带亮度/色相与投币口脉冲——音乐真响灯带真亮
 * v2.10（20261105）：新增成就殿堂开幕音 SFX.hallOpen——上行五连琶音 + 高音闪光长尾，
 *                大厅成就殿堂（鎏金覆盖层）揭幕仪式音
 * v3.1（20261105）：双通道解耦修复——BGM 改为与 SFX 并联（music 独立增益直入静音闸 gate，不再经 master），
 *                音效档调「关」不会再连 BGM 一起哑掉；muted 统一由 gate 归零（频谱同步归零）；
 *                旧键迁移整段包 try（存储被禁时降级默认而非中断引擎）、档位钳位防 NaN
 * v3.2（20261106）：音量面板升级为「声音 · 演出设置」——新增演出强度三档行（✧ 精简/标准/完整），
 *                点击经 arcade:fxlevel 协议由 fx.js 持久化并向全部游戏 iframe 广播
 *                （面板仅作统一入口，档位状态权威在 fx.js，本库不持久化不缓存）
 * v3.3（20261106）：演出强度行扩展「自动」第四档（按滚动帧率自适应降级，引擎与裁决均在 fx.js）；
 *                面板高亮改读 FX.getFxMode()（自动档下高亮「自动」钮而非引擎实际档）；
 *                档位名与档数继续取 FX.FX_LEVEL_NAMES 自动生成（含兜底字面量同步扩四档）
 * 音控状态通过 localStorage（键 arcadeAudio）在所有页面间共享；
 * 嵌入模式（?embed 于 iframe 内运行）下状态由大厅（父页）统一持有，经 postMessage 实时同步大厅与游戏
 */
const SFX = (() => {
    /** 嵌入模式标记：URL 携带 ?embed 且确实运行于 iframe 之中（判定方式与 fullscreen.js 一致） */
    const EMBED = new URLSearchParams(location.search).has('embed') && window.parent !== window;
    /** 消息投递目标：file:// 直开时各帧为独立 opaque origin，需回退 '*' 维持跨帧通信；http(s) 同源部署收紧为 '/'（仅同源可投） */
    const POST_MSG_TARGET = (location.protocol === 'file:') ? '*' : '/';
    let ctx = null; // AudioContext（首次使用时懒创建，规避浏览器自动播放限制）
    let noiseBuf = null; // 白噪声 AudioBuffer 缓存（随 ctx 惰性生成一次，高频碰撞路径直接复用；本库 ctx 懒创建后不会重建，无需失效逻辑）

    /* ==================== 音控状态（v2.3：静音标志 + 双通道档位，单键持久化） ==================== */
    const AUDIO_KEY = 'arcadeAudio';       // 音控状态持久化键（JSON：{m:是否静音, b:BGM 档位, s:SFX 档位}）
    const VOL_STEPS = [0, 1 / 3, 2 / 3, 1]; // 4 档音量：静音 / 低 / 中 / 高
    /** 档位钳位（防脏数据越界） @param {number} n 原始档位值 @returns {number} 0~3 的合法档位 */
    // 非数值（伪造消息的字符串/NaN）按 0 兜底：原实现 Math.max(NaN,0) 仍为 NaN，
    // 会让 VOL_STEPS[NaN] 得到 undefined 并传给 setTargetAtTime 抛 TypeError，写坏档位
    const clampStep = (n) => (Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), VOL_STEPS.length - 1) : 0);
    // 启动状态：优先读新键；新键缺失（v2.2 及更早）时从旧键 arcadeSound/arcadeVol 一次性迁移
    const boot = (() => {
        try {
            const saved = JSON.parse(localStorage.getItem(AUDIO_KEY) || 'null');
            if (saved && typeof saved.m === 'boolean' && Number.isInteger(saved.b) && Number.isInteger(saved.s)) {
                return { m: saved.m, b: clampStep(saved.b), s: clampStep(saved.s) };
            }
        } catch (e) { /* 脏数据走旧键迁移 */ }
        // 旧版迁移：arcadeSound==='off'（总开关关闭）映射为静音；arcadeVol 双通道档位原样保留
        // 整段包 try：存储被禁（隐私模式 / 部分 file:// 场景）时 getItem 本身会抛错，
        // 若只包住 JSON.parse，异常会掀翻整个音效 IIFE，导致全站无声
        let m = false, b = VOL_STEPS.length - 1, s = VOL_STEPS.length - 1;
        try {
            m = localStorage.getItem('arcadeSound') === 'off';
            const v = JSON.parse(localStorage.getItem('arcadeVol') || 'null');
            if (v && Number.isInteger(v.b) && Number.isInteger(v.s)) { b = clampStep(v.b); s = clampStep(v.s); }
        } catch (e) { /* 旧键不可读或脏数据：回退默认（有声 + 双通道满档） */ }
        return { m, b, s };
    })();
    let muted = boot.m;                 // 一键静音标志（独立于档位：静音不破坏设置，恢复时档位无损还原）
    let vol = { b: boot.b, s: boot.s }; // 双通道音量档位（b=BGM 音乐，s=SFX 音效）
    // 迁移后立即落新键并清理旧键（存储不可用时仅内存态运行）
    try {
        localStorage.setItem(AUDIO_KEY, JSON.stringify({ m: muted, b: vol.b, s: vol.s }));
        localStorage.removeItem('arcadeSound');
        localStorage.removeItem('arcadeVol');
    } catch (e) { /* 忽略持久化失败 */ }

    /**
     * 持久化当前音控状态到 localStorage（父页角色专用；嵌入模式子页状态由大厅统一持有）
     */
    function saveAudio() {
        try { localStorage.setItem(AUDIO_KEY, JSON.stringify({ m: muted, b: vol.b, s: vol.s })); } catch (e) { /* 忽略 */ }
    }

    /**
     * 应用外部（父页广播）下发的音控状态（仅嵌入模式的子页使用，不重复持久化）
     * @param {{m:boolean, b:number, s:number}} v 音控状态（m=静音，b/s=双通道档位）
     */
    function applyAudioState(v) {
        if (!v || typeof v.m !== 'boolean' || !Number.isInteger(v.b) || !Number.isInteger(v.s)) return;
        muted = v.m;
        vol = { b: clampStep(v.b), s: clampStep(v.s) };
        applyVol();
        syncUI();
    }

    /**
     * 父页角色：向当前页面内所有子 iframe 广播最新音控状态（静音标志 + 双通道档位）
     */
    function broadcastAudio() {
        document.querySelectorAll('iframe').forEach(f => {
            // 目标 origin 取 POST_MSG_TARGET（见顶部定义）：http(s) 同源收紧为 '/'，file:// 直开回退 '*' 维持跨帧通信
            try { f.contentWindow.postMessage({ type: 'arcade:audio', m: muted, b: vol.b, s: vol.s }, POST_MSG_TARGET); } catch (e) { /* 跨域或未就绪时忽略 */ }
        });
    }

    /**
     * 确保 AudioContext 可用（用户手势后恢复运行状态）
     * @returns {AudioContext|null} AudioContext；仅静音时返回 null。
     *          resume() 是异步的，首次手势时此刻 state 多半仍为 suspended——不再据此返回 null 丢弃音效：
     *          suspended 状态下排入的事件会在恢复运行后立即执行（此刻 currentTime 不走，音效在 resume 瞬间照常播出）
     */
    function ensure() {
        if (muted) return null;
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    /**
     * 应用音量档位到音频图：SFX 档只作用于 master（音效链），BGM 档由 bgm.sync() 独立收敛到 music 分层，
     * 两条通道互不牵连（v3.1 修正：此前 BGM 串在 master 之后，音效档调「关」会把音乐一起哑掉）；
     * muted 是总闸，单独经 gate 归零，静音时两条通道同时断开、频谱随之归零
     * （bgm/master/gate 定义于后文，本函数仅在事件回调中运行，运行时必然已初始化）
     */
    function applyVol() {
        if (ctx && master) {
            master.gain.setTargetAtTime(VOL_STEPS[vol.s], ctx.currentTime, 0.04);
            gate.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.04);
        }
        bgm.sync(); // BGM 分层按新档位淡入/淡出（BGM 档位 0 或静音时整个挂起静默）
    }

    /**
     * 本地设置音量档位并持久化（父页角色专用；嵌入模式子页仅转发请求不会走到这里）
     * @param {'b'|'s'} ch 通道：b=BGM（音乐），s=SFX（音效）
     * @param {number} idx 目标档位索引（0~3，越界自动钳位）
     */
    function setVolCore(ch, idx) {
        const i = clampStep(idx);
        if (vol[ch] === i) return; // 同档位幂等返回
        vol[ch] = i;
        saveAudio();
        // SFX 通道调到非静音档时播一声确认音，让用户直接听到当前音量档（本地未静音时才可听见）
        if (ch === 's' && VOL_STEPS[i] > 0 && !muted) tone(660, 0.07, 'square', 0.12);
        applyVol();
        syncUI();
        broadcastAudio();
    }

    let master = null; // SFX 汇总增益节点（增益值 = SFX 音量档，只作用于音效链）
    let music = null;  // BGM 专用增益节点（增益值 = BGM 音量档；与 master 并联，不经音效档与声像）
    let gate = null;   // 总静音闸（两条通道汇合处、analyser 之前：muted 整体归零，频谱同步回暗）
    let panner = null; // v2.8 立体声定位节点（主输出 → destination 之间串接；缺失时直连）
    let panTimer = 0;  // 声像自动回中定时器句柄
    let analyser = null;     // v2.9 频谱分析节点（主输出链末端串接，供大厅灯带采样实时频谱）
    let freqData = null;     // 频谱字节数组（随 analyser 惰性创建，getByteFrequencyData 就地填充）
    const LV = { b: 0, t: 0, e: 0 }; // level() 复用返回对象（60fps 高频调用，避免每帧新建小对象）

    /**
     * 惰性搭建音频输出图（两条通道在此一次性并联）
     * 拓扑：SFX → master(SFX 档) → panner(可选) → gate → analyser → destination
     *       BGM → music(BGM 档，由 bgm.sync 淡入淡出) ──┘（不经 master，也不受声像影响）
     * v2.8：SFX 链串接 StereoPannerNode（浏览器不支持时自动退化为直连，全部居中）
     * v2.9：汇合处串接 AnalyserNode——两条通道经各自音量档与静音闸后的最终信号在此采样，
     *       静音或零音量时频谱自然归零，视觉联动随之回暗
     * @returns {GainNode} SFX 主增益节点（音效链入口）
     */
    function out() {
        if (!master) {
            master = ctx.createGain();
            master.gain.value = VOL_STEPS[vol.s];
            gate = ctx.createGain();
            gate.gain.value = muted ? 0 : 1;      // 总静音闸初值同步当前静音态
            analyser = ctx.createAnalyser();
            analyser.fftSize = 256;               // 128 个频桶（每桶约 172Hz@44.1kHz）：粒度足够且读取开销小
            analyser.smoothingTimeConstant = 0.5; // 分析器内置平滑：读数平稳，配合调用方二次平滑
            freqData = new Uint8Array(analyser.frequencyBinCount);
            if (ctx.createStereoPanner) { // 旧浏览器无此 API 时跳过，pan() 同步短路，听感不变
                panner = ctx.createStereoPanner();
                master.connect(panner);
                panner.connect(gate);
            } else {
                master.connect(gate);
            }
            gate.connect(analyser);
            analyser.connect(ctx.destination); // 两条分支最终都经频谱节点落地（分析节点不影响音质）
            music = ctx.createGain();         // BGM 分层与 SFX 并联：独立档位、独立淡入淡出
            music.gain.value = 0;
            music.connect(gate);
        }
        return master;
    }

    /**
     * 惰性创建 BGM 增益节点（初始静音，由音序器按播放状态淡入淡出）
     * @returns {GainNode} BGM 分层节点
     */
    function musicOut() {
        out(); // 确保整张音频图（含 gate 与 music 分层）已搭好；music 在 out() 内创建并接在 gate 之前
        return music;
    }

    // 任意按下/按键手势即时预热，保证卡片悬停音在首次交互后即可播放
    let unlocked = false; // 是否已播放过首次交互激活提示音
    const warm = () => {
        if (muted || unlocked) return;
        unlocked = true; // 仅首次手势提示一次
        // 浏览器自动播放策略下首次交互后才可出声，播放经典"投币"双音作为激活反馈
        if (ensure()) {
            tone(988, 0.07, 'square', 0.08);
            tone(1319, 0.18, 'square', 0.08, 0, 0.08);
        }
        bgm.sync(); // 首次手势解锁音频后，补启等待中的 BGM
    };
    window.addEventListener('pointerdown', warm);
    window.addEventListener('keydown', warm);

    /**
     * 基础音符：振荡器 + 音量包络
     * @param {number} freq 起始频率（Hz）
     * @param {number} dur 持续时间（秒）
     * @param {string} type 波形（square/sawtooth/triangle/sine）
     * @param {number} vol 音量（0~1）
     * @param {number} slideTo 滑音目标频率（0 表示不滑音）
     * @param {number} delay 延迟开始时间（秒，用于串行音符）
     */
    function tone(freq, dur, type = 'square', vol = 0.15, slideTo = 0, delay = 0) {
        const c = ensure();
        if (!c) return;
        const t0 = c.currentTime + delay;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        // 需要滑音时按指数曲线过渡到目标频率
        if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
        // 音量包络：瞬时起音 + 指数衰减，避免爆音
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        osc.connect(gain).connect(out());
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    /**
     * 白噪声短促音（带通滤波，用于撞击/碎裂质感）
     * @param {number} dur 持续时间（秒）
     * @param {number} vol 音量（0~1）
     * @param {number} freq 带通中心频率（Hz）
     */
    function noise(dur = 0.15, vol = 0.12, freq = 1000) {
        const c = ensure();
        if (!c) return;
        // 白噪声为平稳随机信号，样本内容与时长截取位置无关：缓存不足本次时长时才（重新）生成更长的 buffer，
        // 否则直接复用同一缓存，避免弹珠台/华容道等高频碰撞路径每次播放都同步填充数千个随机样本
        const len = Math.max(1, Math.floor(c.sampleRate * dur));
        if (!noiseBuf || noiseBuf.length < len) {
            noiseBuf = c.createBuffer(1, len, c.sampleRate);
            const data = noiseBuf.getChannelData(0);
            // 填充白噪声样本（仅首次生成 / 现有缓存不够长时执行一次）
            for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        const src = c.createBufferSource();
        src.buffer = noiseBuf;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = freq;
        bp.Q.value = 1;
        const gain = c.createGain();
        gain.gain.setValueAtTime(vol, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
        src.connect(bp).connect(gain).connect(out());
        src.start();
        src.stop(c.currentTime + dur); // 缓存长于本次时长时按原时长截断（此刻增益包络已衰减至不可闻，听感不变）
    }

    /**
     * 琶音：按顺序依次播放音符序列
     * @param {number[]} freqs 频率数组（Hz）
     * @param {number} noteDur 单音持续时间（秒）
     * @param {string} type 波形
     * @param {number} vol 音量（0~1）
     */
    function arpeggio(freqs, noteDur = 0.09, type = 'square', vol = 0.15) {
        freqs.forEach((f, i) => tone(f, noteDur, type, vol, 0, i * noteDur));
    }

    /**
     * 本地切换一键静音并持久化（父页角色专用；嵌入模式子页不会走到这里）
     * 静音不改动双通道档位，恢复时档位无损还原
     */
    function muteCore() {
        if (!muted) tone(880, 0.12, 'square', 0.18, 392); // 静音前先播一声下滑确认（翻旗后 ensure 会短路，必须先播，否则静音点击零反馈）
        muted = !muted;
        saveAudio();
        if (!muted) tone(660, 0.08, 'square', 0.12); // 恢复出声时给一声上滑确认音
        applyVol();
        syncUI();
        broadcastAudio();
    }

    // 跨文档同步接线（随本文件解析即注册；EMBED 为本文件局部常量，不依赖后加载的 fullscreen.js）
    if (EMBED) {
        // 子页角色：监听父页广播并应用状态；加载后向父页报到以获取当前权威状态（静音 + 双通道档位）
        window.addEventListener('message', (e) => {
            if (e.source !== window.parent) return; // 仅信任直接父页
            const d = e.data;
            if (d && d.type === 'arcade:audio') applyAudioState(d);
        });
        window.parent.postMessage({ type: 'arcade:audio', act: 'hello' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET；指纹须与父页监听约定一致（type:arcade:audio + act:hello）
    } else {
        // 父页（大厅）角色：响应子页的切换/设档请求与报到；大厅是音控状态的唯一持久化方
        window.addEventListener('message', (e) => {
            // 来源守卫：仅接受同源消息；file:// 直开场景各帧 origin 字面量为 'null'，仅当本页也是 file:// 时豁免
            if (e.origin !== window.location.origin && !(e.origin === 'null' && location.protocol === 'file:')) return;
            const d = e.data;
            if (!d || d.type !== 'arcade:audio') return;
            if (d.act === 'toggle') {
                muteCore();
                broadcastAudio(); // 切换后向所有 iframe 内游戏广播最新状态
            } else if (d.act === 'vol') {
                setVolCore(d.ch === 'b' ? 'b' : 's', d.idx); // 容错：未知通道按 SFX 处理
                broadcastAudio();
            } else if (d.act === 'hello' && e.source) {
                e.source.postMessage({ type: 'arcade:audio', m: muted, b: vol.b, s: vol.s }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET，向报到子页回发当前状态
            }
        });
    }

    /* ==================== BGM 音序器（v2 新增） ==================== */
    /**
     * 调度单个 BGM 音符到 AudioContext 绝对时间轴（进 music 分层，不与音效混音）
     * @param {number} freq 频率（Hz），0 由调用方过滤不会传入
     * @param {number} t0 起始的 AudioContext 绝对时间（秒）
     * @param {number} dur 持续时间（秒）
     * @param {string} type 波形（square/sawtooth/triangle/sine）
     * @param {number} vol 音量（0~1）
     */
    function note(freq, t0, dur, type, vol) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t0); // 从 0 淡入避免爆音
        g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // 指数收尾至静音
        osc.connect(g).connect(musicOut());
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    /**
     * BGM 曲库：每曲 16 步（八分音符）循环乐句，bass/lead 双声部（0 表休止），
     * bpm 决定步进速度，bassType/leadType 决定各自音色
     */
    const SONGS = {
        /** 贪吃蛇：低回舒缓的爬行律动 */
        snake: { bpm: 100, bassType: 'triangle', leadType: 'square',
            bass: [110, 0, 110, 0, 98, 0, 98, 0, 131, 0, 131, 0, 147, 0, 110, 0],
            lead: [440, 0, 392, 440, 0, 523, 0, 440, 392, 0, 330, 392, 440, 0, 0, 0] },
        /** 俄罗斯方块：紧凑急促的落块节奏 */
        tetris: { bpm: 138, bassType: 'square', leadType: 'square',
            bass: [82, 0, 82, 82, 0, 82, 73, 0, 65, 0, 65, 65, 0, 73, 62, 0],
            lead: [330, 392, 494, 659, 587, 494, 392, 440, 494, 0, 392, 330, 0, 294, 330, 0] },
        /** 吃豆人：圆滑跳跃的迷宫巡游 */
        pac: { bpm: 116, bassType: 'square', leadType: 'square',
            bass: [65, 82, 98, 110, 117, 123, 131, 110, 87, 110, 131, 147, 98, 123, 147, 175],
            lead: [330, 0, 392, 0, 466, 0, 392, 0, 440, 0, 349, 0, 294, 0, 247, 0] },
        /** 弹珠台：明快弹跳的台面撞击 */
        pinball: { bpm: 140, bassType: 'square', leadType: 'sawtooth',
            bass: [110, 0, 110, 0, 87, 0, 87, 0, 98, 0, 98, 0, 82, 0, 82, 0],
            lead: [440, 523, 659, 523, 349, 440, 523, 440, 392, 494, 587, 494, 330, 415, 494, 415] },
        /** 蜜蜂保卫战：高频急袭的空战推进 */
        bee: { bpm: 152, bassType: 'square', leadType: 'square',
            bass: [73, 147, 73, 147, 58, 117, 58, 117, 65, 131, 65, 131, 55, 110, 55, 110],
            lead: [587, 0, 698, 0, 880, 0, 698, 0, 659, 0, 784, 0, 880, 0, 784, 659] },
        /** 华容道：舒缓沉稳的推移冥想 */
        klotski: { bpm: 84, bassType: 'triangle', leadType: 'triangle',
            bass: [131, 0, 0, 0, 98, 0, 0, 0, 110, 0, 0, 0, 98, 0, 0, 0],
            lead: [330, 0, 392, 0, 440, 0, 523, 0, 440, 0, 392, 0, 330, 0, 294, 0] },
        /** 2048：温暖沉思的合成冥想 */
        n1024: { bpm: 92, bassType: 'triangle', leadType: 'sine',
            bass: [87, 0, 131, 0, 147, 0, 117, 0, 87, 0, 131, 0, 110, 0, 98, 0],
            lead: [349, 0, 440, 0, 523, 0, 440, 0, 466, 0, 440, 0, 349, 0, 262, 0] },
        /** 大厅：温馨迎宾的店堂旋律（C-G-Am-F 经典进行，双三角波舒缓流动） */
        lobby: { bpm: 96, bassType: 'triangle', leadType: 'triangle',
            bass: [131, 0, 165, 0, 98, 0, 124, 0, 110, 0, 131, 0, 87, 0, 110, 0],
            lead: [659, 784, 659, 523, 587, 494, 392, 0, 523, 659, 440, 0, 440, 392, 330, 294] }
    };

    /** BGM 播放器：三态（曲目/用户暂停/自动暂停）统一经 sync() 收敛启停与淡入淡出 */
    const bgm = {
        name: null,        // 当前曲目名（SONGS 键），null 表示未请求播放
        paused: false,     // 用户/游戏主动暂停（游戏暂停菜单时调用）
        autoPaused: false, // 因页面隐藏自动暂停（回前台仅恢复此类暂停）
        step: 0,           // 已调度到的步数（循环游标）
        nextTime: 0,       // 下一步的 AudioContext 绝对时间
        timer: null,       // 调度器 interval 句柄（存在即视为实际播放中）
        intensity: false,  // 自适应分层（v3.0）：危险态标记——setIntensity 设置，true 时鼓点声部逐拍渐入
        drumLv: 0,         // 鼓点声部当前强度系数（0~1）：每拍向目标逼近，实现加层渐入与脱离衰减

        /** 请求播放指定曲目（同名已在播则忽略；否则从头开始） @param {string} name 曲目名（SONGS 键） */
        start(name) { if (this.name === name && this.timer) return; this.name = name; this.paused = false; this.autoPaused = false; this.step = 0; this.intensity = false; this.drumLv = 0; this.sync(); }, // 换曲/重启重置危险分层：新曲从常态编曲开始
        /** 停止播放并清空曲目（游戏结束时调用，危险分层一并重置） */
        stop() { this.name = null; this.paused = false; this.autoPaused = false; this.intensity = false; this.drumLv = 0; this.sync(); },
        /** 主动暂停（保留曲目，恢复时从当前步继续） */
        pause() { this.paused = true; this.sync(); },
        /** 解除主动暂停 */
        resume() { this.paused = false; this.sync(); },
        /** @returns {boolean} 是否正在实际播放 */
        playing() { return !!this.timer; },

        /** 设置危险态分层：true 叠加低音鼓点声部（逐拍渐入），false 脱离危险（逐拍衰减直至静默） @param {boolean} on 危险态标记 */
        setIntensity(on) { this.intensity = !!on; },

        /**
         * 状态收敛单一入口：按 muted/name/paused 推导期望状态，
         * 启停调度器 interval，并对 music 分层增益做淡入/淡出
         */
        sync() {
            // 静音或 BGM 音量档位为 0（关）时直接视为不播放，调度器整个挂起，恢复后从当前步继续
            const want = !muted && this.name && !this.paused && VOL_STEPS[vol.b] > 0;
            if (want) {
                // 惰性建 ctx；无手势时可能仍为 suspended，届时 warm() 的手势回调会再次 sync 补启
                if (!ensure()) return;
                if (!this.timer) {
                    this.nextTime = ctx.currentTime + 0.06;
                    this.timer = setInterval(() => this.schedule(), 30); // 30ms 轮询、0.12s 前瞻，精度足够
                }
                musicOut().gain.setTargetAtTime(VOL_STEPS[vol.b], ctx.currentTime, 0.25); // 缓慢淡入至 BGM 音量档
            } else {
                if (this.timer) { clearInterval(this.timer); this.timer = null; }
                if (ctx && music) music.gain.setTargetAtTime(0, ctx.currentTime, 0.12); // 快速淡出
            }
        },

        /** 调度器：把落在 0.12s 前瞻窗口内的音符按绝对时间写入 AudioContext 时间轴 */
        schedule() {
            const song = SONGS[this.name];
            if (!song) return;
            const spb = 30 / song.bpm; // 每步时长（秒）：八分音符 = 30/bpm
            // 掉队防护：页面挂起导致 nextTime 严重落后时，对齐到当前时间附近，避免爆发式补排
            if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05;
            while (this.nextTime < ctx.currentTime + 0.12) {
                const b = song.bass[this.step % song.bass.length];
                const l = song.lead[this.step % song.lead.length];
                if (b) note(b, this.nextTime, spb * 0.95, song.bassType, 0.09);
                if (l) note(l, this.nextTime, spb * 0.8, song.leadType, 0.055);
                // 自适应鼓点分层：每拍（4 步一拍，对齐曲库 16 步循环的强拍）采样一次强度系数——
                // 危险态逐拍渐入叠加低音鼓，脱离后逐拍衰减自然收层（编曲密度随游戏紧张度起伏）
                if (this.step % 4 === 0) {
                    this.drumLv += ((this.intensity ? 1 : 0) - this.drumLv) * 0.5; // 渐入约 3~4 拍、衰减约 4~5 拍完成
                    if (this.drumLv > 0.02) drum(this.nextTime, this.drumLv);
                }
                this.step++;
                this.nextTime += spb;
            }
        }
    };

    /**
     * 自适应 BGM 分层的低音鼓点声部：正弦 150→45Hz 下滑短音（底鼓音头），
     * lv 为 0~1 强度系数控制响度（分层渐入/衰减时逐拍变化），走 music 分层随 BGM 音量档联动
     * @param {number} t0 AudioContext 绝对时间（拍点）
     * @param {number} lv 强度系数 0~1
     */
    function drum(t0, lv) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t0);
        osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.1); // 低音鼓下滑音头
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16 * lv, t0 + 0.012); // 快速起音
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);     // 短促衰减
        osc.connect(g).connect(musicOut());
        osc.start(t0);
        osc.stop(t0 + 0.2);
    }

    // 页面隐藏时自动暂停 BGM（避免后台空转与音频堆积），回前台仅恢复"自动暂停"这一类
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (bgm.playing()) { bgm.autoPaused = true; bgm.pause(); }
        } else if (bgm.autoPaused) {
            bgm.autoPaused = false;
            bgm.resume();
        }
    });

    /* ==================== 音控 UI（v2.3：单键 + 长按音量面板） ==================== */
    const VOL_NAMES = ['关', '♪', '♪♪', '♪♪♪']; // 面板档位显示名（与 VOL_STEPS 一一对应）
    let mainBtn = null;   // 音控主按钮引用（同步文本与主题色取色用）
    let panel = null;     // 音量设置面板（懒创建）

    /**
     * 同步音控 UI 到当前状态：主按钮文本/静音态样式/悬浮提示，以及面板内开关文字与档位高亮
     * （按钮或面板不存在时静默跳过对应部分）
     */
    function syncUI() {
        if (mainBtn) {
            // 动作提示语义（与全屏键同口径）：文案展示「点击后将执行的动作」而非当前状态——
            // 有声时显示「声音 · 关」（提示可关闭）、静音时显示「声音 · 开」（提示可开启）
            mainBtn.innerHTML = muted
                ? '<span class="snd-note">♪</span>声音 · 开'
                : '<span class="snd-note">♪</span>声音 · 关';
        }
        if (panel) {
            const mb = panel.querySelector('.sfx-mute');
            if (mb) {
                mb.textContent = muted ? '♪ 全部声音 · 开' : '♪ 全部声音 · 关';
            }
            // 刷新两组档位点选条的高亮（data-vol 与当前档位一致者点亮）
            panel.querySelectorAll('.sfx-step').forEach(st => {
                st.classList.toggle('on', Number(st.dataset.vol) === vol[st.dataset.ch]);
            });
            // 刷新演出强度行的高亮（data-fx 与当前模式一致者点亮：自动档下高亮「自动」钮而非引擎实际档；FX 库未加载时按完整档兜底显示）
            const fxLv = window.FX ? window.FX.getFxMode() : 2;
            panel.querySelectorAll('.sfx-fx').forEach(st => {
                st.classList.toggle('on', Number(st.dataset.fx) === fxLv);
            });
        }
    }

    /**
     * 懒创建音量设置面板（role=dialog 挂到 body）：全部声音开关 + 音乐/音效各 4 档点选条 + 演出强度 4 档点选条
     * 点击事件统一在面板上代理分发；主题色运行时从主按钮取色注入 --vol-accent（页面零主题编辑）
     */
    function buildPanel() {
        if (panel) return;
        panel = document.createElement('div');
        panel.id = 'sfxPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '声音 · 演出设置');
        // 结构：标题（含 ✕ 关闭钮）+ 总开关 + 音乐 4 档 + 音效 4 档 + 演出强度 4 档（精简/标准/完整/自动，档位名取 FX_LEVEL_NAMES，FX 未加载时按同名字面量兜底）
        let html = '<div class="sfx-head"><span>声音 · 演出设置</span><button type="button" class="sfx-close" aria-label="关闭面板">✕</button></div>'
            + '<button type="button" class="sfx-mute">♪ 全部声音 · 关</button>'
            + '<div class="sfx-label">♪ 音乐</div><div class="sfx-row" data-ch="b">'
            + VOL_NAMES.map((n, i) => `<button type="button" class="sfx-step" data-ch="b" data-vol="${i}">${n}</button>`).join('')
            + '</div>'
            + '<div class="sfx-label">✦ 音效</div><div class="sfx-row" data-ch="s">'
            + VOL_NAMES.map((n, i) => `<button type="button" class="sfx-step" data-ch="s" data-vol="${i}">${n}</button>`).join('')
            + '</div>'
            + '<div class="sfx-label">✧ 演出</div><div class="sfx-row">'
            + (window.FX ? window.FX.FX_LEVEL_NAMES : ['精简', '标准', '完整', '自动']).map((n, i) => `<button type="button" class="sfx-step sfx-fx" data-fx="${i}">${n}</button>`).join('')
            + '</div>';
        panel.innerHTML = html;
        document.body.appendChild(panel);
        // 主题色跟随各页面主按钮颜色（取不到时回退金色），实现 8 页零主题色编辑
        try {
            const accent = mainBtn ? getComputedStyle(mainBtn).color : '';
            panel.style.setProperty('--vol-accent', accent || '#ffd23e');
        } catch (e) { /* 取色失败用 CSS 回退色 */ }
        // 面板点击代理：总开关走 muteCore、档位走 setVolCore；嵌入模式下转为向父页转发
        panel.addEventListener('click', (e) => {
            const t = e.target.closest('button');
            if (!t) return;
            if (t.classList.contains('sfx-close')) { panel.classList.remove('open'); return; } // ✕ 收起面板
            if (t.classList.contains('sfx-mute')) {
                if (EMBED) window.parent.postMessage({ type: 'arcade:audio', act: 'toggle' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
                else muteCore();
                return;
            }
            if (t.classList.contains('sfx-fx')) {
                // 演出强度档位：面板仅作入口，状态权威在 fx.js（须先于 .sfx-step 分支——本行按钮同挂 sfx-step 类）
                const idx = Number(t.dataset.fx);
                if (EMBED) window.parent.postMessage({ type: 'arcade:fxlevel', act: 'set', idx }, POST_MSG_TARGET); // 嵌入模式转发父页，由 fx.js 持久化并广播
                else if (window.FX) window.FX.setFxLevel(idx); // 本地运行直接调 FX（fx.js 先于本文件加载，恒存在）
                return;
            }
            if (t.classList.contains('sfx-step')) {
                const ch = t.dataset.ch === 'b' ? 'b' : 's';
                if (EMBED) window.parent.postMessage({ type: 'arcade:audio', act: 'vol', ch, idx: Number(t.dataset.vol) }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
                else setVolCore(ch, Number(t.dataset.vol));
            }
        });
        syncUI();
    }

    /**
     * 展开/收起音量设置面板（懒创建）；打开时刷新到最新状态
     * @param {boolean} [force] 传 true 强制展开（忽略当前开合状态）
     */
    function togglePanel(force) {
        buildPanel();
        const open = force === true ? true : !panel.classList.contains('open');
        panel.classList.toggle('open', open);
        if (open) syncUI();
    }

    // 面板外点击关闭（捕获阶段，先于面板自身 click 处理）；Esc 键关闭
    document.addEventListener('pointerdown', (e) => {
        if (panel && panel.classList.contains('open')
            && !panel.contains(e.target) && !(mainBtn && mainBtn.contains(e.target))) {
            panel.classList.remove('open');
        }
    }, true);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel && panel.classList.contains('open')) panel.classList.remove('open');
    });

    /**
     * 绑定音控主按钮交互：单击=静音切换（面板展开时改为收起面板）、长按 450ms/右键=音量面板、全局 M 键=静音切换
     * （dataset.sfxBound 防重复绑定；嵌入模式下切换/面板数据均转发父页处理）
     * @param {HTMLButtonElement} [btn] 音控主按钮（页面未放置时仅注册 M 键等全局交互）
     */
    function setupAudioUI(btn) {
        if (btn && !btn.dataset.sfxBound) {
            btn.dataset.sfxBound = '1';
            mainBtn = btn;
            let lpTimer = 0;   // 长按计时器句柄
            let lpFired = false; // 本次按压是否已触发长按（抑制随后的 click 与 contextmenu 双触发）
            btn.addEventListener('pointerdown', () => {
                lpFired = false;
                clearTimeout(lpTimer);
                lpTimer = setTimeout(() => { lpFired = true; togglePanel(true); }, 450); // 长按 450ms 展开面板（高于慢速点击时长，避免点击被误判吞掉）
            });
            const cancelLp = () => clearTimeout(lpTimer);
            btn.addEventListener('pointerup', cancelLp);
            btn.addEventListener('pointercancel', cancelLp);
            btn.addEventListener('pointerleave', cancelLp);
            btn.addEventListener('click', () => {
                if (lpFired) return; // 长按已处理，吞掉本次单击
                if (panel && panel.classList.contains('open')) { panel.classList.remove('open'); return; } // 面板展开时单击主键=收起面板（总开关走面板内按钮，避免误切静音）
                if (EMBED) window.parent.postMessage({ type: 'arcade:audio', act: 'toggle' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
                else muteCore();
            });
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // 右键即面板，屏蔽系统菜单
                if (lpFired) return; // 移动端长按可能伴随系统 contextmenu，去重
                togglePanel();
            });
        } else if (btn) {
            mainBtn = btn; // 已绑定过（如重复调用 init）仅刷新引用
        }
        syncUI();
        // 全局 M 键静音切换：捕获阶段监听，防止游戏侧 stopPropagation 拦截
        if (!window.__arcadeAudioKeyBound) {
            window.__arcadeAudioKeyBound = true;
            window.addEventListener('keydown', (e) => {
                if (e.code !== 'KeyM' || e.repeat) return;
                const tag = (e.target && e.target.tagName) || '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return; // 输入场景不拦截
                if (EMBED) window.parent.postMessage({ type: 'arcade:audio', act: 'toggle' }, POST_MSG_TARGET); // 目标 origin 取 POST_MSG_TARGET
                else muteCore();
            }, true);
        }
    }

    /** 一次性注入音控 UI 样式（主按钮音符/箭头装饰、静音态灰化删除线、面板与档位点选条） */
    function injectStyle() {
        if (document.getElementById('sfxUiStyle')) return;
        const st = document.createElement('style');
        st.id = 'sfxUiStyle';
        st.textContent = [
            // 主按钮基础防护：禁长按选中文本/系统呼出（移动端长按会误触选择与菜单），touch-action 去双击缩放延迟
            '.sound-toggle{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation;}',
            // 主按钮按压反馈：轻微缩小，让每次点击都有可感知的视觉响应
            '.sound-toggle:active{transform:scale(0.94);}',
            // 主按钮内的音符与下拉箭头装饰
            '.sound-toggle .snd-note{margin-right:4px;font-size:0.9em;}',
            '.sound-toggle .snd-caret{margin-left:4px;font-size:0.8em;opacity:0.75;}',
            // 音量面板：黑底主题色边框，右上角定位于全屏按钮下方，不遮挡游戏区
            '#sfxPanel{position:fixed;top:96px;right:16px;z-index:9999;width:176px;display:none;flex-direction:column;gap:6px;',
            'padding:10px;background:rgba(8,8,20,0.96);border:2px solid var(--vol-accent,#ffd23e);border-radius:6px;',
            "font-family:'Press Start 2P',monospace;font-size:10px;color:#eee;box-shadow:0 4px 16px rgba(0,0,0,0.6);}",
            '#sfxPanel.open{display:flex;}',
            '#sfxPanel .sfx-head{display:flex;align-items:center;justify-content:space-between;color:var(--vol-accent,#ffd23e);letter-spacing:1px;}',
            // 面板标题栏 ✕ 关闭钮：弱化灰字，悬停点亮主题色
            '#sfxPanel .sfx-close{background:none;border:0;color:#9aa;font:inherit;cursor:pointer;padding:0 2px;line-height:1;}',
            '#sfxPanel .sfx-close:hover{color:var(--vol-accent,#ffd23e);}',
            // 总开关按钮：通宽描边按钮
            '#sfxPanel .sfx-mute{padding:6px 4px;background:transparent;border:1px solid var(--vol-accent,#ffd23e);border-radius:4px;',
            'color:var(--vol-accent,#ffd23e);font:inherit;cursor:pointer;text-align:center;}',
            '#sfxPanel .sfx-label{font-size:9px;color:#9aa;letter-spacing:1px;}',
            // 档位条：4 等分点选，选中态主题色底 + 深色字
            '#sfxPanel .sfx-row{display:flex;gap:4px;}',
            '#sfxPanel .sfx-step{flex:1;padding:5px 0;background:#151528;border:1px solid #333;border-radius:4px;',
            'color:#ccc;font:inherit;font-size:9px;cursor:pointer;text-align:center;}',
            '#sfxPanel .sfx-step.on{background:var(--vol-accent,#ffd23e);border-color:var(--vol-accent,#ffd23e);color:#0a0a1a;font-weight:bold;}',
            '#sfxPanel .sfx-step:hover{border-color:var(--vol-accent,#ffd23e);}'
        ].join('');
        document.head.appendChild(st);
    }

    // 自动初始化音控 UI：注入样式并绑定页面上的音控主按钮（各页面无需手动调用）
    // 注意：必须位于 IIFE 内部——injectStyle/setupAudioUI 为闭包私有函数，外部无法访问
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectStyle();
            setupAudioUI(document.getElementById('soundToggle'));
        });
    } else {
        injectStyle();
        setupAudioUI(document.getElementById('soundToggle'));
    }


    return {
        /** 当前音效是否可出声（未静音时为 true；静音不改动档位，游戏代码据此可做提示条等联动） */
        get enabled() { return !muted; },

        /** 当前是否处于一键静音状态 */
        get muted() { return muted; },

        /**
         * v2.8 立体声声像定位：把后续输出（SFX 与 BGM 均经主输出链）临时拨向左(-1)~右(+1)，
         * 静默 holdMs 后自动回中。音频图尚未创建（还没播过任何声音）或浏览器不支持
         * StereoPanner 时静默忽略；连续调用会重置回中倒计时
         * @param {number} x 声像位置：-1 最左 ~ +1 最右（越界自动钳位），0 表示立即回中
         * @param {number} [holdMs=260] 静默多少毫秒后自动回中（短促方位事件传默认值即可）
         */
        pan(x, holdMs = 260) {
            if (!ctx || !panner) return; // 音频图未就绪/浏览器不支持：静默忽略
            const v = Math.min(Math.max(x, -1), 1);
            panner.pan.setTargetAtTime(v, ctx.currentTime, 0.02); // 20ms 平滑到位，避免声像跳变爆音
            clearTimeout(panTimer);
            panTimer = setTimeout(() => { // 静默期结束自动回中
                if (ctx && panner) panner.pan.setTargetAtTime(0, ctx.currentTime, 0.08);
            }, Math.max(1, holdMs));
        },

        /**
         * v2.9 实时频谱采样：读取主输出链末端 AnalyserNode 的一帧频谱，返回三路 0~1 归一化能量。
         * 采样点位于静音/音量增益之后——静音、BGM 档 0 且无音效时返回全零，
         * 视觉联动（大厅灯带/投币口）随之回暗，与「音乐真响灯带真亮」的语义一致
         * @returns {{b:number, t:number, e:number}} 低频 b（鼓点/BGM 低音声部）、高频 t（高音铃点/
         *          噪声音效）、全频 e 三路 0~1 能量；音频图尚未创建（从未出过声）时同样返回全零。
         *          返回值为模块内复用对象，调用方须当帧消费，不得跨帧缓存引用
         */
        level() {
            if (!analyser) return LV; // 音频图未建：全零基态
            analyser.getByteFrequencyData(freqData);
            let sumB = 0, sumT = 0, sumE = 0;
            for (let i = 1; i <= 8; i++) sumB += freqData[i];  // 低频桶（约 172~1550Hz）：鼓点与 BGM 低音声部
            for (let i = 24; i < 96; i++) sumT += freqData[i]; // 中高频段（约 4.1~16.5kHz）：高音铃点与噪声音效质感
            for (let i = 1; i < 128; i++) sumE += freqData[i]; // 全频段：整体响度能量
            LV.b = sumB / (8 * 255);
            LV.t = sumT / (72 * 255);
            LV.e = sumE / (127 * 255);
            return LV;
        },

        /** BGM 播放器（start/stop/pause/resume/playing） */
        bgm,

        /**
         * 切换一键静音（档位无损保留）
         * 嵌入模式下状态由大厅（父页）统一持有，仅转发切换请求；父页切换后会广播回所有子页
         */
        muteToggle() {
            if (EMBED) { window.parent.postMessage({ type: 'arcade:audio', act: 'toggle' }, POST_MSG_TARGET); return; } // 目标 origin 取 POST_MSG_TARGET
            muteCore();
        },

        /**
         * 设置指定通道音量档位（0~3 点选式，非循环）
         * 嵌入模式下仅转发请求给父页；父页设置后会广播回所有子页
         * @param {'b'|'s'} ch 通道：b=BGM（音乐），s=SFX（音效）
         * @param {number} idx 档位索引（0~3）
         */
        volSet(ch, idx) {
            if (EMBED) { window.parent.postMessage({ type: 'arcade:audio', act: 'vol', ch: ch === 'b' ? 'b' : 's', idx }, POST_MSG_TARGET); return; } // 目标 origin 取 POST_MSG_TARGET
            setVolCore(ch, idx);
        },

        /** 展开/收起音量设置面板（长按/右键由 setupAudioUI 内部接线调用，亦可供外部触发） */
        panelToggle() { togglePanel(); },

        /**
         * 初始化音控主按钮（注入样式、绑定单点/长按/右键/M 键事件；页面加载时自动调用）
         * @param {HTMLButtonElement} [btn] 音控主按钮
         */
        init(btn) { setupAudioUI(btn); },

        /* ---------- 通用 UI 音效 ---------- */
        /** 悬停：极短高音提示 */
        uiHover: () => tone(880, 0.04, 'square', 0.06),
        /** 点击：双音上行确认 */
        uiClick: () => { tone(520, 0.06, 'square', 0.12); tone(780, 0.08, 'square', 0.12, 0, 0.05); },
        /** 游戏开始：上行琶音号角 */
        start: () => arpeggio([392, 523, 659, 784], 0.08),
        /** 游戏结束：下行锯齿波哀鸣 */
        gameOver: () => arpeggio([392, 330, 262, 196, 131], 0.12, 'sawtooth', 0.13),
        /** 投币：清脆金属双音（988→1319Hz，与首次手势解锁音同款更响亮）+ 高音闪光尾音，大厅投币口每次投币播放 */
        coin: () => { tone(988, 0.07, 'square', 0.12); tone(1319, 0.2, 'square', 0.12, 0, 0.08); tone(2093, 0.28, 'triangle', 0.07, 0, 0.16); },
        /** 吞币：金币落箱"咚"（180→90Hz 低频下滑三角波）+ 高频火花杂音 + 金属余韵叮响，金币抵达投币口瞬间播放 */
        coinSwallow: () => { tone(180, 0.14, 'triangle', 0.16, 90); noise(0.1, 0.05, 2600); tone(1568, 0.05, 'square', 0.07, 0, 0.03); tone(2093, 0.12, 'triangle', 0.05, 0, 0.06); },
        /** 成就殿堂开幕：上行五连琶音 + 高音闪光长尾，鎏金殿堂揭幕仪式音（大厅成就殿堂按钮） */
        hallOpen: () => { arpeggio([392, 523, 659, 784, 1047], 0.09, 'triangle', 0.12); tone(2093, 0.32, 'sine', 0.06, 0, 0.48); },

        /* ---------- 贪吃蛇音效 ---------- */
        /** 吃到食物：双音上行"啵" */
        snakeEat: () => { tone(440, 0.07, 'square', 0.15); tone(660, 0.1, 'square', 0.15, 0, 0.06); },
        /** 转向：极短低音"嗒" */
        snakeTurn: () => tone(220, 0.03, 'triangle', 0.07),
        /** 撞击死亡：下滑哀鸣 + 噪声炸裂（配合死亡熄灭演出，与结算音错开） */
        snakeDie: () => { tone(520, 0.4, 'sawtooth', 0.13, 80); noise(0.2, 0.07, 300); },

        /* ---------- 俄罗斯方块音效 ---------- */
        /** 移动/软降：极短低音 */
        tMove: () => tone(200, 0.03, 'triangle', 0.08),
        /** 旋转：短促中音 */
        tRotate: () => tone(320, 0.05, 'triangle', 0.1),
        /** 硬降：快速下滑音 */
        tDrop: () => tone(600, 0.08, 'square', 0.08, 150),
        /** 落地锁定：低音钝响 + 噪声撞击 */
        tLock: () => { tone(150, 0.08, 'square', 0.14); noise(0.06, 0.06, 400); },
        /** 消行：音高随消行数递增的琶音（1~2 行普通、3~4 行华丽） */
        tClear: (lines) => arpeggio([523, 659, 784, 1047, 1319].slice(0, 3 + lines), 0.07),
        /** 升级：六连快速琶音 */
        tLevelUp: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.06),
        /** T-SPIN：上滑双音接高音闪（T 块旋入凹槽的"骚操作"达成提示） */
        tSpin: () => { tone(700, 0.08, 'square', 0.12, 1100); tone(1568, 0.16, 'square', 0.09, 0, 0.07); },
        /** 全消（ALL CLEAR）：六连琶音接高音 sparkle 长尾（清空整个棋盘的大奖仪式感） */
        allClear: () => { arpeggio([523, 659, 784, 1047, 1319, 1568], 0.08, 'square', 0.13); tone(2093, 0.35, 'sine', 0.07, 0, 0.5); },

        /* ---------- 吃豆人音效 ---------- */
        /** 吃豆：交替双频 waka-waka */
        pacWaka: (alt) => tone(alt ? 550 : 380, 0.07, 'square', 0.1, alt ? 380 : 550),
        /** 能量豆：上行五连琶音，宣告反杀开始 */
        pacPower: () => arpeggio([262, 330, 392, 523, 659], 0.06, 'square', 0.13),
        /** 吃掉幽灵：低频大幅上滑的长音 */
        pacGhost: () => tone(200, 0.35, 'sawtooth', 0.14, 900),
        /** 死亡：长下滑哀鸣 + 噪声炸裂 */
        pacDeath: () => { tone(600, 0.5, 'sawtooth', 0.15, 80); noise(0.3, 0.08, 300); },
        /** 开场准备：三角波轻快旋律 */
        pacReady: () => arpeggio([523, 784, 659, 1047], 0.1, 'triangle', 0.12),
        /** 清版过关：上行五连琶音 */
        pacLevelUp: () => arpeggio([392, 523, 659, 784, 1047], 0.08),

        /* ---------- 3D弹球音效 ---------- */
        /** 弹柱撞击：高频双音"叮"，清脆金属感 */
        pinBumper: () => { tone(1180, 0.05, 'square', 0.12); tone(1570, 0.08, 'square', 0.1, 0, 0.04); },
        /** 弹射器击飞：快速大幅上滑"嘣" */
        pinSling: () => tone(300, 0.09, 'square', 0.13, 900),
        /** 挡板拍击：极短低音"嗒" + 噪声敲击质感 */
        pinFlip: () => { tone(180, 0.04, 'triangle', 0.1); noise(0.03, 0.05, 600); },
        /** 发射：中频上滑长音，球离台入场的宣告 */
        pinLaunch: () => tone(400, 0.12, 'sawtooth', 0.1, 820),
        /** 墙壁碰撞：极短闷响（调用方需自行节流） */
        pinWall: () => tone(140, 0.03, 'triangle', 0.06),
        /** 失球：下滑哀鸣（球坠入深渊） */
        pinLose: () => tone(520, 0.32, 'sawtooth', 0.13, 110),

        /* ---------- 小蜜蜂音效 ---------- */
        /** 射击：极短高频激光"哔" */
        beeShoot: () => tone(900, 0.05, 'square', 0.07, 480),
        /** 蜜蜂被击落：短促下滑 + 噪声碎裂 */
        beeDie: () => { tone(620, 0.09, 'square', 0.1, 220); noise(0.06, 0.06, 900); },
        /** 精英蜂受击未死：低频钝响（亦用于 Boss 受击） */
        beeArmorHit: () => tone(160, 0.06, 'square', 0.12),
        /** 精英蜂被击落：更低沉的双段爆裂 */
        beeEliteDie: () => { tone(420, 0.12, 'sawtooth', 0.11, 140); noise(0.1, 0.07, 500); },
        /** 俯冲警报：快速下滑啸音，提示玩家闪避 */
        beeDive: () => tone(1200, 0.25, 'sawtooth', 0.06, 300),
        /** Boss 登场警告：低频三连轰鸣（精英阵事件波亦复用） */
        beeBossWarn: () => { tone(98, 0.18, 'sawtooth', 0.14); tone(98, 0.18, 'sawtooth', 0.14, 0, 0.25); tone(98, 0.25, 'sawtooth', 0.16, 0, 0.5); },
        /** Boss 入场警报：低频三连轰鸣接三轮高音警笛滑降，总长约 1.8 秒与警告演出等长 */
        beeBossAlarm: () => {
            tone(98, 0.18, 'sawtooth', 0.14);
            tone(98, 0.18, 'sawtooth', 0.14, 0, 0.25);
            tone(98, 0.25, 'sawtooth', 0.16, 0, 0.5);
            tone(880, 0.28, 'sawtooth', 0.08, 440, 0.75);
            tone(880, 0.28, 'sawtooth', 0.09, 440, 1.1);
            tone(660, 0.32, 'sawtooth', 0.1, 330, 1.45);
        },
        /** Boss 被击败：长噪声爆炸 + 下行琶音 */
        beeBossDie: () => { noise(0.5, 0.12, 250); arpeggio([392, 330, 262, 196, 131], 0.1, 'sawtooth', 0.12); },
        /** Boss 落地冲击：超低频重锤 + 带通噪声轰鸣，配合震屏与尘爆粒子（入场演出收束） */
        beeBossLand: () => { tone(60, 0.32, 'sawtooth', 0.2, 28); tone(120, 0.18, 'square', 0.1, 50, 0.03); noise(0.28, 0.15, 130); },
        /** 玩家被击中：下滑哀鸣 + 噪声撞击 */
        beePlayerHit: () => { tone(560, 0.35, 'sawtooth', 0.14, 90); noise(0.2, 0.08, 350); },
        /** 护盾抵挡：清脆玻璃质感双音 */
        beeShieldHit: () => { tone(880, 0.05, 'triangle', 0.12); tone(1320, 0.08, 'triangle', 0.1, 0, 0.04); },
        /** 拾取道具：上行三连音（通用拾取反馈，贪吃蛇金苹果等场合复用） */
        beePowerup: () => arpeggio([523, 784, 1047], 0.07, 'square', 0.12),
        /** 拾取武器升级：五连急速上行琶音，火力递升的爆发感 */
        beePowerupWeapon: () => arpeggio([392, 523, 659, 784, 1047], 0.05, 'square', 0.12),
        /** 拾取护盾：三角波低→高充能上滑 + 高音尾音确认，能量充盈质感 */
        beePowerupShield: () => { tone(196, 0.26, 'triangle', 0.13, 784); tone(1047, 0.14, 'triangle', 0.11, 0, 0.24); },
        /** 拾取 1UP：温暖四连上行琶音 + 高音铃点，续命复苏感 */
        beePowerupLife: () => { arpeggio([523, 659, 784, 1047], 0.08, 'triangle', 0.13); tone(1568, 0.2, 'square', 0.08, 0, 0.32); },
        /** 连击倍率提升：音高随倍率递增的双音 */
        beeCombo: (mult) => { const f = 660 + mult * 120; tone(f, 0.06, 'square', 0.11); tone(f * 1.5, 0.09, 'square', 0.11, 0, 0.05); },
        /** 奖励 1UP：经典四音上行小旋律 */
        beeOneUp: () => arpeggio([659, 784, 1319, 1047], 0.09, 'square', 0.12),
        /** 清波奖励：上行琶音 */
        beeWaveClear: () => arpeggio([523, 659, 784, 1047], 0.07),
        /** 分裂蜂裂解：快速两段下滑 */
        beeSplit: () => { tone(760, 0.06, 'square', 0.1, 420); tone(420, 0.06, 'square', 0.1, 220, 0.06); },
        /** 自爆蜂引爆：噪声爆裂 + 低频冲击 */
        beeBomberBoom: () => { noise(0.25, 0.11, 350); tone(120, 0.25, 'sawtooth', 0.13, 40); },
        /** 冲刺：快速上滑嗖音 */
        beeDash: () => tone(300, 0.12, 'sawtooth', 0.08, 900),
        /** 激光射击：高频电音 zap */
        beeLaser: () => tone(1400, 0.06, 'sawtooth', 0.06, 700),
        /** 全屏炸弹：长噪声巨响 + 低音轰鸣 */
        beeBomb: () => { noise(0.45, 0.13, 200); tone(80, 0.4, 'sawtooth', 0.15, 30); },
        /** 时停：下行滑音接回弹，时间扭曲质感 */
        beeSlow: () => { tone(900, 0.3, 'sine', 0.1, 200); tone(200, 0.2, 'sine', 0.08, 500, 0.3); },
        /** 磁铁：短促双上滑音 */
        beeMagnet: () => { tone(500, 0.08, 'triangle', 0.11, 900); tone(700, 0.1, 'triangle', 0.1, 1200, 0.07); },
        /** 成就解锁：胜利五连琶音 */
        beeAchievement: () => arpeggio([523, 659, 784, 880, 1319], 0.09, 'square', 0.12),
        /** 冲刺冷却就绪：清脆双高音提示 */
        beeDashReady: () => { tone(880, 0.05, 'sine', 0.09); tone(1320, 0.08, 'sine', 0.09, 0, 0.05); },
        /** 蜂群碰壁下压：低沉钝响 */
        beeThud: () => tone(70, 0.12, 'square', 0.13, 45),
        /** Boss 狂暴：急促上行警示双鸣 */
        beeEnrage: () => { tone(150, 0.1, 'sawtooth', 0.12, 240); tone(240, 0.16, 'sawtooth', 0.13, 360, 0.1); },
        /** 低命警报：急促双哔 */
        beeAlarm: () => { tone(740, 0.09, 'square', 0.1); tone(740, 0.09, 'square', 0.1, 0, 0.16); },
        /** 连环殉爆小爆：中频噪声短爆 */
        beeBoom: () => { noise(0.12, 0.09, 500); tone(200, 0.12, 'square', 0.08, 60); },
        /** 新纪录达成：辉煌六连琶音 */
        beeRecord: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.09, 'square', 0.12),

        /* ---------- 华容道音效 ---------- */
        /** 滑块滑动：低沉木质滑音，音高随一次滑过格数递增（连滑越远音越高昂） */
        klMove: (steps = 1) => { const f = 240 + (Math.max(1, steps) - 1) * 60; tone(f, 0.07, 'triangle', 0.12, f * 0.7); },
        /** 落位吸附：短促"咔哒" + 轻噪声，滑动补间结束棋子吸进格位的质感 */
        klSnap: () => { tone(340, 0.04, 'square', 0.09); noise(0.03, 0.04, 900); },
        /** 临近出口：轻快上行双哔（曹操一步即可入出口、临门高亮点燃的提示） */
        klNear: () => { tone(880, 0.06, 'square', 0.08); tone(1175, 0.09, 'square', 0.08, 0, 0.09); },
        /** 回弹：低到高快速上滑"啵嘤"弹性音（拖拽未过半格归位） */
        klBounce: () => tone(150, 0.1, 'triangle', 0.1, 270),
        /** 新纪录：高音区五连琶音延迟起奏，与通关琶音接力形成"通关 → 破纪录"两段式辉煌 */
        klRecord: () => [784, 988, 1319, 1760, 2093].forEach((f, i) => tone(f, 0.1, 'triangle', 0.11, 0, 0.55 + i * 0.09)),
        /** 选中滑块：轻点确认音 */
        klSelect: () => tone(560, 0.04, 'square', 0.07),
        /** 无法移动：低频闷响（撞墙/卡死反馈） */
        klBlock: () => tone(110, 0.09, 'square', 0.13, 70),
        /** 撤销：两段下滑回溯音 */
        klUndo: () => { tone(420, 0.05, 'triangle', 0.09); tone(300, 0.07, 'triangle', 0.09, 0, 0.05); },
        /** 求助提示：轻快三连上行"叮叮叮"（金点子闪现的灵感音，H 键提示） */
        klHint: () => { tone(660, 0.05, 'triangle', 0.09); tone(880, 0.05, 'triangle', 0.09, 0, 0.06); tone(1320, 0.12, 'triangle', 0.1, 0, 0.12); },
        /** 通关：胜利六连琶音 */
        klWin: () => arpeggio([523, 659, 784, 1047, 1319, 1568], 0.09, 'square', 0.13),
        /** S 级评级专属：明亮大调琶音 + 高音 sparkle 长尾（结算面板揭晓 S 级的仪式感） */
        klRankS: () => {
            arpeggio([523, 659, 784, 1047], 0.08, 'triangle', 0.11);
            tone(1568, 0.35, 'triangle', 0.08, 0, 0.36); // 高音 sparkle 长尾
            tone(2093, 0.3, 'sine', 0.05, 0, 0.44);
        },
        /** 曹操滑动专属：低音区厚重滑音 + 摩擦噪声（一代枭雄的分量感，与普通棋子的轻快滑音区分） */
        klMoveCao: (steps = 1) => {
            const f = 140 + (Math.max(1, steps) - 1) * 40; // 低音区随步数微升，但整体保持厚重
            tone(f, 0.11, 'square', 0.12, f * 0.65);
            noise(0.06, 0.05, 500);
        },
        /** 选中曹操专属：庄重低音双响（"枭雄登场"的低频分量，与普通棋子的轻点音区分） */
        klSelectCao: () => { tone(196, 0.07, 'triangle', 0.11); tone(294, 0.09, 'triangle', 0.09, 0, 0.06); },
        /** 曹操破门逃脱：低频上滑轰鸣 + 摩擦噪声 + 高音闪（逃脱演出起手的破门冲刺质感） */
        klEscape: () => {
            tone(80, 0.55, 'sawtooth', 0.13, 300); // 低频上滑：破门瞬间的轰鸣推升
            noise(0.25, 0.07, 600); // 摩擦噪声：木屑纷飞的粗粝感
            tone(1200, 0.2, 'sine', 0.06, 1800, 0.3); // 延迟高音闪：冲出后的余韵
        },
        /** 开局开演：古风号角三连音（延迟起奏，与通用 start 琶音错峰） */
        klGo: () => [392, 523, 784].forEach((f, i) => tone(f, 0.12, 'triangle', 0.12, 0, 0.25 + i * 0.1)),
        /** 布局切换：木质翻牌摩擦双音（换局时的道具翻动质感） */
        klLayout: () => { tone(440, 0.07, 'triangle', 0.1, 300); noise(0.05, 0.04, 800); },
        /** 连击里程碑：音高随档位递增的双音（妙手连击的爽快感） */
        klCombo: (lvl = 0) => { const f = [660, 784, 988][Math.min(lvl, 2)]; tone(f, 0.06, 'square', 0.11); tone(f * 1.5, 0.1, 'square', 0.1, 0, 0.05); },
        /** 逼近纪录：低音心跳两连（破纪录前的紧张感） */
        klTense: () => { tone(92, 0.1, 'sine', 0.13); tone(92, 0.12, 'sine', 0.13, 0, 0.16); },

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

        /* ---------- 通用扩展音效（v2 新增：跨游戏复用） ---------- */
        /** 危险警报：告急警报哔（1 级单高音 / 2 级更低沉双音，供 tetris 等临场复用） @param {number} [level] 警报级别 1~2 */
        alarm: (level = 1) => { const f = level >= 2 ? 330 : 440; tone(f, 0.09, 'square', 0.1); if (level >= 2) tone(f, 0.09, 'square', 0.1, 0, 0.14); },
        /** 通用暂停：下行双音（时间冻结的收束感） */
        uiPause: () => { tone(520, 0.07, 'triangle', 0.09); tone(360, 0.09, 'triangle', 0.08, 0, 0.07); },
        /** 通用恢复：上行双音（解除暂停重新出发的推进感） */
        uiResume: () => { tone(360, 0.06, 'triangle', 0.08); tone(560, 0.08, 'triangle', 0.09, 0, 0.06); },
        /** 连击递进：音高随连击等级递升的双音（连击手感通配） @param {number} [level] 连击等级 0~8 */
        comboUp: (level = 0) => { const f = 560 + Math.min(Math.max(0, level), 8) * 70; tone(f, 0.06, 'square', 0.1); tone(f * 1.5, 0.09, 'square', 0.09, 0, 0.05); },
        /** 破纪录：金光上扬五连琶音（各游戏破纪录演出通配） */
        newRecord: () => arpeggio([523, 659, 784, 1047, 1319], 0.09, 'square', 0.12),
        /** 弹珠蓄力：音高随蓄力进度上滑的短哔 @param {number} [p] 蓄力进度 0~1 */
        pinCharge: (p = 0) => tone(180 + Math.min(Math.max(p, 0), 1) * 560, 0.05, 'square', 0.06),
        /** CRT 开机：低频嗡鸣 + 高频扫过 + 静电噪声（需 ctx 已运行，页面加载时静默跳过） */
        crtOn: () => { tone(52, 0.5, 'sawtooth', 0.12, 220); tone(1200, 0.14, 'sine', 0.05, 2400, 0.32); noise(0.25, 0.03, 900); },
        /** CRT 关机：下滑余晖 + 偏转弛断 + 断电噪声（有关手势，必可出声） */
        crtOff: () => { tone(320, 0.45, 'sawtooth', 0.12, 40); tone(1600, 0.07, 'sine', 0.05, 180, 0.02); noise(0.1, 0.04, 260); },

        /* ---------- 主页卡片音效（不同游戏不同特色音） ---------- */
        /** 贪吃蛇卡片：蛇形上滑音 */
        cardSnake: () => tone(300, 0.12, 'sawtooth', 0.09, 600),
        /** 俄罗斯方块卡片：方块移动双击音 */
        cardTetris: () => { tone(240, 0.05, 'square', 0.1); tone(320, 0.05, 'square', 0.1, 0, 0.06); },
        /** 吃豆人卡片：waka 双向滑音 */
        cardPac: () => { tone(380, 0.06, 'square', 0.1, 550); tone(550, 0.06, 'square', 0.1, 380, 0.07); },
        /** 3D弹球卡片：弹射器式上滑音 */
        cardPinball: () => tone(220, 0.14, 'square', 0.1, 880),
        /** 小蜜蜂卡片：蜂翼振颤式的上下抖动嗡鸣 */
        cardBee: () => { tone(210, 0.07, 'sawtooth', 0.1, 300); tone(300, 0.07, 'sawtooth', 0.1, 210, 0.08); },
        /** 华容道卡片：古风木质拨弦下滑双音（棋子叩击木盘的温润质感） */
        cardKlotski: () => { tone(520, 0.08, 'triangle', 0.11, 390); tone(390, 0.1, 'triangle', 0.09, 0, 0.09); },
        /** 1024卡片：数字方块滑动上滑音 + 合并确认双击（对应玩法核心动作） */
        cardN1024: () => { tone(330, 0.09, 'triangle', 0.09, 540); tone(540, 0.06, 'square', 0.09, 0, 0.1); tone(660, 0.08, 'square', 0.07, 0, 0.16); }
    };
})();
