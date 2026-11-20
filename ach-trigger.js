/* ======================================================================
 * 成就墙 · 金杯触发器接线（仅游戏页引入；大厅由 index.js 直接绑定按钮）
 * 职责一：金杯 SVG 注入——向所有 .achWallTrigger 注入与旧页面内联逐字相同的
 *   <svg class="aw-cup">（Wave1 期页面仍有内联副本，querySelector 防重复守卫
 *   保证不双份；Wave2 删除页面内联后由此处接管单一来源）
 * 职责二：点击金杯触发器 = 按下全站统一开墙键 V：向 document 派发合成 KeyV
 *   keydown，复用各游戏既有的 V 键处理分支（开合切换、暂停态放行等行为
 *   完全一致），游戏逻辑零改动。
 * 依赖：宿主页面存在 .achWallTrigger 元素（无则静默跳过不影响其余功能）
 * ==================================================================== */
(function () {
    'use strict';
    // 金杯 SVG 源码常量：与旧游戏页 .achWallTrigger 内联 SVG 逐字相同（含渐变 id awcGold/awcLip/awcRibbon/awcBase）
    const CUP_SVG = '<svg class="aw-cup" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
        '<defs>' +
        '<linearGradient id="awcGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.42" stop-color="#ffd23e"/><stop offset="0.72" stop-color="#e3a52a"/><stop offset="1" stop-color="#b97e14"/></linearGradient>' +
        '<linearGradient id="awcLip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff9d6"/><stop offset="1" stop-color="#d9a325"/></linearGradient>' +
        '<linearGradient id="awcRibbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a7a"/><stop offset="0.55" stop-color="#e03e34"/><stop offset="1" stop-color="#9c2018"/></linearGradient>' +
        '<linearGradient id="awcBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe79a"/><stop offset="0.55" stop-color="#d99a26"/><stop offset="1" stop-color="#a86e0e"/></linearGradient>' +
        '</defs>' +
        // 杯耳：左右对称弯钩
        '<path d="M15 12C7 12 7 24 17 26" fill="none" stroke="url(#awcLip)" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M49 12C57 12 57 24 47 26" fill="none" stroke="url(#awcLip)" stroke-width="3.2" stroke-linecap="round"/>' +
        // 杯口沿 + 杯身（纵向金色渐变）
        '<rect x="12.5" y="6" width="39" height="4.5" rx="2" fill="url(#awcLip)"/>' +
        '<path d="M14 8h36v7c0 13-7.5 19-18 19-10.5 0-18-6-18-19z" fill="url(#awcGold)"/>' +
        // 杯颈 + 双层底座
        '<path d="M28 33h8l2.5 8h-13z" fill="url(#awcBase)"/>' +
        '<rect x="24" y="41" width="16" height="4.5" rx="1" fill="url(#awcBase)"/>' +
        '<rect x="19.5" y="45.5" width="25" height="6" rx="1.5" fill="url(#awcBase)"/>' +
        // 颈间蝴蝶结：双环自结心向左右环抱 + 结心锥鼓 + 两条短垂带（燕尾开衩），后绘前置系于杯颈，飘带不再自杯底垂落
        '<path d="M31 35.4C27.8 31 21 29.4 17.8 31.8C14.6 34.2 17 38.6 21.6 39C25.6 39.4 29.2 37.9 31 36.6Z" fill="url(#awcRibbon)"/>' +
        '<path d="M33 35.4C36.2 31 43 29.4 46.2 31.8C49.4 34.2 47 38.6 42.4 39C38.4 39.4 34.8 37.9 33 36.6Z" fill="url(#awcRibbon)"/>' +
        // 环内暗折痕：暗示绸带对折层次
        '<path d="M29.4 36.8C26 35.6 21.6 34.4 18.6 32.6" fill="none" stroke="#7d1710" stroke-opacity="0.4" stroke-width="1" stroke-linecap="round"/>' +
        '<path d="M34.6 36.8C38 35.6 42.4 34.4 45.4 32.6" fill="none" stroke="#7d1710" stroke-opacity="0.4" stroke-width="1" stroke-linecap="round"/>' +
        // 双垂带：自结心下方左右分开，末端燕尾开衩
        '<path d="M30.5 38.2C29.1 40.3 28.2 41.9 27.6 43.6L29.6 42.9 30.2 44.4C30.9 42.1 31.4 40.3 31.9 39.1Z" fill="url(#awcRibbon)"/>' +
        '<path d="M33.5 38.2C34.9 40.3 35.8 41.9 36.4 43.6L34.4 42.9 33.8 44.4C33.1 42.1 32.6 40.3 32.1 39.1Z" fill="url(#awcRibbon)"/>' +
        // 结心：小鼓形收束 + 暗红折痕
        '<ellipse cx="32" cy="36.3" rx="2.7" ry="2.9" fill="url(#awcRibbon)"/>' +
        '<path d="M32 34.1v4.4" stroke="#7d1710" stroke-opacity="0.6" stroke-width="0.9" stroke-linecap="round"/>' +
        // 飘带高光：双环上缘细亮线
        '<path d="M19.8 33.6C21.8 31.6 24 30.6 26.2 30.6" fill="none" stroke="#ffd9cf" stroke-opacity="0.5" stroke-width="1.1" stroke-linecap="round"/>' +
        '<path d="M44.2 33.6C42.2 31.6 40 30.6 37.8 30.6" fill="none" stroke="#ffd9cf" stroke-opacity="0.5" stroke-width="1.1" stroke-linecap="round"/>' +
        // 杯身高光弧 + 右上星芒点缀
        '<path d="M19 12c0 8 2.5 12.5 7 15" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M46.5 13.5l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="#fff8d9" opacity="0.9"/>' +
        '</svg>';

    // 逐个处理触发器：注入金杯 SVG（防重复）+ 绑定点击派发合成 V 键
    document.querySelectorAll('.achWallTrigger').forEach(el => {
        // 防重复注入守卫：Wave1 期页面仍有内联 SVG 副本，已有则跳过，不能双份
        if (!el.querySelector('svg.aw-cup')) {
            el.insertAdjacentHTML('afterbegin', CUP_SVG);
        }
        // 点击即派发合成按键事件
        el.addEventListener('click', () => {
            // 合成键与真实按键同构：code/key 取 V 键值，bubbles 冒泡至 window，
            // 使监听在 document 或 window 上的游戏均能响应
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true }));
            // 立即补发同 code 的 keyup：只发 keydown 会使键帽高亮 .pressed 永久残留
            document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', key: 'v', bubbles: true }));
        });
    });
}());
