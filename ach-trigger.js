/* ======================================================================
 * 成就墙 · 相片墙触发器接线（仅游戏页引入；大厅由 index.js 直接绑定按钮）
 * 点击相片墙触发器 = 按下全站统一开墙键 V：向 document 派发合成 KeyV
 * keydown，复用各游戏既有的 V 键处理分支（开合切换、暂停态放行等行为
 * 完全一致），游戏逻辑零改动。
 * 依赖：宿主页面存在 .achWallTrigger 元素（无则静默跳过不影响其余功能）
 * ==================================================================== */
(function () {
    'use strict';
    // 逐个绑定触发器：点击即派发合成按键事件
    document.querySelectorAll('.achWallTrigger').forEach(el => {
        el.addEventListener('click', () => {
            // 合成键与真实按键同构：code/key 取 V 键值，bubbles 冒泡至 window，
            // 使监听在 document 或 window 上的游戏均能响应
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true }));
        });
    });
}());
