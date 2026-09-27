/**
 * 暂停管理器模块 - AutoGOD 版
 *
 * 利用 $engine.pause(taskId) / $engine.start(taskId) 控制脚本暂停和恢复，
 * 不需要脚本内部做任何轮询检查。
 * 暂停时展开显示：主页、日志、关闭三个扩展按钮。
 *
 * 用法：
 *   var pm = require("pauseManager.js");
 *   pm.createPauseButton();     // 创建悬浮暂停按钮
 *   pm.closePauseWindow();      // 关闭暂停窗口
 *   pm.isPaused();              // 检查当前是否暂停（基于 $engine.isPause(taskId)）
 *
 * 脚本主循环不需要调用 waitIfPaused()，引擎会自动挂起/恢复。
 */

// 在 require() 时捕获主脚本的任务 ID
var _taskId = null;
try { _taskId = $task.ID; } catch(e) {}

// 模块内部状态
var _win = null;
var _isWindowClosing = false;
var _winX = 0, _winY = 0;
var _dragStartX = 0, _dragStartY = 0;
var _winStartX = 0, _winStartY = 0;

// 提前加载 floatyLog，避免在回调中首次 require 触发 FAILED ASSERTION
// 使用和 chaDiaoXiang.js 相同的路径格式
var _floatyLog = null;
try { _floatyLog = require("../modules/floatyLog.js"); } catch(e) {}

// ===== 基础函数 =====

/** 重置到默认位置（屏幕右侧垂直居中） */
function resetToDefaultPosition() {
    if (!_win) return;
    try {
        var info = $screen.info();
        var sw = info.w;
        var sh = info.h;
        var dpi = info.dpi;

        // dp 转 px: px = dp * dpi / 160
        function dp2px(dp) { return Math.round(dp * dpi / 160); }

        // 实际测量：padding 在 floaty 中不生效，窗口实际宽度 = img 22dp
        var winPx = dp2px(22);
        _win.setWH(winPx, winPx);

        _winX = sw - winPx;
        _winY = Math.floor((sh - winPx) / 2);
        _winX = Math.max(0, _winX);
        _winY = Math.max(0, Math.min(_winY, sh - winPx));
        _win.setXY(_winX, _winY);
    } catch(e) {}
}

/** 根据引擎暂停状态更新 UI */
function updatePauseUI() {
    if (!_win || _isWindowClosing) return;
    var paused = false;
    try { paused = $engine.isPause(_taskId) === true; } catch(e) {}
    try {
        var btn = _win.id("pauseBtn");
        if (btn) btn.setSrc(paused ? "ic_play_arrow_fill" : "ic_pause_fill");
    } catch(e) {}
    try {
        var homeCard = _win.id("homeCard");
        if (homeCard) homeCard.setVisibility(paused ? android.view.View.VISIBLE : android.view.View.GONE);
    } catch(e) {}
    try {
        var logCard = _win.id("logCard");
        if (logCard) logCard.setVisibility(paused ? android.view.View.VISIBLE : android.view.View.GONE);
    } catch(e) {}
    try {
        var closeCard = _win.id("closeCard");
        if (closeCard) closeCard.setVisibility(paused ? android.view.View.VISIBLE : android.view.View.GONE);
    } catch(e) {}
    // 调整窗口尺寸：暂停时展开 (4个按钮)，恢复时缩回 (1个按钮)
    try {
        var info = $screen.info();
        function dp2px(dp) { return Math.round(dp * info.dpi / 160); }
        var w = dp2px(22);                     // 按钮宽度
        if (paused) {
            _win.setWH(w, dp2px(22 * 4 + 3));  // 4个按钮 + 3个间距
        } else {
            _win.setWH(w, dp2px(22));           // 1个按钮
        }
    } catch(e) {}
}

// ===== 创建悬浮窗 =====

/**
 * 创建暂停按钮悬浮窗（系统窗口级别）
 * 按钮点击通过 $engine.pause(taskId) / $engine.start(taskId) 控制脚本
 */
function createPauseButton() {
    try { $permit.floaty(); } catch(e) {}

    _win = $floaty.newSys(`
<ui>
<card radius="3" style="outline" strokeColor="#00000000" tint="#696969" padding="1dp">
<linear dir="v" w="max">
    <card radius="3" style="outline" strokeColor="#00000000" tint="#FF8C00" padding="3dp">
        <img id="pauseBtn"
            src="ic_pause_fill"
            w="22dp" h="22dp" tint="#FFFFFF" />
    </card>
    <card id="homeCard" radius="3" style="outline" strokeColor="#00000000"
        tint="#4CAF50" padding="3dp" margin="1dp,0,0,0" visibility="gone">
        <img id="homeBtn"
            src="ic_home_fill"
            w="22dp" h="22dp" tint="#696969" />
    </card>
    <card id="logCard" radius="3" style="outline" strokeColor="#00000000"
        tint="#2196F3" padding="3dp" margin="1dp,0,0,0" visibility="gone">
        <img id="logBtn"
            src="ic_article_outline"
            w="22dp" h="22dp" tint="#696969" />
    </card>
    <card id="closeCard" radius="3" style="outline" strokeColor="#00000000"
        tint="#F44336" padding="3dp" margin="1dp,0,0,0" visibility="gone">
        <img id="closeBtn"
            src="ic_close_outline"
            w="22dp" h="22dp" tint="#696969" />
    </card>
</linear>
</card>
</ui>
`);

    if (!_win) return;

    _win.touch(true);

    // 显式固定窗口尺寸，避免因 padding 不生效导致计算偏差
    try {
        var info = $screen.info();
        var d = info.density;
        _win.setWH(Math.round(22 * d), Math.round(22 * d));
    } catch(e) {}

    // 屏幕旋转时重新吸附到右侧中间
    try {
        _win.onScreenChange(function() {
            resetToDefaultPosition();
        });
    } catch(e) {}

    // 主按钮：拖拽 + 点击
    registerMainDrag();
    try { _win.id("homeCard").click(function() { goToHome(); }); } catch(e) {}
    try {
        _win.id("logCard").click(function() {
            if (_floatyLog) {
                _floatyLog.show();
                _floatyLog.i("日志窗口已显示");
            }
            toast("日志窗口已显示");
        });
    } catch(e) {}
    try { _win.id("closeCard").click(function() { closeScript(); }); } catch(e) {}

    // 强制初始化 UI 状态
    updatePauseUI();
    resetToDefaultPosition();
}

