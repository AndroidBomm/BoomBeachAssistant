/**
 * 弱网控制模块 - 按 UID 定向断网（自动区分国服 / 国际服）
 *
 * ⚠️⚠️ 本模块的两个血泪教训（实测于雷电模拟器 + AutoGOD，别踩）：
 *
 *  1. **绝对不要调 $root.getPermit()**
 *     实测：调完之后 $root.exeRootShellSync() 和 $root.exeRootShell() 全部失效——
 *     回调不触发、同步调用永久卡死，无报错、无异常，AutoGOD 进程还活着。
 *     排查了很久。改用 $root.hasPermit() 查询即可。
 *
 *  2. **一旦调用过异步 $root.exeRootShell / getPermit，同步 $root.exeRootShellSync 就会卡死**
 *     所以本模块**统一只用异步 $root.exeRootShell + 回调**，和项目其它模块
 *     （lockcloud.js / accountManager.js）的做法保持一致。
 *     注意：异步回调在"没有界面的纯脚本环境"（例如 adb 广播 runJs 跑测试脚本）里
 *     不会触发，但在真实 App 里（UI 点击 / $engine.run 启动的脚本）正常——
 *     这是本项目所有既有模块已经在用的通路。
 *
 * 其它设计要点：
 *   - 用 iptables 的 owner 匹配，只断"游戏这个 App"的网，模拟器和调试通道不受影响
 *   - 默认只丢 TCP、UDP 放行（心跳/在线状态可能走 UDP，全丢反而更快被发现）
 *   - 【绝对不做】svc wifi disable / iptables -F
 *     · 模拟器的 wlan0 是虚拟网卡，关掉就再也连不回来（会卡死）
 *     · iptables -F 会把安卓自带的 bw_OUTPUT / fw_OUTPUT 等规则一起清掉
 *   - UID 一律运行时解析，不写死（换设备/重装会变，且国服国际服是两个包）
 *
 * 包名 / UID（本机雷电实测）：
 *   国服   com.tencent.tmgp.supercell.boombeach   UID 10055
 *   国际服 com.supercell.boombeach                UID 10065
 *
 * @module netControl
 */

const TAG = "[弱网] ";

// 两个服的包名（与 accountManager.getGamePackageName() 保持一致）
const PKG_CN = "com.tencent.tmgp.supercell.boombeach";   // 国服
const PKG_INTL = "com.supercell.boombeach";              // 国际服

// 断网硬上限（抄参考脚本的 17 分钟；到点自动恢复，防止把游戏一直挂着）
const DEFAULT_MAX_HOLD_MS = 17 * 60 * 1000;

// 单条 root 命令的超时（毫秒）。异步回调不来也不能永远等
const CMD_TIMEOUT_MS = 12000;

// 模块内部状态
let _state = {
    on: false,
    pkg: "",
    uid: 0,
    mode: "",
    startedAt: 0,
    maxHoldMs: DEFAULT_MAX_HOLD_MS,
    timer: null,
    lastError: ""
};


/* ==================== 底层：root 命令（异步 + 超时） ==================== */

/**
 * 检查 root 权限是否已拿到（只查询，绝不申请）
 * @returns {boolean}
 */
