/* ============================================================================
 * 像素街机厅 · 共享进度快照层 snap-common.js
 * ----------------------------------------------------------------------------
 * 全站七游戏「进度镜像快照」骨架的唯一实现（由各游戏 js 内的七份同构骨架下沉而来）：
 *   存取管线 —— 进行中保存（build 构建纯数据快照） / 非进行中清除 / 恢复时
 *              loadJSON → validate 校验 → apply 应用，任一步失败或抛错一律
 *              清除快照并按无存档处理，绝不因脏数据抛错
 *   触发接线 —— bindAutoSave 统一入口（全站七游戏）：pagehide 页面卸载兜底 +
 *              父页 arcade:save 消息（关闭 iframe 覆盖层前下发）双注册，
 *              统一经 Arcade 安全收口
 *   失焦接线 —— blur + visibilitychange 双通道注册（切窗/切后台共用同一清理函数）
 *
 * 分层：依赖 arcade-common.js（Arcade 安全存储 + onTrustedMessage 来源守卫 + MSG 常量），
 *       位于业务 js 之前加载（加载序由 tests/check.py 检查项 3 守护）。
 *       快照字段与校验规则、恢复后的落点（停在暂停遮罩或直接进对局）、暂停与
 *       BGM 策略均归各游戏所有——本库只收编与具体游戏无关的机械骨架。
 *
 * 挂载到 window：与 ach-common.js / fx.js 导出风格一致，各游戏直接调用
 * Snap.create / Snap.bindAutoSave / Snap.bindPageHide / Snap.bindFocusLoss。
 * ==========================================================================*/

