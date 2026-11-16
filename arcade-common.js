/* ==========================================================================
 * arcade-common.js —— 街机厅公共基础库（零依赖，须在 audio/fx/fullscreen 等公共库之前加载）
 * 职责一：跨帧 postMessage 统一来源守卫（全项目 message 监听收口于此，策略改动只改本文件）
 * 职责二：localStorage 安全存取（JSON 序列化 + 存储不可用静默降级）
 * 职责三：指针捕获守卫（setPointerCapture 对已释放/合成指针抛 NotFoundError 的统一兜底）
 * 暴露全局：window.Arcade = { onTrustedMessage, saveJSON, loadJSON, capturePointer }
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
     * 安全写档：JSON 序列化后写入 localStorage；隐私模式/配额满等存储不可用时静默跳过，不影响本局
     * @param {string} key 存档键名
     * @param {*} value 任意可 JSON 序列化的值
     */
    function saveJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 存储不可用时静默降级 */ }
    }

    /**
     * 安全读档：读取并 JSON 反序列化；键不存在/内容损坏/存储不可用时返回兜底值
     * @param {string} key 存档键名
     * @param {*} [fallback=null] 读取失败时的兜底值
     * @returns {*} 反序列化结果或 fallback
     */
    function loadJSON(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback; // 损坏数据按不存在处理，交由调用方兜底
        }
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

    return { onTrustedMessage, saveJSON, loadJSON, capturePointer };
})();
window.Arcade = Arcade;
