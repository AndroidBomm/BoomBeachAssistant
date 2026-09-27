/**
 * 悬浮日志模块 - AIGame 版（单例模式）
 * 
 * 用法：
 *   var floatys = require("floatyLog.js");
 *   floatys.show();
 *   floatys.i("普通日志");
 *   floatys.d("调试日志");
 *   floatys.w("警告日志");
 *   floatys.e("错误日志");
 *   floatys.hide();
 */
var POS_KEY = "floaty_log_pos";
var MAX_LOGS = 200;

// 捕获主脚本的任务 ID，用于自动销毁
var _logTaskId = null;
try { _logTaskId = $task.ID; } catch(e) {}

// ===== 单例模式：全局共享状态，多处 require 共用同一实例 =====
var G = typeof global !== "undefined" ? global : (function(){return this;})();
if (typeof G.__floatyLogSingleton === "undefined") {
    G.__floatyLogSingleton = {
        win: null,
        logLines: [],
        posTimer: null,
        winX: 50,
        winY: 100,
        isLocked: false,
        isLandscape: false,
        dragStartX: 0, dragStartY: 0,
        winStartX: 0, winStartY: 0
    };
}
var S = G.__floatyLogSingleton;

// ===== 快捷引用（保持与原有代码兼容） =====
var win = S.win;
var logLines = S.logLines;
var posTimer = S.posTimer;
var winX = S.winX, winY = S.winY;
var isLocked = S.isLocked;
var isLandscape = S.isLandscape;
var dragStartX = S.dragStartX, dragStartY = S.dragStartY;
var winStartX = S.winStartX, winStartY = S.winStartY;

// 每当读取本地变量后，从单例同步一次
function syncFrom() {
    win = S.win;
    logLines = S.logLines;
    posTimer = S.posTimer;
    winX = S.winX; winY = S.winY;
    isLocked = S.isLocked;
    isLandscape = S.isLandscape;
    dragStartX = S.dragStartX; dragStartY = S.dragStartY;
    winStartX = S.winStartX; winStartY = S.winStartY;
}

// 将本地变量写回单例
function syncTo() {
    S.win = win;
    S.logLines = logLines;
    S.posTimer = posTimer;
    S.winX = winX; S.winY = winY;
    S.isLocked = isLocked;
    S.isLandscape = isLandscape;
    S.dragStartX = dragStartX; S.dragStartY = dragStartY;
    S.winStartX = winStartX; S.winStartY = winStartY;
}

// 日志级别颜色（参考 AutoJS 版配色）
var logColors = {
    i: "#FFFFFF",  // 普通 - 白色
    d: "#00FF00",  // 调试 - 绿色
    w: "#0080FF",  // 警告 - 蓝色
    e: "#FF0000"   // 错误 - 红色
};
var logIcons = {
    i: "💬",
    d: "🔧",
    w: "⚠️",
    e: "❌"
};

function savePos(x, y) {
    try {
        var key = isLandscape ? POS_KEY + "_landscape" : POS_KEY;
        $storage.put(key, JSON.stringify({ x: x, y: y }));
    } catch(e) {}
}

function loadPos() {
    try {
        var data = $storage.get(POS_KEY);
        if (data) return JSON.parse(data);
    } catch(e) {}
    return { x: 50, y: 100 };
}

function updateLog() {
    syncFrom();
    if (!win) return;
    try {
        var tv = win.id("tvLog");
        if (tv) {
            var sb = "";
            for (var i = 0; i < logLines.length; i++) {
                if (i > 0) sb += "<br>";
                sb += logLines[i];
            }
            tv.setText(android.text.Html.fromHtml(sb));
        }
        var countText = win.id("countText");
        if (countText) countText.setText(logLines.length + "/" + MAX_LOGS);
        // 自动滚动到底部（延迟等布局完成，同 AutoJS 版做法）
        try {
            var scroll = win.id("logScroll");
            if (scroll) {
                (function(sv) {
                    setTimeout(function() {
                        try { sv.fullScroll(android.view.View.FOCUS_DOWN); } catch(e) {}
                    }, 100);
                })(scroll.getView());
            }
        } catch(e) {}
    } catch(e) {}
}

