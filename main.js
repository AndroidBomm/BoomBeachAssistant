let ui = $ui.layout("ui/main.xml");

//[组件]
let appbar = ui.id("appbar"); //应用条
let viewpager = ui.id("viewpager"); //滑动界面
let tabs = ui.id("tabs"); //标签栏

//[首页控件]
//权限设置
let autoService = ui.id("autoService"); //无障碍文字
let rootPermission = ui.id("rootPermission"); //Root文字
let autoServiceDot = ui.id("autoServiceDot"); //无障碍圆点
let rootPermissionDot = ui.id("rootPermissionDot"); //Root圆点

//[账号信息控件]
let findAccountArchive = ui.id("findAccountArchive"); //生成存档按钮
let AccountList = ui.id("AccountList"); //账号列表
let btnArchiveHelp = ui.id("btnArchiveHelp"); //存档说明
let btnExportArchive = ui.id("btnExportArchive"); //导出存档
let btnImportArchive = ui.id("btnImportArchive"); //读取存档
let btnClearList = ui.id("btnClearList"); //清空列表
let btnEmailLogin = ui.id("btnEmailLogin"); //邮箱登录
// 上号方式状态变量
let currentAccountMethod = "archive"; // 默认使用存档上号方式: "archive" 或 "text"

// 初始化标志
let isInitializing = true; // 标记是否处于初始化阶段

//锁云功能
let lockCloudStatus = ui.id("lockCloudStatus"); //锁云状态
let serverType = ui.id("serverType"); //版本选择
let btnUnlockCloud = ui.id("btnUnlockCloud"); //卸载锁云按钮
let btnLockCloud = ui.id("btnLockCloud"); //执行锁云按钮

//[更多页控件]
let weakDot = ui.id("weakDot");           //弱网状态圆点
let weakStatus = ui.id("weakStatus");     //弱网状态文字
let weakTarget = ui.id("weakTarget");     //弱网当前目标服务器
let weakMode = ui.id("weakMode");         //弱网模式说明
let weakHint = ui.id("weakHint");         //弱网提示
let btnWeakOn = ui.id("btnWeakOn");       //开启弱网按钮
let btnWeakRetry = ui.id("btnWeakRetry"); //断网重连按钮
let btnWeakOff = ui.id("btnWeakOff");     //立即恢复按钮

//参数配置

let lockcloud = require("./modules/lockcloud.js");
let configManager = require("./modules/configManager.js");
let netControl = require("./modules/netControl.js");
// let accountManager = require("./modules/accountManager.js");





//锁云功能按钮 - 实际调用锁云模块函数
if (btnUnlockCloud) {
    btnUnlockCloud.click((view) => {
        $tip.show("卸载锁云", "此操作将会卸载锁云，请慎重", () => {
            // 获取当前选择的服务器类型
            let serverTypeText = ui.id("serverType").getCheckedText();

            // 使用统一的转换函数
            let serverType = convertServerTypeToCode(serverTypeText);

            // 调用锁云模块的卸载函数（使用回调模式）
            lockcloud.performUnlockCloud(serverType, function (result) {
                if (result.success) {
                    toast("卸载锁云成功: " + result.message);
                    let serverTypeText = (serverType === 0) ? "国服" : "国际服";
                    updateLockCloudStatus(serverTypeText, result.locked || false);
                } else {
                    toast("卸载锁云失败: " + result.message);
                }
            });
        });
    });
}

if (btnLockCloud) {
    btnLockCloud.click((view) => {
        try {
            // 获取当前选择的服务器类型
            let serverTypeText = ui.id("serverType").getCheckedText();

            // 增强的错误检查
            if (!serverTypeText || serverTypeText.trim() === "") {
                serverTypeText = "国际服"; // 使用默认值
            }

            // 使用统一的转换函数
            let serverType = convertServerTypeToCode(serverTypeText);

            // 检查权限
            if (!$root.hasPermit()) {
                toast("需要Root权限才能执行锁云");
                return;
            }

            // 调用锁云模块的执行函数（使用回调模式）
            lockcloud.performLockCloud(serverType, function (result) {
                // 移除UI线程包装，直接执行UI操作
                if (result.success) {
                    toast("锁云成功: " + result.message);
                    // 更新状态显示 - 传入服务器类型字符串和实际锁定状态
                    let serverTypeText = (serverType === 0) ? "国服" : "国际服";
                    updateLockCloudStatus(serverTypeText, result.locked || true);
                } else {
                    toast("锁云失败: " + result.message);
                }
            });
        } catch (e) {
            $log.e("执行锁云出错: " + e.message);
            toast("执行锁云出错: " + e.message);
        }
    });
}

// 启动/关闭按钮
let btnStart = ui.id("btnStart");
let btnStop = ui.id("btnStop");

// ===== 运行功能选择（上下两行卡片）=====
// 每一行是一块可点击的 <card>，选中态靠：
//   行底色 setTint + 图标 setTint + 标题 setColor + 右侧「当前」文字
// （<linear> 没有运行时改背景色的方法，所以行必须用 <card>；见 ui/layout-card.md）
let _runFuncNames = ["查雕像", "自动声纳"];
let _runFuncScripts = ["chaDiaoXiang", "autoSonar"];
let _runFuncIndex = 0;
// 初始化期间不写配置（避免一启动就被默认值覆盖掉上次的选择）
let _runFuncReady = false;

// 界面元素（按 0=查雕像 1=自动声纳 排列）
let _runRows = [ui.id("rowChaDiao"), ui.id("rowSonar")];
let _runBars = [ui.id("barChaDiao"), ui.id("barSonar")];
let _runIcos = [ui.id("icoChaDiao"), ui.id("icoSonar")];
let _runTtls = [ui.id("ttlChaDiao"), ui.id("ttlSonar")];
let _runCurs = [ui.id("curChaDiao"), ui.id("curSonar")];

var RUN_COLOR_ON_BG = "#B2DFDB";   // 选中行底色
var RUN_COLOR_OFF_BG = "#FFFFFF";  // 未选中行底色
var RUN_COLOR_ON = "#00897B";      // 选中：色条/图标/标题/当前 的颜色
var RUN_COLOR_OFF_ICO = "#888888"; // 未选中：图标颜色
var RUN_COLOR_OFF_TTL = "#333333"; // 未选中：标题颜色

/**
 * 刷新两行的选中外观
 * @param {number} index - 选中的下标
 */