function hasRoot() {
    try {
        if (typeof $root.hasPermit === "function") return !!$root.hasPermit();
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * 异步执行一条 root 命令，自动处理 namespace 隔离。
 *
 * 回调：cb(err, stdoutText)
 *   - 命令正常结束 -> cb(null, 输出)
 *   - 超时/出错     -> cb(Error, "")
 *
 * @param {string} cmd   shell 命令（可含多条语句、循环、管道）
 * @param {function} cb  回调 (err, out)
 */
function _sh(cmd, cb) {
    cb = cb || function () { };

    if (!hasRoot()) {
        cb(new Error("没有 root 权限"), "");
        return;
    }

    // 跨应用/系统操作要加 nsenter 前缀；有些设备没有 nsenter，用 || 兜底
    let escaped = String(cmd).replace(/'/g, "'\\''");
    let wrapped = "sh -c '" + escaped + "'";
    let full = "nsenter -t 1 -m -- " + wrapped + " 2>/dev/null || " + wrapped;

    let done = false;
    let buf = [];

    function finish(err, out) {
        if (done) return;
        done = true;
        cb(err, out);
    }

    // 超时保护：回调不来也要往下走，免得界面卡住
    let to = setTimeout(function () {
        $log.w(TAG + "root 命令超时: " + cmd);
        finish(new Error("root 命令超时"), buf.join("\n"));
    }, CMD_TIMEOUT_MS);

    try {
        $root.exeRootShell(full,
            function (line) { buf.push(line); },
            function (err) {
                clearTimeout(to);
                $log.e(TAG + "root 命令出错: " + err + " | cmd=" + cmd);
                finish(new Error(String(err)), buf.join("\n"));
            },
            function (code) {
                clearTimeout(to);
                let out = buf.join("\n");
                if (code !== 0 && out === "") {
                    finish(new Error("退出码 " + code), out);
                } else {
                    finish(null, out);
                }
            }
        );
    } catch (e) {
        clearTimeout(to);
        finish(e, "");
    }
}

/**
 * 依次执行多条 root 命令，全部跑完再回调。
 * @param {string[]} cmds
 * @param {function} cb (err, outs[])
 */
function _shSeq(cmds, cb) {
    let outs = [];
    let i = 0;
    function next() {
        if (i >= cmds.length) { cb(null, outs); return; }
        let c = cmds[i++];
        _sh(c, function (err, out) {
            outs.push(out);
            if (err) { cb(err, outs); return; }
            next();
        });
    }
    next();
}


/* ==================== 包名 / UID 解析 ==================== */

/**
 * 把「国服/国际服」的说法统一成包名。
 * 支持：0/"0"/"国服" -> 国服包；1/"1"/"国际服" -> 国际服包；
 *      完整包名 -> 原样；空/不认识 -> ""（报错，不猜）
 * @param {number|string} serverType
 * @returns {string} 包名，识别不了返回 ""
 */
function resolvePackage(serverType) {
    if (serverType === null || serverType === undefined) return "";

    if (typeof serverType === "number") {
        if (serverType === 0) return PKG_CN;
        if (serverType === 1) return PKG_INTL;
        return "";
    }

    let s = String(serverType).trim();
    if (s === "") return "";
    if (s === PKG_CN || s === PKG_INTL) return s;
    if (s.indexOf("com.") === 0) return s;
    if (s === "0" || s.indexOf("国服") >= 0) return PKG_CN;
    if (s === "1" || s.indexOf("国际服") >= 0) return PKG_INTL;
    return "";
}

/**
 * 运行时解析包名对应的 UID（不写死，换设备/重装都不会错）
 * 回调：cb(uid)，解析不出来给 0
 * @param {string} pkg
 * @param {function} cb (uid)
 */
function resolveUid(pkg, cb) {
    cb = cb || function () { };
    if (!pkg) { cb(0); return; }

    // 路子 1：dumpsys
    _sh("dumpsys package " + pkg + " | grep -m1 'userId='", function (err, out) {
        let m = String(out || "").match(/userId=(\d+)/);
        if (m) { cb(parseInt(m[1], 10)); return; }

        // 路子 2：packages.list
        _sh("grep -m1 '^" + pkg + " ' /data/system/packages.list", function (e2, out2) {
            let parts = String(out2 || "").trim().split(/\s+/);
            let uid = parseInt(parts[1], 10);
            cb((!isNaN(uid) && uid > 0) ? uid : 0);
        });
    });
}

/** 包名对应的中文名 */
function pkgLabel(pkg) {
    if (pkg === PKG_CN) return "国服";
    if (pkg === PKG_INTL) return "国际服";
    return pkg || "未指定";
}


/* ==================== iptables 规则拼装 ==================== */

/**
 * 生成某个 UID 所有"可能存在"的规则尾巴（关断网时统统清掉，避免残留）
 * @param {number} uid
 * @returns {string[]}
 */
function _allSpecs(uid) {
    let owner = "-m owner --uid-owner " + uid;
    return [
        owner + " -p tcp -j DROP",                            // 只丢 TCP（默认）
        owner + " -j DROP",                                   // TCP+UDP 全丢
        owner + " -p tcp -j REJECT --reject-with tcp-reset"   // 主动送 RST（逼重连框用）
    ];
}

/**
 * 按模式取要插入的那一条规则尾巴
 * @param {number} uid
 * @param {string} mode tcp | all | reject
 */
function _specFor(uid, mode) {
    let owner = "-m owner --uid-owner " + uid;
    if (mode === "all") return owner + " -j DROP";
    if (mode === "reject") return owner + " -p tcp -j REJECT --reject-with tcp-reset";
    return owner + " -p tcp -j DROP";
}

/**
 * 删掉某一条规则的所有副本（精确删，绝不碰别的规则）
 * @param {string} spec
 * @param {function} cb
 */
function _removeSpec(spec, cb) {
    _sh("while iptables -w -C OUTPUT " + spec + " 2>/dev/null; do " +
        "iptables -w -D OUTPUT " + spec + " 2>/dev/null; done", function (e, o) {
        cb && cb(e, o);
    });
}


/* ==================== 开关 ==================== */

/**
 * 开始断网
 *
 * @param {object} opts
 *   - serverType : 0/1 或 "国服"/"国际服" 或完整包名（必填）
 *   - mode       : "tcp"(默认) | "all" | "reject"
 *   - maxHoldMs  : 硬上限，默认 17 分钟，到点自动恢复
 * @param {function} callback (err, info)
 */
function enable(opts, callback) {
    opts = opts || {};
    callback = callback || function () { };

    let pkg = resolvePackage(opts.serverType !== undefined ? opts.serverType : opts.pkg);
    if (!pkg) {
        callback(new Error("没认出是国服还是国际服，请先在首页选好版本"));
        return;
    }
    if (!hasRoot()) {
        callback(new Error("没有 root 权限，请先在首页点「Root」授权"));
        return;
    }

    let mode = opts.mode || "tcp";
    let maxHoldMs = opts.maxHoldMs || DEFAULT_MAX_HOLD_MS;

    resolveUid(pkg, function (uid) {
        if (!uid) {
            callback(new Error("解析 UID 失败：" + pkg + "（游戏没装？）"));
            return;
        }

        // 先把旧 UID 和我们自己可能留下的残留统统清掉，保证同一时刻只有一套
        let toClean = [];
        if (_state.uid && _state.uid !== uid) toClean = toClean.concat(_allSpecs(_state.uid));
        toClean = toClean.concat(_allSpecs(uid));

        let cleanCmds = toClean.map(function (spec) {
            return "while iptables -w -C OUTPUT " + spec + " 2>/dev/null; do " +
                   "iptables -w -D OUTPUT " + spec + " 2>/dev/null; done";
        });

        _shSeq(cleanCmds, function () {
            let spec = _specFor(uid, mode);
            _sh("iptables -w -I OUTPUT 1 " + spec, function (err, out) {
                if (err) {
                    $log.e(TAG + "插入规则失败: " + (err.message || err) + " | " + out);
                    callback(new Error("断网规则没生效：" + (err.message || err)));
                    return;
                }
                // 复核一下确实插进去了
                _sh("iptables -w -S OUTPUT | grep -c 'uid-owner " + uid + "'", function (e2, out2) {
                    let n = parseInt(String(out2 || "").trim(), 10);
                    if (isNaN(n)) n = 0;
                    if (n <= 0) {
                        callback(new Error("规则写入后没查到，可能失败"));
                        return;
                    }

                    _clearTimer();
                    _state.on = true;
                    _state.pkg = pkg;
                    _state.uid = uid;
                    _state.mode = mode;
                    _state.startedAt = Date.now();
                    _state.maxHoldMs = maxHoldMs;
                    _state.lastError = "";

                    if (maxHoldMs > 0) {
                        _state.timer = setTimeout(function () {
                            $log.w(TAG + "到达硬上限，自动恢复网络");
                            disable(function () { });
                        }, maxHoldMs);
                    }

                    let label = pkgLabel(pkg);
                    $log.i(TAG + "已断网 -> " + label + " (UID " + uid + ", 模式 " +
                           mode + ", 规则 " + n + " 条)");
                    callback(null, { pkg: pkg, uid: uid, label: label, mode: mode, maxHoldMs: maxHoldMs });
                });
            });
        });
    });
}

/**
 * 恢复网络（只删本模块加过的规则，不碰任何系统规则）
 * @param {function} callback (err, info)
 */
function disable(callback) {
    callback = callback || function () { };
    _clearTimer();

    let uid = _state.uid;
    if (!uid) {
        _state.on = false;
        callback(null, { leftOver: 0, note: "本来就没开" });
        return;
    }

    let cmds = _allSpecs(uid).map(function (spec) {
        return "while iptables -w -C OUTPUT " + spec + " 2>/dev/null; do " +
               "iptables -w -D OUTPUT " + spec + " 2>/dev/null; done";
    });

    _shSeq(cmds, function () {
        _sh("iptables -w -S OUTPUT | grep -c 'uid-owner " + uid + "'", function (e, out) {
            let left = parseInt(String(out || "").trim(), 10);
            if (isNaN(left)) left = 0;

            let label = pkgLabel(_state.pkg);
            _state.on = false;
            _state.pkg = "";
            _state.uid = 0;
            _state.mode = "";
            _state.startedAt = 0;

            if (left > 0) $log.w(TAG + "恢复后还剩 " + left + " 条规则（UID " + uid + "）");
            else $log.i(TAG + "已恢复网络" + (label ? "（原目标 " + label + "）" : ""));

            callback(null, { leftOver: left });
        });
    });
}

/**
 * 兜底清理：把国服/国际服两个 UID 的规则都清掉。
 * 脚本/界面退出时调用，保证绝不留下断网状态。
 * @param {function} callback
 */
function forceClear(callback) {
    callback = callback || function () { };
    _clearTimer();

    // 无论当前状态如何，两个包都试着清一遍（首次可能 UID 未知，先解析）
    let pkgs = [_state.pkg || PKG_CN, PKG_CN, PKG_INTL];
    let uniq = [];
    pkgs.forEach(function (p) { if (p && uniq.indexOf(p) < 0) uniq.push(p); });

    let cleaned = [];
    let i = 0;
    function step() {
        if (i >= uniq.length) {
            _state.on = false;
            _state.pkg = "";
            _state.uid = 0;
            _state.mode = "";
            _state.startedAt = 0;
            $log.i(TAG + "兜底清理完成: " + JSON.stringify(cleaned));
            callback(null, { cleaned: cleaned });
            return;
        }
        let p = uniq[i++];
        resolveUid(p, function (uid) {
            if (!uid) { step(); return; }
            let cmds = _allSpecs(uid).map(function (spec) {
                return "while iptables -w -C OUTPUT " + spec + " 2>/dev/null; do " +
                       "iptables -w -D OUTPUT " + spec + " 2>/dev/null; done";
            });
            _shSeq(cmds, function () {
                cleaned.push({ pkg: p, uid: uid });
                step();
            });
        });
    }
    step();
}

function _clearTimer() {
    if (_state.timer) {
        clearTimeout(_state.timer);
        _state.timer = null;
    }
}


/* ==================== 查询（纯 JS，不做任何 root 调用，可被计时器高频调用） ==================== */

function isOn() { return !!_state.on; }
function heldMs() { return _state.on ? (Date.now() - _state.startedAt) : 0; }
function heldText() {
    let s = Math.floor(heldMs() / 1000);
    let mm = Math.floor(s / 60);
    let ss = s % 60;
    return (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
}
function status() {
    return {
        on: _state.on,
        pkg: _state.pkg,
        uid: _state.uid,
        label: pkgLabel(_state.pkg),
        mode: _state.mode,
        heldMs: heldMs(),
        heldText: heldText(),
        maxHoldMs: _state.maxHoldMs,
        lastError: _state.lastError
    };
}
function activePkg() { return _state.pkg; }
function activeUid() { return _state.uid; }

/**
 * 诊断：把当前 iptables 状态、两个包的情况、UID 都摸一遍（只读，不改状态）
 * @param {function} callback (err, info)
 */
function diag(callback) {
    callback = callback || function () { };
    let info = { packages: [], ourRules: [], systemChains: [], state: status(), hasRoot: hasRoot() };

    let pkgs = [PKG_CN, PKG_INTL];
    let i = 0;
    function stepPkg() {
        if (i >= pkgs.length) { stepRules(); return; }
        let pkg = pkgs[i++];
        _sh("pm list packages " + pkg, function (e, out) {
            let installed = String(out || "").trim().indexOf(pkg) >= 0;
            resolveUid(pkg, function (uid) {
                info.packages.push({ pkg: pkg, label: pkgLabel(pkg), installed: installed, uid: uid });
                stepPkg();
            });
        });
    }
    function stepRules() {
        _sh("iptables -w -S OUTPUT | grep 'uid-owner'", function (e, out) {
            let t = String(out || "").trim();
            info.ourRules = t === "" ? [] : t.split("\n");
            _sh("iptables -w -S | grep '^-N bw_' ; iptables -w -S | grep '^-N fw_'", function (e2, out2) {
                let t2 = String(out2 || "").trim();
                info.systemChains = t2 === "" ? [] : t2.split("\n");
                callback(null, info);
            });
        });
    }
    stepPkg();
}


/* ==================== 导出 ==================== */

let net = {
    PKG_CN: PKG_CN,
    PKG_INTL: PKG_INTL,
    DEFAULT_MAX_HOLD_MS: DEFAULT_MAX_HOLD_MS,

    resolvePackage: resolvePackage,
    resolveUid: resolveUid,
    pkgLabel: pkgLabel,
    hasRoot: hasRoot,

    enable: enable,
    disable: disable,
    forceClear: forceClear,

    isOn: isOn,
    heldMs: heldMs,
    heldText: heldText,
    status: status,
    activePkg: activePkg,
    activeUid: activeUid,
    diag: diag
};
net;