/** 主按钮：拖拽移动 + 点击切换暂停/恢复 */
function registerMainDrag() {
    if (!_win) return;
    try {
        _win.id("pauseBtn").onTouch(function(event, view) {
            if (_isWindowClosing) return true;
            var action = event.getAction();
            switch (action) {
                case 0: // ACTION_DOWN
                    _dragStartX = event.getRawX();
                    _dragStartY = event.getRawY();
                    _winStartX = _winX;
                    _winStartY = _winY;
                    return true;
                case 2: // ACTION_MOVE
                    if (_isWindowClosing) return true;
                    _winX = _winStartX + (event.getRawX() - _dragStartX);
                    _winY = _winStartY + (event.getRawY() - _dragStartY);
                    // 边界检查，防止拖出屏幕
                    try {
                        var info = $screen.info();
                        var btnPx = Math.round(22 * info.dpi / 160);
                        _winX = Math.max(0, Math.min(_winX, info.w - btnPx));
                        _winY = Math.max(0, Math.min(_winY, info.h - btnPx));
                    } catch(e) {}
                    _win.setXY(_winX, _winY);
                    return true;
                case 1: // ACTION_UP
                case 3: // ACTION_CANCEL
                    if (_isWindowClosing) return true;
                    var dx = event.getRawX() - _dragStartX;
                    var dy = event.getRawY() - _dragStartY;
                    _winX = _winStartX + dx;
                    _winY = _winStartY + dy;
                    // 边界检查
                    try {
                        var info = $screen.info();
                        var btnPx = Math.round(22 * info.dpi / 160);
                        _winX = Math.max(0, Math.min(_winX, info.w - btnPx));
                        _winY = Math.max(0, Math.min(_winY, info.h - btnPx));
                    } catch(e) {}
                    _win.setXY(_winX, _winY);
                    // 移动距离 < 10px 视为点击 → 切换暂停/恢复
                    if (Math.sqrt(dx * dx + dy * dy) < 10) {
                        togglePause();
                    }
                    return true;
            }
            return true;
        });
    } catch(e) {}
}

// ===== 核心功能 =====

/**
 * 切换暂停/恢复
 * 使用 $engine.pause(taskId) / $engine.start(taskId) 控制主脚本，
 * _taskId 在 require() 时从 $task.ID 捕获
 */
function togglePause() {
    if (_isWindowClosing || !_taskId) return;
    try {
        if ($engine.isPause(_taskId) === true) {
            $engine.start(_taskId);
            toast("脚本已恢复");
        } else {
            $engine.pause(_taskId);
            toast("脚本已暂停");
        }
    } catch(e) {
        try { $log.e("pauseManager togglePause: " + e.message); } catch(_) {}
    }
    $ui.run(function() { updatePauseUI(); });
}

/** 返回项目主界面（打开脚本项目自身的 UI 主页，不停止脚本） */
function goToHome() {
    toast("返回主页");
    // 启动项目自身的主界面（AIGame 项目页面），不停止脚本
    try {
        var pkg = context.getPackageName();
        $app.launchPkg(pkg);
    } catch(e) {}
}

/** 关闭所有脚本 */
function closeScript() {
    toast("正在关闭脚本...");
    closePauseWindow();
    try { $floaty.closeAll(); } catch(e) {}
    try { $engine.stopAll(); } catch(e) {}
    try { $thread.stopAll(); } catch(e) {}
}

/** 关闭暂停窗口 */
function closePauseWindow() {
    if (_isWindowClosing) return;
    _isWindowClosing = true;
    if (_win) {
        try { _win.close(); } catch(e) {}
        _win = null;
    }
    _isWindowClosing = false;
}

/** 获取当前暂停状态（基于 $engine.isPause(taskId)） */
function isCurrentlyPaused() {
    try { return $engine.isPause(_taskId) === true; } catch(e) { return false; }
}

/** 获取屏幕尺寸 */
function getCurrentScreenSize() {
    try {
        return { width: $screen.getWidth(), height: $screen.getHeight() };
    } catch(e) { return { width: 1080, height: 2400 }; }
}

// ===== 导出 =====
var api = {
    createPauseButton: createPauseButton,
    togglePause: togglePause,
    closePauseWindow: closePauseWindow,
    isPaused: isCurrentlyPaused,
    goToHome: goToHome,
    closeScript: closeScript,
    getCurrentScreenSize: getCurrentScreenSize
};
api;