function paintRunFunc(index) {
    for (let i = 0; i < _runRows.length; i++) {
        let on = (i === index);
        // 行底色（card 的 setBg/setTint 实测在这套主题下不改变观感，
        // 保留调用以防换个主题/版本有效；真正起作用的是下面那条色条）
        try { if (_runRows[i]) { _runRows[i].setBg(on ? RUN_COLOR_ON_BG : RUN_COLOR_OFF_BG); } } catch (e) {}
        try { if (_runRows[i]) { _runRows[i].setTint(on ? RUN_COLOR_ON_BG : RUN_COLOR_OFF_BG); } } catch (e) {}
        // 左侧色条：setText 控制有无、setColor 控制颜色（都验证有效）
        // 未选中时直接清空文字，避免白色方块在白底上留痕
        try {
            if (_runBars[i]) {
                _runBars[i].setText(on ? "█" : "");
                _runBars[i].setColor(RUN_COLOR_ON);
            }
        } catch (e) {}
        try { if (_runIcos[i]) { _runIcos[i].setTint(on ? RUN_COLOR_ON : RUN_COLOR_OFF_ICO); } } catch (e) {}
        try { if (_runTtls[i]) { _runTtls[i].setColor(on ? RUN_COLOR_ON : RUN_COLOR_OFF_TTL); } } catch (e) {}
        try { if (_runCurs[i]) { _runCurs[i].setText(on ? "当前" : ""); } } catch (e) {}
    }
}

/**
 * 应用运行功能选择
 * @param {number} index - 0=查雕像 1=自动声纳
 * @param {boolean} save - 是否写入配置
 */
function applyRunFunc(index, save) {
    if (!(index >= 0) || index >= _runFuncNames.length) {
        index = 0;
    }
    _runFuncIndex = index;
    paintRunFunc(index);

    // 记住选择（仅在初始化完成后，且是用户真实切换时才写）
    if (save && _runFuncReady) {
        try {
            configManager.updateConfig("runFunction", _runFuncNames[index]);
        } catch (e) {
            $log.e("保存运行功能选择失败: " + e.message);
        }
    }
}

// 绑定点击（整行可点）
let _runRowFound = 0;
for (let i = 0; i < _runRows.length; i++) {
    if (!_runRows[i]) { continue; }
    _runRowFound++;
    (function (idx) {
        _runRows[idx].click(() => {
            if (_runFuncIndex === idx) { return; }   // 点当前项不重复写配置
            applyRunFunc(idx, true);
            $log.d("运行功能切换为: " + _runFuncNames[idx]);
        });
    })(i);
}

// 恢复上次选择（照抄 serverType 的做法）
let _savedRun = null;
try {
    _savedRun = configManager.getConfigItem("runFunction", null);
} catch (e) {
    $log.e("读取运行功能配置失败: " + e.message);
}
if (_savedRun) {
    let k = _runFuncNames.indexOf(_savedRun);
    // 兼容旧值：只要含"自动声纳"就认成第 1 项
    if (k < 0 && String(_savedRun).indexOf("自动声纳") >= 0) { k = 1; }
    if (k >= 0) {
        applyRunFunc(k, false);
        $log.d("已恢复上次的运行功能选择: " + _runFuncNames[k]);
    }
}

// 初始化完成。此后点击才会真正写配置
applyRunFunc(_runFuncIndex, false);
_runFuncReady = true;
if (_runRowFound === 0) {
    $log.e("运行功能的两行卡片都没找到，启动将默认走「查雕像」");
} else {
    $log.d("运行功能初始化完成，当前选择: " + _runFuncNames[_runFuncIndex] +
           "（找到 " + _runRowFound + " 行）");
}

if (btnStart) {
    btnStart.click(() => {
        try {
            let scriptName = _runFuncScripts[_runFuncIndex] || "chaDiaoXiang";
            $log.i("启动脚本: " + scriptName + "（运行功能: " + _runFuncNames[_runFuncIndex] + "）");
            // 用脚本引擎启动，可被 $engine.stopAll() 停止
            $engine.run("./scripts/" + scriptName + ".js");
        } catch (e) {
            $log.e("启动失败: " + e.message);
            toast("启动失败: " + e.message);
        }
    });
}
if (btnStop) {
    btnStop.click(() => {
        // 先关闭悬浮窗
        try { $floaty.closeAll(); } catch (e) {}
        toast("正在关闭所有任务...");
        $log.i("用户点击关闭，停止所有任务");

        // 🚨 关键修复：一定要 ui.finish() 结束本界面！
        // 之前只 stopAll 不 finish，Activity 留在栈里，每运行一次就多压一个界面，
        // 次数多了 AutoGOD 客户端会崩溃卡死。（ui.finish() 官方 API）
        try {
            ui.finish();
            $log.i("已调用 ui.finish() 结束界面");
        } catch (e) {
            $log.e("ui.finish() 失败: " + e.message);
        }

        // 停止所有线程（包括脚本线程）
        try { $thread.stopAll(); } catch(e) {}
        // 停止所有引擎任务
        try { $engine.stopAll(); } catch(e) {}
    });
}


//[工具函数]

/**
 * 将服务器类型字符串转换为数字代码
 * @param {string} serverTypeText - 服务器类型文本（"国服"或"国际服"）
 * @returns {number} - 0表示国服，1表示国际服
 */
function convertServerTypeToCode(serverTypeText) {
    if (!serverTypeText || serverTypeText.trim() === "") {
        return 1; // 默认国际服
    }

    // 标准化文本
    serverTypeText = serverTypeText.trim();

    // 使用更宽松的比较，处理可能的编码问题
    if (serverTypeText.includes("国服") || serverTypeText === "国服") {
        return 0;
    } else if (serverTypeText.includes("国际服") || serverTypeText === "国际服") {
        return 1;
    } else {
        return 1; // 默认国际服
    }
}

/**
 * 更新多号相关控件状态
 * @param {boolean} enabled - 是否启用多号功能
 */
function updateMultiAccountControls(enabled) {
    // 只在状态实际改变时记录日志
    if (this._lastMultiAccountState !== enabled) {
        $log.d("更新多号控件状态: " + (enabled ? "启用" : "禁用"));
        this._lastMultiAccountState = enabled;
    }

    // 控制按钮状态
    if (findAccountArchive) {
        findAccountArchive.enabled = enabled;
        findAccountArchive.alpha = enabled ? 1.0 : 0.5;
    }

    // 控制账号列表状态
    if (AccountList) {
        AccountList.enabled = enabled;
        AccountList.alpha = enabled ? 1.0 : 0.5;
    }

    // 更新上号方式二选一状态
    if (enabled) {
        updateAccountMethodState();
    }
}