(function () {
    'use strict';

    /* ---------------------------- 存取管线 ---------------------------- */

    /**
     * 创建一款游戏的进度快照管线（每游戏一实例；保存/清除/恢复的唯一出入口）。
     * 保存语义：canSave() 为真 → 构建 build() 快照经 Arcade.saveJSON 落盘（存储
     * 不可用时静默放弃，不影响游戏）；为假 → 清除快照（快照只服务于未打完的局）。
     * 恢复语义：Arcade.loadJSON 读档（键缺失/JSON 损坏/存储不可用统一返回 null，
     * 直接按无存档处理）→ validate(snap) 字段校验 → apply(snap) 覆盖游戏状态；
     * 任一步返回 false 或抛出异常（脏数据/组装意外）都清除快照并返回 false，
     * 调用方回退默认新开局流程，绝不因脏数据抛错。
     * @param {{
     *   key: string,
     *   canSave: Function,
     *   build: Function,
     *   validate: Function,
     *   apply: Function
     * }} opts 管线选项：key 存档键（arcade_save_*）/ canSave 是否处于可保存状态
     *   （进行中或暂停中，含游戏自有守卫如非死亡演出）/ build 组装纯数据快照
     *   （首字段固定版本号 v，不含函数与 DOM 引用）/ validate 逐字段校验（返回
     *   false 即弃档）/ apply 覆盖游戏核心状态（返回 false 或抛错即弃档）
     * @returns {{save: Function, restore: Function, clear: Function}}
     *   管线 API：save 保存或清除快照 / restore 恢复（返回是否成功）/ clear 显式清除
     */
    function create(opts) {
        if (!opts || !opts.key || !opts.canSave || !opts.build || !opts.validate || !opts.apply) {
            throw new Error('Snap.create 参数缺失（key/canSave/build/validate/apply 必传）');
        }

        /**
         * 保存当前局进度镜像：进行中写入，非进行中清除（游戏结束/未开始不留快照）。
         * 整体 try/catch 静默容错：快照组装意外（脏状态）与存储异常（隐私模式 /
         * 配额满）都不中断游戏流程，与原各游戏内联实现的兜底语义一致
         */
        function save() {
            try {
                if (opts.canSave()) {
                    Arcade.saveJSON(opts.key, opts.build()); // 存储不可用时静默放弃，不影响游戏
                } else {
                    Arcade.removeRaw(opts.key); // 存储不可用时静默
                }
            } catch (e) { /* 快照组装异常：静默跳过，不影响游戏 */ }
        }

        /**
         * 恢复上次进度：读档 → 校验 → 应用，失败一律清档并返回 false
         * @returns {boolean} 快照合法并已应用返回 true；无快照或快照非法返回 false
         */
        function restore() {
            try {
                const snap = Arcade.loadJSON(opts.key); // 键缺失 / JSON 损坏 / 存储不可用统一返回 null
                if (!snap) return false; // 无存档或已损坏：按新开局处理，无需清理
                // 校验或应用失败（含抛错）：弃用并清除，调用方走新开局
                if (!opts.validate(snap) || !opts.apply(snap)) {
                    Arcade.removeRaw(opts.key);
                    return false;
                }
                return true;
            } catch (e) {
                // 任何异常（校验辅助抛错 / 组装意外）：清除可疑存档并按无存档处理
                Arcade.removeRaw(opts.key); // 存储不可用时静默
                return false;
            }
        }

        /**
         * 显式清除快照（游戏结束 / 放弃续玩时调用；存储不可用时静默）
         */
        function clear() {
            Arcade.removeRaw(opts.key);
        }

        return { save: save, restore: restore, clear: clear };
    }

    /* ---------------------------- 触发接线 ---------------------------- */

    /**
     * 接线页面卸载兜底：关闭标签页 / 刷新 / 父页移除 iframe 均触发 pagehide，
     * 保存（进行中）或清除（非进行中）快照。保留导出：作为 bindAutoSave 的
     * 内部实现（单独调用仅限无需 SAVE 消息接线的特殊场景）。
     * @param {{save: Function}} pipe Snap.create 产出的管线实例
     * @returns {{destroy: Function}} 绑定句柄：destroy() 移除 pagehide 监听
     *   （既有调用方不受影响——不调用 destroy 时行为与旧版完全一致）
     */
    function bindPageHide(pipe) {
        const onHide = () => pipe.save();
        window.addEventListener('pagehide', onHide);
        return {
            /** 解除绑定：移除注册的 pagehide 监听（页面销毁/重建管线时调用，防重复绑定重复保存） */
            destroy: function () { window.removeEventListener('pagehide', onHide); }
        };
    }

    /**
     * 接线标准快照触发（全站七游戏统一 SAVE 接线入口）：页面卸载兜底 + 父页
     * arcade:save 消息（关闭 iframe 覆盖层前下发）双注册一体完成。还需处理
     * arcade:fs 等复合消息的游戏保留各自既有 Arcade.onTrustedMessage 回调
     * （FS 音效等副作用），SAVE 消息处理一律单点化收口于本函数
     * （消息来源守卫统一在 onTrustedMessage 收口）。
     * 保存完成后向父页回发 arcade:saved 存档回执（ACK）：大厅侧摘除 iframe 前
     * 等待该回执，消除"关机动画 0.55s 时间窗赌子页已写完"的竞态；子页主线程
     * 卡顿导致回执迟到时，父页按超时兜底照常摘层（pagehide 兜底仍在）
     * @param {{save: Function}} pipe Snap.create 产出的管线实例
     * @returns {{destroy: Function}} 绑定句柄：destroy() 解除双注册——移除 pagehide
     *   监听并废弃 SAVE 消息响应（既有调用方不受影响——不调用 destroy 时行为与旧版完全一致）
     */
    function bindAutoSave(pipe) {
        const pageHide = bindPageHide(pipe);
        // 消息监听置废标志：Arcade.onTrustedMessage 注册的是匿名守卫监听且未提供移除
        // API（守卫收口属 arcade-common.js 的职责面，本库不越界代管），解绑退而求其次——
        // destroy 后回调短路空转，监听器虽在但不再响应任何消息，效果等同解绑
        let dead = false;
        Arcade.onTrustedMessage((e) => {
            if (dead) return; // 已解绑：短路空转，不再保存/回执
            if (e.data && e.data.type === Arcade.MSG.SAVE) {
                pipe.save();
                // 存档回执（ACK）：快照已落盘（保存/清除分支均算），父页收到后才摘除 iframe
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: Arcade.MSG.SAVED }, Arcade.MSG_TARGET);
                    }
                } catch (err) { /* 回执失败不影响存档本身，父页按超时兜底 */ }
            }
        });
        return {
            /** 解除绑定：废弃 SAVE 消息响应并移除 pagehide 兜底（页面销毁/重建管线时调用） */
            destroy: function () {
                dead = true;
                pageHide.destroy();
            }
        };
    }

    /* ---------------------------- 失焦接线 ---------------------------- */

    /**
     * 接线失焦/切后台双通道：blur 与 visibilitychange（仅 hidden 时）共用同一
     * 清理函数（visibilitychange 兜底移动端切应用不触发 blur 的场景；双触发由
     * 游戏清理函数内部的暂停守卫天然幂等）。清理内容（手势/按键/连发状态）与
     * 自动暂停守卫由游戏回调自行处置，本库只收编双通道注册。
     * @param {Function} handler 失焦清理函数（游戏具名 handleFocusLoss）
     * @returns {{destroy: Function}} 绑定句柄：destroy() 移除 blur 与
     *   visibilitychange 双通道监听（既有调用方不受影响——不调用 destroy 时行为与旧版完全一致）
     */
    function bindFocusLoss(handler) {
        const onHidden = () => { if (document.hidden) handler(); };
        window.addEventListener('blur', handler);
        document.addEventListener('visibilitychange', onHidden);
        return {
            /** 解除绑定：移除 blur 与 visibilitychange 双通道监听（页面销毁/重建引擎时调用） */
            destroy: function () {
                window.removeEventListener('blur', handler);
                document.removeEventListener('visibilitychange', onHidden);
            }
        };
    }

    /* ---------------------------- 导出 ---------------------------- */

    window.Snap = { create: create, bindPageHide: bindPageHide, bindAutoSave: bindAutoSave, bindFocusLoss: bindFocusLoss };
})();