function addLog(level, text) {
    syncFrom();
    var color = logColors[level] || "#FFFFFF";
    var icon = logIcons[level] || "💬";
    logLines.push('<font color="' + color + '">' + icon + " " + text + "</font>");
    if (logLines.length > MAX_LOGS) logLines.shift();
    syncTo();
    updateLog();
}

function show() {
    syncFrom();
    try {
        // 如果已有窗口且未被关闭，直接更新日志后返回
        if (win) {
            try {
                win.check(); // 验证窗口是否可操作
                updateLog();
                return;
            } catch(e) {
                // 窗口已失效，清理引用
                win = null;
                if (posTimer) { clearInterval(posTimer); posTimer = null; }
            }
        }
        
        try { $permit.floaty(); } catch(e) {}
        
        var pos = loadPos();
        winX = pos.x; winY = pos.y;
        
        // 检测屏幕方向，横屏时覆盖为用户上次横屏位置或默认位置
        var sw = $screen.getWidth();
        var sh = $screen.getHeight();
        isLandscape = sw > sh;
        if (isLandscape) {
            // 横屏默认位置：屏幕宽度1/3处，顶部（固定像素偏移，类似 AutoJS 版）
            var landscapePos = $storage.get(POS_KEY + "_landscape");
            if (landscapePos) {
                var lp = JSON.parse(landscapePos);
                winX = lp.x; winY = lp.y;
            } else {
                winX = Math.floor(sw / 3 - 130);
                winY = 0;
                if (winX < 0) winX = 0;
            }
        }
        
        win = $floaty.newSys(`
<ui>
<frame id="rootFrame" w="125dp" radius="3dp">
<linear dir="v" w="max" h="max" bg="#44333333">
    <linear dir="h" w="max" h="18dp" bg="#AA444444" gravity="center_vertical" padding="2,0">
        <text text="日志" textSize="8" textColor="#FFFFFF" w="0" weight="1" gravity="left" />
        <img id="lockBtn" src="ic_lock_open_fill" w="12dp" h="12dp" tint="#4CAF50" margin="0,0,1,0" />
        <img id="btnClear" src="ic_delete_outline_outline" w="12dp" h="12dp" tint="#FF9800" margin="0,0,1,0" />
        <text id="countText" text="0/200" textSize="7" textColor="#AAAAAA" margin="0,0,1,0" gravity="center" />
        <img id="btnClose" src="ic_close_fill" w="12dp" h="12dp" tint="#FFFFFF" />
    </linear>
    <scroll id="logScroll" w="max" h="52dp" bg="#66333333">
        <text id="tvLog" textSize="9" textColor="#CCCCCC" padding="2" lineSpacingExtra="0.5" />
    </scroll>
</linear>
</frame>
</ui>
`);
        
        win.setXY(winX, winY);
        win.touch(true);
        
        // 监听屏幕旋转，自动调整位置
        try {
            win.onScreenChange(function() {
                var sw = $screen.getWidth();
                var sh = $screen.getHeight();
                var nowLandscape = sw > sh;
                syncFrom();
                if (nowLandscape !== isLandscape) {
                    isLandscape = nowLandscape;
                    if (isLandscape) {
                        // 切到横屏：保存竖屏位置，设置横屏默认位置
                        savePos(winX, winY);
                        winX = Math.floor(sw / 3 - 130);
                        winY = 0;
                        if (winX < 0) winX = 0;
                    } else {
                        // 切回竖屏：加载用户保存的竖屏位置
                        var p = loadPos();
                        winX = p.x; winY = p.y;
                    }
                    $ui.run(function() {
                        win.setXY(winX, winY);
                    });
                }
                syncTo();
            });
        } catch(e) {}
        
        // 关闭按钮
        try {
            win.id("btnClose").click(function() { hide(); });
        } catch(e) {}
        
        // 清空按钮
        try {
            win.id("btnClear").click(function() {
                syncFrom();
                logLines = [];
                syncTo();
                updateLog();
            });
        } catch(e) {}
        
        // 锁定按钮
        try {
            win.id("lockBtn").click(function() {
                syncFrom();
                isLocked = !isLocked;
                var lockEl = win.id("lockBtn");
                if (lockEl) lockEl.setSrc(isLocked ? "ic_lock_outline" : "ic_lock_open_fill");
                syncTo();
            });
        } catch(e) {}
        
        // 初始化锁定按钮状态（重建窗口时同步当前 isLocked）
        try {
            var lockEl = win.id("lockBtn");
            if (lockEl) lockEl.setSrc(isLocked ? "ic_lock_outline" : "ic_lock_open_fill");
        } catch(e) {}
        
        // 拖拽处理
        function handleDrag(event, view) {
            syncFrom();
            if (isLocked) return false;
            var action = event.getAction();
            switch (action) {
                case 0:
                    dragStartX = event.getRawX();
                    dragStartY = event.getRawY();
                    winStartX = winX;
                    winStartY = winY;
                    syncTo();
                    return true;
                case 2:
                    var dx = event.getRawX() - dragStartX;
                    var dy = event.getRawY() - dragStartY;
                    winX = winStartX + dx;
                    winY = winStartY + dy;
                    // 边界检查，防止拖出屏幕
                    try {
                        var info = $screen.info();
                        var wPx = Math.round(125 * info.dpi / 160);
                        var hPx = Math.round(82 * info.dpi / 160);
                        winX = Math.max(0, Math.min(winX, info.w - wPx));
                        winY = Math.max(0, Math.min(winY, info.h - hPx));
                    } catch(e) {}
                    win.setXY(winX, winY);
                    syncTo();
                    return true;
                case 1:
                case 3:
                    savePos(winX, winY);
                    syncTo();
                    return true;
            }
            return false;
        }
        
        try {
            var rootFrame = win.id("rootFrame");
            if (rootFrame) rootFrame.onTouch(handleDrag);
        } catch(e) {
            $log.w("floatyLog拖拽注册失败(rootFrame): " + e.message);
        }
        try {
            var tvLog = win.id("tvLog");
            if (tvLog) tvLog.onTouch(handleDrag);
        } catch(e) {
            $log.w("floatyLog拖拽注册失败(tvLog): " + e.message);
        }
        
        syncTo();
        
        // 显示已有日志（重新创建窗口后恢复）
        updateLog();
        
        posTimer = setInterval(function() {
            syncFrom();
            if (win) {
                savePos(winX, winY);
                // 自动销毁：主脚本结束后清理日志悬浮窗
                if (_logTaskId && !$engine.has(_logTaskId)) {
                    clearInterval(posTimer);
                    posTimer = null;
                    try { win.close(); } catch(e) {}
                    win = null;
                    logLines = [];
                    syncTo();
                }
            }
        }, 10000);
        S.posTimer = posTimer;
        
    } catch(e) {
        $log.e("floatyLog创建失败: " + e.message);
    }
}

function hide() {
    syncFrom();
    try {
        if (posTimer) { clearInterval(posTimer); posTimer = null; }
        if (win) { win.close(); win = null; }
        syncTo();
    } catch(e) {}
}

function destroy() {
    syncFrom();
    try {
        if (posTimer) { clearInterval(posTimer); posTimer = null; }
        if (win) { win.close(); win = null; }
        logLines = [];
        syncTo();
    } catch(e) {}
}

var api = {
    show: show,
    hide: hide,
    destroy: destroy,
    i: function(t) { addLog("i", t); $log.i(t); },
    d: function(t) { addLog("d", t); $log.d(t); },
    w: function(t) { addLog("w", t); $log.w(t); },
    e: function(t) { addLog("e", t); $log.e(t); },
    clear: function() { syncFrom(); logLines = []; syncTo(); updateLog(); },
    getLogCount: function() { syncFrom(); return logLines.length; }
};

// 写入单例（确保 api 也被共享）
S.api = api;
syncTo();
api;