/**
 * 更新上号方式二选一状态
 */
function updateAccountMethodState() {
    if (currentAccountMethod === "archive") {
        if (findAccountArchive) {
            findAccountArchive.alpha = 1.0;
        }
    } else {
        if (findAccountArchive) {
            findAccountArchive.alpha = 0.5;
        }
    }
}

// 生成存档按钮点击事件 - 国服弹窗，国际服自动命名
if (findAccountArchive) {
    findAccountArchive.click(() => {
        let cfg = configManager.loadConfig();
        let sv = cfg.serverType || "国际服";

        if (sv === "国服") {
            handleArchiveExport();
        } else {
            // 国际服：无需弹窗，从游戏目录读取账号名
            let accountManager = require("./modules/accountManager.js");
            accountManager.getAccountNameFromGame(function (name) {
                $log.d("国际服自动生成存档: " + name);
                accountManager.exportAccountArchiveJSON(name, function (success) {
                    if (success) {
                        toast("国际服存档生成成功: " + name);
                    } else {
                        toast("国际服存档生成失败");
                    }
                });
            });
        }
    });
}

    if (btnArchiveHelp) {
        btnArchiveHelp.click(() => {
            $tip.show("存档说明", "📤 生成存档：从当前游戏读取存档并保存\n📥 导出存档：将账号列表导出到 /sdcard/ 目录\n📂 读取存档：自动扫描 /sdcard/ 下的 .ls 文件导入账号\n📧 邮箱登录：删除游戏存档，用于切换账号\n\n💡 切换存档：点击列表中的「上号」按钮");
        });
    }
    if (btnExportArchive) {
        btnExportArchive.click(() => {
            var am = require("./modules/accountManager.js");
            var r = am.exportToLocalFile();
            if (r.success) {
                toast("导出成功: " + r.path);
            } else {
                toast("导出失败: " + r.msg);
            }
        });
    }
    if (btnImportArchive) {
        btnImportArchive.click(() => {
            // 自动扫描 /sdcard/ 下的 .ls 存档文件
            var am = require("./modules/accountManager.js");
            var r = am.autoImportFromSdcard();
            if (r.success) {
                toast("导入完成: 新增 " + r.added + ", 更新 " + r.updated + "\n来源: " + r.path);
                refreshAccountList();
            } else {
                toast("导入失败: " + r.msg);
            }
        });
    }

    // 清空列表按钮
    if (btnClearList) {
        btnClearList.click(() => {
            try {
                var am = require("./modules/accountManager.js");
                var data = { version: 1, accounts: [] };
                var jp = am._getAccountsJSONPath();
                if (jp) am._javaWriteFile(jp, JSON.stringify(data, null, 2));
                $log.i("列表已清空");
                refreshAccountList();
            } catch (e) {
                $log.e("清空列表失败: " + e.message);
            }
        });
    }

    // 邮箱登录按钮 - 仅限国际服
    if (btnEmailLogin) {
        btnEmailLogin.click(() => {
            // 判断服务类型：UI 控件优先，其次读配置
            var sv = "";
            try { sv = ui.id("serverType").getCheckedText() || ""; } catch (e) {}
            if (!sv || sv.indexOf("国际") < 0) {
                try {
                    var cfg = configManager.loadConfig();
                    sv = cfg.serverType || "";
                } catch (e) {}
            }
            if (sv.indexOf("国际") < 0) {
                toast("邮箱登录仅支持国际服");
                return;
            }
            $log.d("邮箱登录：关闭游戏 → 删除 storage → 启动");
            var pkg = "com.supercell.boombeach";
            $root.exeRootShell(`nsenter -t 1 -m am force-stop ${pkg} 2>/dev/null || am force-stop ${pkg}`,
                function (l) { $log.d("关闭游戏: " + l); },
                function (e) { $log.e("关闭游戏失败: " + e); },
                function () {
                    var path1 = "/data/user/0/" + pkg + "/shared_prefs/storage.xml";
                    var path2 = "/data/user/0/" + pkg + "/shared_prefs/storage_new.xml";
                    $root.exeRootShell(`nsenter -t 1 -m rm "${path1}" "${path2}" 2>/dev/null || rm "${path1}" "${path2}"`,
                        function (l) { $log.d("rm: " + l); },
                        function (e) { $log.e("删除文件失败: " + e); },
                        function (c) {
                            if (c === 0) {
                                $log.i("storage 文件已删除，启动游戏");
                                $app.run(pkg);
                            } else {
                                $log.e("删除文件失败，退出码: " + c);
                            }
                        }
                    );
                }
            );
        });
    }

    // 使用 bindHolder 绑定列表项事件和数据
    if (AccountList) {
        // bindHolder：绑定列表项事件和数据
        AccountList.bindHolder(function (itemUi, itemData, position) {
            // 手动设置数据
            let indexText = itemUi.id("accountIndex");
            let titleText = itemUi.id("accountTitle");
            if (indexText) {
                indexText.setText((position + 1) + ". ");
            }
            if (titleText) {
                titleText.setText(itemData.title);
            }

            // 缩小 Card 默认内边距（原生 MaterialCardView）
            try {
                var card = itemUi.id("cardRoot").getView();
                card.setContentPadding(8, 2, 8, 2);
                card.setCardElevation(0);
            } catch (e) {}

            // 辅助函数：原生按钮样式
            function styleButton(btnId, text, bgColor, padding) {
                try {
                    var btn = itemUi.id(btnId).getView();
                    btn.setText(text);
                    if (padding <= 4) btn.setTextSize(7);
                    else btn.setTextSize(8);
                    var $Color = android.graphics.Color;
                    var c = $Color.parseColor(bgColor);
                    btn.setTextColor($Color.parseColor("#FFFFFF"));
                    btn.setPadding(padding || 8, (padding <= 4 ? 3 : 4), padding || 8, (padding <= 4 ? 3 : 4));
                    // MaterialButton 背景色调 + 方形圆角
                    try {
                        var $CStateList = android.content.res.ColorStateList;
                        btn.setBackgroundTintList($CStateList.valueOf(c));
                    } catch (e2) { btn.setBackgroundColor(c); }
                    try { btn.setCornerRadius(4); } catch (e3) {}
                } catch (e) {
                    $log.w("按钮样式失败: " + btnId + " - " + e.message);
                }
            }

            var name = itemData.title;

            // 选择/取消选择账号（供批量多号任务使用）
            var isSkipped = itemData.skipAccount === true;
            styleButton("selectAccount", isSkipped ? "未选" : "已选", isSkipped ? "#9E9E9E" : "#FF9800", 8);
            itemUi.id("selectAccount").click(function () {
                try {
                    var am = require("./modules/accountManager.js");
                    var accounts = am.listAccounts();
                    var target = null;
                    for (var ai = 0; ai < accounts.length; ai++) {
                        if (accounts[ai].name === name) {
                            target = accounts[ai];
                            break;
                        }
                    }
                    if (!target) { toast("未找到账号: " + name); return; }
                    var newSkip = !target.skipAccount;
                    var data = am._loadData();
                    for (var di = 0; di < data.accounts.length; di++) {
                        if (data.accounts[di].name === name) {
                            data.accounts[di].skipAccount = newSkip;
                            break;
                        }
                    }
                    var jp = am._getAccountsJSONPath();
                    if (jp) {
                        am._javaWriteFile(jp, JSON.stringify(data, null, 2));
                        toast(newSkip ? "已取消选择: " + name : "已选择: " + name);
                        styleButton("selectAccount", newSkip ? "未选" : "已选", newSkip ? "#9E9E9E" : "#FF9800", 8);
                    }
                } catch (e) {
                    $log.e("切换选择状态失败: " + e.message);
                }
            });

            // 删除账号按钮（灰色）
            styleButton("deleteAccount", "删除", "#9E9E9E", 8);
            itemUi.id("deleteAccount").click(function () {
                var delName = name;
                $tip.show("确认删除", "确定删除账号 \"" + delName + "\" 吗？", function () {
                    try {
                        let accountManager = require("./modules/accountManager.js");
                        var ok = accountManager.removeAccount(delName);
                        if (ok) {
                            toast("已删除: " + delName);
                        } else {
                            toast("删除失败，账号不存在: " + delName);
                        }
                    } catch (e) {
                        $log.e("删除账号失败: " + e.message);
                        toast("删除失败: " + e.message);
                    }
                });
            });

            // 上移按钮
            styleButton("moveUp", "▲", "#78909C", 4);
            itemUi.id("moveUp").click(function () {
                if (position === 0) { toast("已经是第一个"); return; }
                moveItem(position, position - 1);
            });

            // 下移按钮
            styleButton("moveDown", "▼", "#78909C", 4);
            itemUi.id("moveDown").click(function () {
                try {
                    var total = require("./modules/accountManager.js").listAccounts().length;
                    if (position >= total - 1) { toast("已经是最后一个"); return; }
                } catch (e) {}
                moveItem(position, position + 1);
            });


            // 删除账号按钮（灰色）
            styleButton("deleteAccount", "删除", "#9E9E9E", 8);
            itemUi.id("deleteAccount").click(function () {
                var delName = name;
                $tip.show("确认删除", "确定删除账号 \"" + delName + "\" 吗？", function () {
                    try {
                        let accountManager = require("./modules/accountManager.js");
                        var ok = accountManager.removeAccount(delName);
                        if (ok) {
                            toast("已删除: " + delName);
                        } else {
                            toast("删除失败，账号不存在: " + delName);
                        }
                    } catch (e) {
                        $log.e("删除账号失败: " + e.message);
                        toast("删除失败: " + e.message);
                    }
                });
            });

            // 上号按钮（黄色）
            styleButton("loadArchive", "上号", "#FFC107", 8);
            itemUi.id("loadArchive").click(function () {
                $log.d("上号: " + name);
                var _name = name;
                var accountManager = require("./modules/accountManager.js");
                var _pkg = accountManager.getGamePackageName();
                $root.exeRootShell(`nsenter -t 1 -m am force-stop ${_pkg} 2>/dev/null || am force-stop ${_pkg}`,
                    function (l) { $log.d("关闭游戏: " + l); },
                    function (e) { $log.e("关闭游戏失败: " + e); },
                    function (c) {
                        if (c === 0) $log.i("游戏已关闭");
                        else $log.w("关闭游戏可能失败，退出码: " + c);
                        accountManager.importAccountArchiveJSON(_name, function (success) {
                            if (success) {
                                toast("上号成功: " + _name);
                                $app.run(accountManager.getGamePackageName());
                            } else toast("上号失败: " + _name);
                        });
                    }
                );
            });
        });
    }


