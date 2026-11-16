/* ==========================================================================
 * arcade-common.js —— 街机厅公共基础库（零依赖，须在 audio/fx/fullscreen 等公共库之前加载）
 * 职责一：跨帧 postMessage 统一来源守卫（全项目 message 监听收口于此，策略改动只改本文件）
 * 职责二：localStorage 安全存取（JSON 序列化 + 降级兜底；写失败/读损坏同键仅告警一次，精细读用 loadJSONState）
 * 职责三：指针捕获守卫（setPointerCapture 对已释放/合成指针抛 NotFoundError 的统一兜底）
 * 暴露全局：window.Arcade = { onTrustedMessage, saveJSON, loadJSON, loadJSONState, capturePointer }
 * ========================================================================== */
const Arcade = (() => {
    'use strict';

    /**
     * 注册带统一来源守卫的 window message 监听
     * 守卫策略：仅接受同源消息；file:// 直开场景各帧 origin 字面量为 'null'，仅当本页也是
     * file:// 协议时豁免；其余来源（跨源伪造的 arcade:* 指令）在守卫处静默丢弃
     * @param {(e: MessageEvent) => void} handler 通过守卫后的消息回调
     */
    function onTrustedMessage(handler) {
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin && !(e.origin === 'null' && location.protocol === 'file:')) return;
            handler(e);
        });
    }

    /**
     * 安全写档：JSON 序列化后写入 localStorage；隐私模式/配额满等存储不可用时降级跳过，
     * 本局不受影响；首次失败控制台告警便于观测（键未落盘由 loadJSON 的兜底值承接）
     * @param {string} key 存档键名
     * @param {*} value 任意可 JSON 序列化的值
     */
    const warnedWriteKeys = new Set(); // 已告警过的写失败键：存储被禁时同键反复失败，仅首次告警避免刷屏
    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            if (!warnedWriteKeys.has(key)) { // 同键仅首次告警
                warnedWriteKeys.add(key);
                console.warn('[Arcade] saveJSON 写入失败（本局继续，不持久化）:', key, e);
            }
        }
    }

    const warnedCorruptKeys = new Set(); // 已告警过的损坏键：坏档是玩家侧数据问题，同键首次告警即可定位
    /**
     * 精细读档：与 loadJSON 同源读取，但区分键缺失/内容损坏/存储不可用三种失败态，
     * 供需要差异化处理的调用方使用（如损坏时上报或引导重置）；普通读写无需感知本 API
     * @param {string} key 存档键名
     * @returns {{state:'ok'|'missing'|'corrupt'|'unavailable', value:*, raw:string|null}}
     *   ok：value 为反序列化结果、raw 为原始串；missing：键不存在（value 为 null）；
     *   corrupt：内容损坏（value 为 null、raw 保留坏串便于诊断，同键首次触发控制台告警）；
     *   unavailable：存储不可用（value 为 null）
     */
    function loadJSONState(key) {
        let raw;
        try { raw = localStorage.getItem(key); } catch (e) { return { state: 'unavailable', value: null, raw: null }; }
        if (raw === null) return { state: 'missing', value: null, raw: null };
        try {
            return { state: 'ok', value: JSON.parse(raw), raw: raw };
        } catch (e) {
            if (!warnedCorruptKeys.has(key)) { // 同键仅首次告警
                warnedCorruptKeys.add(key);
                console.warn('[Arcade] 存档数据损坏，已按缺失兜底:', key, e);
            }
            return { state: 'corrupt', value: null, raw: raw };
        }
    }

    /**
     * 安全读档：读取并 JSON 反序列化；键不存在/内容损坏/存储不可用时返回兜底值
     * （需区分失败原因时改用 loadJSONState）
     * @param {string} key 存档键名
     * @param {*} [fallback=null] 读取失败时的兜底值
     * @returns {*} 反序列化结果或 fallback
     */
    function loadJSON(key, fallback = null) {
        const s = loadJSONState(key);
        return s.state === 'ok' ? s.value : fallback; // 缺失/损坏/存储不可用统一走兜底，交由调用方承接
    }

    /**
     * 指针捕获守卫：setPointerCapture 在指针已释放（极快点按）、指针 id 失效或
     * 合成事件（如自动化测试派发的假 pointerId）场景下会抛 NotFoundError；
     * 捕获仅是"拖出画布仍跟踪指针"的体验增强，失败无副作用，
     * 统一在此静默兜底，调用方手势主流程不受影响
     * @param {Element} el 捕获目标元素（画布或按钮）
     * @param {number} pointerId 指针 id（取自 pointerdown 事件）
     */
    function capturePointer(el, pointerId) {
        try { el.setPointerCapture(pointerId); } catch (e) { /* 无活动指针：忽略 */ }
    }

    return { onTrustedMessage, saveJSON, loadJSON, loadJSONState, capturePointer };
})();
window.Arcade = Arcade;
