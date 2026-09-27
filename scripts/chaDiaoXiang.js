/**
 * 查雕像脚本 - pauseManager 完整测试
 */
var floatys = require("../modules/floatyLog.js");
var pm = require("../modules/pauseManager.js");

floatys.show();
floatys.i("查雕像脚本启动");

// 创建暂停按钮（会自动定位到屏幕右侧中间）
pm.createPauseButton();
floatys.i("暂停按钮已创建");

try {
    for (var i = 0; i < 10; i++) {
        floatys.i("正在检查第 " + (i + 1) + " 个雕像...");
        sleep(1000);
    }
    floatys.i("查雕像完成");
} catch (e) {
    floatys.e("出错: " + e.message);
} finally {
    pm.closePauseWindow();
    floatys.i("脚本已结束");
}