/**
 * 权限药丸 — 点击请求对应权限，成功更新绿色
 */
function setupPermissionPills() {
    if (autoService) {
        autoService.click(() => {
            $permit.wza();
            setTimeout(() => {
                if ($permit.hasWza()) {
                    if (autoServiceDot) autoServiceDot.setColor("#4CAF50");
                    if (autoService) autoService.setText("无障碍 ✓");
                    autoSaveConfig();
                } else {
                    toast("无障碍权限获取失败");
                }
            }, 1500);
        });
    }
    if (rootPermission) {
        rootPermission.click(() => {
            $root.getPermit();
            setTimeout(() => {
                if ($root.hasPermit()) {
                    if (rootPermissionDot) rootPermissionDot.setColor("#4CAF50");
                    if (rootPermission) rootPermission.setText("Root ✓");
                    autoSaveConfig();
                } else {
                    toast("Root权限获取失败");
                }
            }, 1500);
        });
    }
}

/**
 * 更新锁云状态显示 - 使用锁云模块的函数
 * @param {string} versionType - 版本类型
 * @param {boolean} isLocked - 是否已锁云（可选参数，实际状态由锁云模块检测）
 */
function updateLockCloudStatus(versionType, isLocked) {
    if (!lockCloudStatus) return;

    // 转换服务器类型为数字代码
    let serverTypeCode;
    let cleanVersionType = String(versionType).trim();

    if (cleanVersionType === "国服") {
        serverTypeCode = 0;
    } else if (cleanVersionType === "国际服") {
        serverTypeCode = 1;
    } else {
        // 如果传入的不是标准文本，尝试从下拉框获取
        let currentServerText = serverType ? serverType.getCheckedText() : "国际服";
        let cleanCurrentServerText = String(currentServerText).trim();
        serverTypeCode = (cleanCurrentServerText === "国服") ? 0 : 1;
    }

    // 使用锁云模块的函数更新显示
    try {
        let uiElements = {
            lockCloudStatus: lockCloudStatus,
            lockCloudDot: ui.id("lockCloudDot")
        };
        lockcloud.updateLockCloudStatusDisplay(serverTypeCode, uiElements);
    } catch (e) {
        $log.e("更新锁云状态显示失败: " + e.message);

        // 简化的错误处理
        $thread.ui(() => {
            try {
                let serverName = (serverTypeCode === 0) ? "国服" : "国际服";
                lockCloudStatus.setText(`${serverName}: 状态检测失败`);
            } catch (uiError) {
                $log.e("错误状态UI更新失败: " + uiError.message);
            }
        });
    }
}














// 绑定tabs和viewpager联动，实现标题显示和页面切换
if (tabs && viewpager) {
    try {
        // 使用AIGame框架的bind方法实现联动
        viewpager.bind(tabs);
        // 预渲染所有页面，避免切换 tab 时列表不加载
        try {
            viewpager.getView().setOffscreenPageLimit(2);
        } catch (e) {
            $log.d("设置离线页面数失败:" + e.message);
        }
        $log.d("pager与tabs绑定成功");
    } catch (e) {
        $log.d("绑定失败:" + e.message);
        // 如果绑定失败，使用手动监听方式
        tabs.onTabSelected((tab, position) => {
            viewpager.setCurrentItem(position);
            $log.d("切换到页面:" + position);
        });

        viewpager.addOnPageChangeListener({
            onPageSelected: (position) => {
                tabs.setSelectedTab(position);
            }
        });
    }
}

//[事件处理] - 添加null检查，确保控件已初始化

//权限药丸 — 点击请求对应权限
setupPermissionPills();

//日志按钮点击事件 - 使用appbar.menu()监听菜单点击事件
if (appbar) {
    appbar.menu((title) => {
        // 检查点击的是否是日志菜单
        if (title === "日志") {
            $log.activity();// 打开日志界面 aigame有现成的不用自己造ui了
        }
    });
}

// 锁云状态文本点击事件 - 点击时更新状态
if (lockCloudStatus) {
    lockCloudStatus.click((view) => {
        // 延迟获取当前服务器类型，确保UI状态同步
        setTimeout(() => {
            let currentServerText = serverType ? serverType.getCheckedText() : "国际服";
            let cleanCurrentServerText = String(currentServerText).trim();
            updateLockCloudStatus(cleanCurrentServerText || "国际服", false);
        }, 100);
    });
}

$log.d("应用启动 - 立即初始化权限状态");
try {
    updatePermissionStatus(true); // 尊重保存的配置，避免覆盖
} catch (e) {
    $log.e("应用启动时初始化权限状态失败: " + e.message);
}

ui.show();

// 延迟初始化权限状态和服务器类型状态，确保UI完全加载
setTimeout(() => {
    // 初始化配置（加载保存的配置或创建默认配置）
    let config = configManager.initConfig();

    // 应用加载的配置到UI

    // 应用服务器类型配置
    if (config.serverType && serverType) {
        serverType.check(config.serverType === "国服" ? 0 : 1);
        let ind = ui.id("accountServerIndicator");
        if (ind) ind.setText(config.serverType);
    }

    if (config.currentAccountMethod) {
        $log.d("应用配置 - currentAccountMethod: " + config.currentAccountMethod);
        currentAccountMethod = config.currentAccountMethod;
        updateAccountMethodState();
    }


    // 初始化权限状态（尊重保存的配置）
    updatePermissionStatus(true);

    // 设置下拉框事件监听器，实现自动保存配置
    $log.d("延迟初始化 - 设置下拉框事件监听器");

    // 服务器类型选择事件监听器
    if (serverType) {
        serverType.onCheck((index) => {
            try {
                let selectedText = serverType.getCheckedText();
                // 自动保存配置
                let success = configManager.updateConfig("serverType", selectedText);
                if (success) {
                    $log.d(`配置自动保存: ${selectedText}`);
                }

                // 同时更新锁云状态显示
                updateLockCloudStatus(selectedText, false);

                // 同步账号页服务器指示
                let ind = ui.id("accountServerIndicator");
                if (ind) ind.setText(selectedText);
            } catch (e) {
                $log.e("服务器类型选择事件处理出错: " + e.message);
            }
        });
    } else {
        $log.e("serverType 控件未找到，无法设置事件监听器");
    }


    // 初始化服务器类型状态
    if (serverType) {
        let initialServerType = serverType.getCheckedText();
        if (initialServerType) {
            // 应用启动时检查并显示当前服务器类型的锁云状态
            updateLockCloudStatus(initialServerType, false);
        } else {
            updateLockCloudStatus("国际服", false);
        }
    }

    // 应用初始化完成日志
    $log.d("应用初始化完成 (仅存档上号)");

    // 清除初始化标志
    isInitializing = false;
}, 1000); // 延迟1秒确保UI完全加载


/**
 * 刷新账号列表 - 从 accounts.json 读取并显示到列表
 */
function refreshAccountList() {
    try {
        let accountManager = require("./modules/accountManager.js");
        let accounts = accountManager.listAccounts();
        
        if (AccountList) {
            // 将账号列表转换为列表组件所需的格式
            let listData = [];
            for (let i = 0; i < accounts.length; i++) {
                let acc = accounts[i];
                let colorBar = (acc.serverType === "国服") ? "#4CAF50" : "#2196F3";
                listData.push({
                    title: acc.name,
                    serverType: acc.serverType,
                    done: false,
                    colorBarColor: colorBar,
                    skipAccount: acc.skipAccount === true
                });
            }
            AccountList.flush(listData);
            $log.d("刷新账号列表完成，共 " + listData.length + " 个账号");
        }
    } catch (e) {
        $log.e("刷新账号列表失败: " + e.message);
    }
}

/**
 * 移动账号顺序（上移/下移）
 */
function moveItem(from, to) {
    try {
        var am = require("./modules/accountManager.js");
        var data = am._loadData();
        if (!data || !data.accounts || from < 0 || to < 0 || from >= data.accounts.length || to >= data.accounts.length) {
            return;
        }
        // 交换位置
        var tmp = data.accounts[from];
        data.accounts[from] = data.accounts[to];
        data.accounts[to] = tmp;
        var jp = am._getAccountsJSONPath();
        if (jp) {
            am._javaWriteFile(jp, JSON.stringify(data, null, 2));
            $log.i("账号顺序已调整: " + from + " ↔ " + to);
            refreshAccountList();
        }
    } catch (e) {
        $log.e("移动账号失败: " + e.message);
        toast("排序失败");
    }
}

// 应用启动后延迟加载列表（确保 UI 已完全渲染）
setTimeout(refreshAccountList, 1500);

// 通过标记文件检查是否需要刷新（跨线程，绕过 JS 变量隔离）
setInterval(function () {
    try {
        var dir = context.getExternalFilesDir(null);
        if (dir != null) {
            var flag = new java.io.File(dir.getAbsolutePath(), ".pending_refresh");
            if (flag.exists()) {
                flag["delete"]();
                $log.d("检测到刷新标记，刷新列表");
                refreshAccountList();
            }
        }
    } catch (e) {
        $log.w("检查刷新标记失败: " + e.message);
    }
}, 800);

/**
 * 处理存档导出操作 (JSON 方式)
 * 在存档上号模式下，点击添加账号FAB按钮时调用
 */
function handleArchiveExport() {
    try {
        // 导入账号管理模块
        let accountManager = require("./modules/accountManager.js");

        // 显示输入对话框，让用户输入账号名称
        $tip.input("导出账号存档", "请输入要导出的账号名称", "", function (result) {
            if (result && result.trim() !== "") {
                // 用户输入了账号名称，执行导出操作
                let accountName = result.trim();
                $log.d("开始导出账号存档: " + accountName);

                // 使用 JSON 方式导出存档
                accountManager.exportAccountArchiveJSON(accountName, function (success) {
                    if (success) {
                        toast("账号存档导出成功: " + accountName);
                        $log.i("账号存档导出成功: " + accountName);
                    } else {
                        toast("账号存档导出失败，请检查权限和存储空间");
                        $log.e("账号存档导出失败: " + accountName);
                    }
                });
            } else {
                // 用户取消了输入或输入为空
                toast("已取消导出账号存档");
                $log.d("用户取消导出账号存档");
            }
        });

    } catch (e) {
        $log.e("处理存档导出时出错: " + e.message);
        toast("导出账号存档时发生错误: " + e.message);
    }
}

/**
 * 显示文字识别账号添加对话框
 * 在文字识别模式下，点击添加账号FAB按钮时调用
 */
function showTextRecognitionDialog() {
    try {
        // 显示输入对话框获取账号名称
        $tip.input("添加文字识别账号", "请输入账号名称", "", function (accountName) {
            if (accountName && accountName.trim() !== "") {
                // 账号名称不为空，处理添加逻辑
                $log.d("添加文字识别账号: " + accountName.trim());

                // 询问账号详情（可选）
                $tip.input("添加账号详情（可选）", "请输入账号详情（可为空）", "", function (accountDetails) {
                    // 处理账号添加逻辑
                    $log.d("文字识别账号添加成功: " + accountName.trim() + ", 详情: " + (accountDetails || "无"));

                    // 这里可以添加具体的文字识别账号保存逻辑
                    // 例如：保存到配置文件、数据库等

                    $log.i("文字识别账号添加成功: " + accountName.trim());

                    // 可以在这里添加刷新账号列表的逻辑
                    // refreshAccountList();
                });

            } else {
                // 账号名称为空
                $log.w("用户未输入有效的账号名称");

                // 重新显示对话框
                setTimeout(function () {
                    showTextRecognitionDialog();
                }, 1000);
            }
        });

    } catch (e) {
        $log.e("显示文字识别对话框时出错: " + e.message);

        // 降级使用简单的输入对话框
        $tip.input("添加文字识别账号", "请输入账号名称", "", function (result) {
            if (result && result.trim() !== "") {
                $log.i("文字识别账号添加成功（降级模式）: " + result.trim());
            } else {
                $log.d("用户取消添加文字识别账号（降级模式）");
            }
        });
    }
}

/**
 * 初始化设备信息显示（分辨率、密度、型号、内存等）
 */
function setupDeviceInfo() {
    try {
        // 导入Java类
        let DisplayMetrics = android.util.DisplayMetrics;
        let Context = android.app.ActivityThread.currentApplication().getApplicationContext();
        let windowService = Context.getSystemService(Context.WINDOW_SERVICE);
        let Display = windowService.getDefaultDisplay();
        let metrics = new DisplayMetrics();
        Display.getMetrics(metrics);

        // 获取设备信息
        let deviceWidth = $device ? $device.width : "未知";
        let deviceHeight = $device ? $device.height : "未知";
        let deviceBrand = $device ? $device.brand : "未知";
        let deviceModel = $device ? $device.model : "未知";
        let densityDpi = metrics.densityDpi;
        let density = metrics.density;

        // 获取内存信息（转换为GB单位）
        let totalMemBytes = $device ? $device.getTotalMem() : 0;
        let availMemBytes = $device ? $device.getAvailMem() : 0;
        let totalMemGB = (totalMemBytes / (1024 * 1024 * 1024)).toFixed(2);
        let availMemGB = (availMemBytes / (1024 * 1024 * 1024)).toFixed(2);

        // 更新UI - AIGame的setText已封装UI线程处理，无需$ui.run
        let screenResolution = ui.id("screenResolution");
        let screenDensity = ui.id("screenDensity");
        let deviceModelText = ui.id("deviceModel");
        let androidVersion = ui.id("androidVersion");
        let memoryInfoText = ui.id("memoryInfo");

        if (screenResolution) screenResolution.setText(`${deviceWidth}×${deviceHeight}`);
        if (screenDensity) screenDensity.setText(`${densityDpi}dpi`);

        // 添加屏幕密度显示
        let screenScale = ui.id("screenScale");
        if (screenScale) screenScale.setText(`${density}`);
        if (deviceModelText) deviceModelText.setText(`${deviceBrand} ${deviceModel}`);
        if (androidVersion) androidVersion.setText(`Android ${$device.release} (API ${$device.sdkInt})`);

        // 添加内存信息显示（合并格式：当前可用内存/总内存）
        if (memoryInfoText) memoryInfoText.setText(`${availMemGB}GB / ${totalMemGB}GB`);

    } catch (e) {
        if (typeof $log !== 'undefined' && $log.e) {
            $log.e("[设备信息] 初始化失败: " + (e.message || e.toString() || "未知错误"));
        }
    }
}

// 延迟初始化设备信息
setTimeout(() => {
    setupDeviceInfo();
}, 1500);

// 动态刷新内存信息
function refreshMemoryInfo() {
    try {
        // 获取内存信息（转换为GB单位）
        let totalMemBytes = $device ? $device.getTotalMem() : 0;
        let availMemBytes = $device ? $device.getAvailMem() : 0;
        let totalMemGB = (totalMemBytes / (1024 * 1024 * 1024)).toFixed(2);
        let availMemGB = (availMemBytes / (1024 * 1024 * 1024)).toFixed(2);

        // 更新内存信息UI - AIGame的setText已封装UI线程处理
        let memoryInfoText = ui.id("memoryInfo");
        if (memoryInfoText) {
            memoryInfoText.setText(`${availMemGB}GB / ${totalMemGB}GB`);
        }
    } catch (e) {
        if (typeof $log !== 'undefined' && $log.e) {
            $log.e("[内存刷新] 刷新失败: " + (e.message || e.toString() || "未知错误"));
        }
    }
}

// 启动内存信息定时刷新
let memoryRefreshTimer = setInterval(() => {
    refreshMemoryInfo();
}, 3000); // 每3秒刷新一次

/* ==================== 单实例守卫 ==================== */
// 用户反馈：「每次运行项目不会先退出上一个项目的 ui，次数多了客户端会崩溃卡死」
// 做法：每个实例启动时把自己的编号写进一个文件；定时自检，
//      一旦发现文件里的编号不是自己（说明又开了新实例），就 ui.finish() 自动退出。
// 这样无论怎么反复运行，界面上永远只剩最新那一个。
let _uiOwnerId = String(Date.now()) + "_" + String(Math.floor(Math.random() * 1000000));
let _uiOwnerPath = "/sdcard/Download/海岛助手/_ui_owner.txt";

function uiOwnerWrite() {
    try { $file.write(_uiOwnerId, _uiOwnerPath); } catch (e) {
        $log.e("[单实例] 写编号失败: " + e.message);
    }
}
function uiOwnerRead() {
    try { return $file.exists(_uiOwnerPath) ? String($file.read(_uiOwnerPath)).trim() : ""; }
    catch (e) { return ""; }
}

uiOwnerWrite();

let uiOwnerTimer = setInterval(() => {
    let cur = uiOwnerRead();
    if (cur && cur !== _uiOwnerId) {
        $log.i("[单实例] 检测到有更新的实例启动了，本界面自动退出（避免界面堆叠）");
        clearInterval(uiOwnerTimer);
        uiOwnerTimer = null;
        try { ui.finish(); } catch (e) { }
    }
}, 2000);

/* ==================== 弱网测试（「更多」页） ==================== */
// 说明：本模块一律不调 $root.getPermit()。
// 实测（本机雷电）：getPermit() 之后 root 命令会永久卡死（同步异步都不返回），
// 无报错、无异常、AutoGOD 进程照常活着——极难排查。所以改用 hasPermit() 查询。

// 取当前该针对哪个包（跟随首页的版本选择，和真正断网时的包名一致）
// 注意：切到别的页面后，首页那个 radio-group 取不到文本（返回空），
// 所以优先读配置里存的值，取不到再退回问 radio。
function weakServerTypeText() {
    try {
        let t = (serverType && typeof serverType.getCheckedText === "function")
            ? (serverType.getCheckedText() || "").trim() : "";
        if (t) return t;
    } catch (e) { /* 忽略，走配置 */ }
    try {
        let t2 = configManager.getConfigItem("serverType", "");
        if (t2 && String(t2).trim()) return String(t2).trim();
    } catch (e) { /* 忽略 */ }
    return "国际服"; // 项目一贯的默认值
}

function weakCurrentPkg() {
    return netControl.resolvePackage(weakServerTypeText());
}

// 刷新弱网卡片上的状态显示
// ⚠️ 这里每秒跑一次，**绝对不许调 root 命令**（resolveUid 之类），
//    只用模块缓存的状态，否则界面会卡住。
function refreshWeakNetUI() {
    try {
        let st = netControl.status();

        if (weakTarget) {
            let pkg = st.pkg || weakCurrentPkg();
            if (!pkg) {
                weakTarget.setText("请先在首页选版本");
            } else if (st.uid) {
                weakTarget.setText(netControl.pkgLabel(pkg) + "（UID " + st.uid + "）");
            } else {
                weakTarget.setText(netControl.pkgLabel(pkg));
            }
        }

        if (st.on) {
            if (weakDot) weakDot.setColor("#E53935");
            if (weakStatus) weakStatus.setText("已断网 " + st.heldText);
        } else {
            if (weakDot) weakDot.setColor("#4CAF50");
            if (weakStatus) weakStatus.setText("未断网");
        }
    } catch (e) {
        if (typeof $log !== "undefined" && $log.e) $log.e("[弱网] 刷新界面失败: " + e.message);
    }
}

let weakRefreshTimer = setInterval(refreshWeakNetUI, 1000);
refreshWeakNetUI();

// 诊断：确认控件都找到了
$log.i("[弱网] 控件检查: weakTarget=" + (weakTarget ? "有" : "无") +
    " weakDot=" + (weakDot ? "有" : "无") +
    " weakStatus=" + (weakStatus ? "有" : "无") +
    " btnWeakOn=" + (btnWeakOn ? "有" : "无") +
    " btnWeakRetry=" + (btnWeakRetry ? "有" : "无") +
    " btnWeakOff=" + (btnWeakOff ? "有" : "无") +
    " hasRoot=" + netControl.hasRoot() +
    " 当前包=" + weakCurrentPkg());

if (btnWeakOn) {
    btnWeakOn.click(() => {
        $log.i("[弱网] == 点了「开启弱网」==");
        let pkg = weakCurrentPkg();
        if (!pkg) {
            toast("请先在首页选好是国服还是国际服");
            return;
        }
        toast("正在开弱网...");
        netControl.enable({ serverType: weakServerTypeText() }, (err, info) => {
            if (err) {
                $log.e("[弱网] 开启失败: " + err.message);
                toast("开弱网失败：" + err.message);
            } else {
                $log.i("[弱网] 开启成功: " + JSON.stringify(info));
                toast("已断网：" + info.label + "（UID " + info.uid + "）");
            }
            refreshWeakNetUI();
        });
    });
} else {
    $log.e("[弱网] 没找到 btnWeakOn 控件，按钮事件没绑上！");
}

if (btnWeakOff) {
    btnWeakOff.click(() => {
        netControl.disable((err, info) => {
            toast((info && info.leftOver > 0)
                ? ("已恢复，但仍剩 " + info.leftOver + " 条规则")
                : "已恢复网络");
            refreshWeakNetUI();
        });
    });
}

if (btnWeakRetry) {
    btnWeakRetry.click(() => {
        // 「断网重连」= 一键操作，三步全自动：
        //   ① 强停游戏（清掉游戏里卡住的连接状态）
        //   ② 恢复网络（把断网规则撤掉）—— 这一步以前漏了！
        //   ③ 重新启动游戏
        // 【绝不】用 svc wifi disable —— 模拟器的 wlan0 关掉就再也连不回来（会卡死）
        let pkg = netControl.activePkg() || weakCurrentPkg();
        if (!pkg) {
            toast("请先在首页选好是国服还是国际服");
            return;
        }
        toast("正在断网重连（重启游戏 + 恢复网络）...");
        $log.i("[弱网] 断网重连开始，目标 " + pkg);

        let moved = false;

        // ② 恢复网络 + ③ 重启游戏
        function restoreAndLaunch() {
            if (moved) return;      // 只走一次
            moved = true;

            netControl.disable(function (err, info) {
                refreshWeakNetUI();
                $log.i("[弱网] 断网重连：网络已恢复" +
                       (info && info.leftOver > 0 ? "（还剩 " + info.leftOver + " 条规则）" : ""));
                setTimeout(function () {
                    try {
                        $app.run(pkg);
                        toast("已恢复网络，正在重新启动游戏");
                    } catch (e) {
                        $log.e("[弱网] 重启游戏失败: " + e.message);
                        toast("网络已恢复，但重启游戏失败：" + e.message);
                    }
                }, 800);
            });
        }

        // 兜底：万一强停的回调不回来，5 秒后也一定要把网络恢复
        setTimeout(function () {
            if (!moved) {
                $log.w("[弱网] 强停回调超时，直接恢复网络");
                restoreAndLaunch();
            }
        }, 5000);

        // ① 强停游戏
        try {
            $root.exeRootShell(
                `nsenter -t 1 -m am force-stop ${pkg} 2>/dev/null || am force-stop ${pkg}`,
                () => { },
                (e) => {
                    $log.e("[弱网] 强停失败: " + e);
                    restoreAndLaunch();
                },
                (code) => {
                    $log.i("[弱网] 强停 " + pkg + " 退出码 " + code);
                    restoreAndLaunch();
                }
            );
        } catch (e) {
            $log.e("[弱网] 强停异常: " + e.message);
            restoreAndLaunch();
        }
    });
}

// 应用退出时清理定时器
ui.onDestroy(() => {
    if (memoryRefreshTimer) {
        clearInterval(memoryRefreshTimer);
        memoryRefreshTimer = null;
    }
    if (weakRefreshTimer) {
        clearInterval(weakRefreshTimer);
        weakRefreshTimer = null;
    }
    if (uiOwnerTimer) {
        clearInterval(uiOwnerTimer);
        uiOwnerTimer = null;
    }
    // 🚨 关键：退出前一定把断网规则清干净，绝不留下断网状态
    try {
        if (netControl.isOn()) {
            $log.w("[弱网] 界面退出，自动恢复网络");
            netControl.forceClear(() => { });
        }
    } catch (e) {
        $log.e("[弱网] 退出清理失败: " + e.message);
    }
    // 关闭所有悬浮窗
    try { $floaty.closeAll(); } catch (e) {}
});

// activity生命周期函数:当回到本界面的时候就调用
ui.onResume(() => {
    updatePermissionStatus(true); // 尊重保存的配置，避免覆盖
    // 每次回到界面时刷新账号列表
    refreshAccountList();
});

/**
 * 更新权限状态
 * @param {boolean} respectSavedConfig - 是否尊重保存的配置（true：只更新已获取权限的控件状态，false：强制更新所有状态）
 */
function updatePermissionStatus(respectSavedConfig = false) {
    if (autoService) {
        const hasWza = $permit.hasWza();
        if (hasWza) {
            if (autoServiceDot) autoServiceDot.setColor("#4CAF50");
            if (autoService) autoService.setText("无障碍 ✓");
        } else if (!respectSavedConfig) {
            if (autoServiceDot) autoServiceDot.setColor("#9E9E9E");
            if (autoService) autoService.setText("无障碍 ✗");
        }
    }
    if (rootPermission) {
        const hasRoot = $root.hasPermit();
        if (hasRoot) {
            if (rootPermissionDot) rootPermissionDot.setColor("#4CAF50");
            if (rootPermission) rootPermission.setText("Root ✓");
        } else if (!respectSavedConfig) {
            if (rootPermissionDot) rootPermissionDot.setColor("#9E9E9E");
            if (rootPermission) rootPermission.setText("Root ✗");
        }
    }
}

/**
 * 自动保存配置
 * 收集当前UI状态并保存到配置文件
 */
function autoSaveConfig() {
    // 如果在初始化阶段，跳过自动保存以避免重复
    if (isInitializing) {
        return;
    }

    try {
        // 收集当前UI状态
        let currentConfig = {};

        // 保存服务器类型
        if (serverType) {
            currentConfig.serverType = serverType.getCheckedText();
        }

        // 保存账号信息配置
        let configChanged = false;
        if (currentAccountMethod) {
            if (this._lastSavedAccountMethod !== currentAccountMethod) {
                currentConfig.currentAccountMethod = currentAccountMethod;
                this._lastSavedAccountMethod = currentAccountMethod;
                configChanged = true;
            }
        }


        // 检查配置是否有变化（包括状态变化和实际配置变化）
        let oldConfigStr = JSON.stringify(configManager.loadConfig());
        let newConfigStr = JSON.stringify(currentConfig);

        if (oldConfigStr !== newConfigStr || configChanged) {
            // 保存配置
            configManager.saveConfig(currentConfig);
            // 只在真正发生变化时记录日志
            if (configChanged) {
                $log.d("配置自动保存成功");
            }
        }
    } catch (e) {
        $log.e("自动保存配置失败: " + e.message);
    }
}