/**
 * 图色查找模块
 *
 * 基于冉遗鱼图色插件（OperHandler.js）的二次封装，
 * 自动管理截图和 Mat 释放，一行代码完成找色/找图 + 点击。
 *
 * ── 快速上手 ──
 *
 *   let finder = require("./modules/imageFinder.js");
 *
 *   // 找色 — 屏幕上有这个颜色就点它
 *   finder.findColor("#C7A1A1-0x101010", "28|14|#E84B32-0x101010");
 *
 *   // 找图 — 传入关键词自动拼路径
 *   finder.findImg("关闭按钮");         // → ./res/images/关闭按钮.png
 *
 *   // SURF 找图 — 适合会旋转/缩放的 3D 目标
 *   finder.findImgBySurf("司令部");
 *
 *   // 等待 — 等目标出现，超时自动放弃
 *   finder.waitForColor("#C7A1A1", "...", 5000);
 *   finder.waitForImg("升级按钮", 5000);
 *
 *   // 纯检测 — 只判断有没有，不做点击
 *   if (finder.checkColor("#C7A1A1", "...")) { }
 *   if (finder.checkImg("升级按钮")) { }
 *
 * ── opt 公共参数（所有函数共用） ──
 *
 *   {
 *     threshold: 0.9,    // 匹配度，0~1，越高越严格
 *     click:     true,    // 找到后是否自动点击
 *     retry:     1,       // 最多尝试几次
 *     interval:  500,     // 每次尝试间隔(毫秒)
 *     sx, sy, ex, ey      // 搜索区域，默认全屏
 *   }
 *
 * ── 配置化（color.json） ──
 *
 *   finder.findMultiColorx("主页");      // 从 color.json 读取多点找色参数
 *   finder.findColorx("主页按钮");       // 从 color.json 读取单点找色参数
 *   finder.cmpColorx("状态栏");          // 从 color.json 读取比色参数
 */

// ==================== 依赖加载 ====================

var _handler = null;        // OperHandler 实例（懒加载）
var _inited = false;        // 初始化标志
var _floaty = require("./floatyLog.js");  // 悬浮窗日志

/**
 * 获取 OperHandler 实例（首次调用时自动初始化）
 * 初始化会加载 so + dex 库，只执行一次
 */
function _getHandler() {
    if (!_inited) {
        try {
            var OperHandlerClass = require("./OperHandler.js");
            _handler = OperHandlerClass;
            if (typeof _handler === 'function') {
                _handler = new _handler();
            }
            _handler.imageHandlerInit();
            _inited = true;
        } catch(e) {
            $log.e("imageFinder 初始化失败: " + e.message);
        }
    }
    return _handler;
}

// ==================== 内部工具函数 ====================

/**
 * 点击指定坐标
 * @param {number} x
 * @param {number} y
 * @returns {boolean} 点击是否成功
 */
function _click(x, y) {
    if (x < 0 || y < 0) { _floaty.e("无效坐标: " + x + "," + y); return false; }
    try {
        $act.click(x, y);
        _floaty.d("点击 " + x + "," + y);
        return true;
    } catch(e) {
        _floaty.e("点击失败: " + e.message);
        return false;
    }
}

/**
 * 回收 Mat 对象（释放内存）
 * 可传多个参数，每个都会被回收
 */
function _recycle() {
    var h = _handler;
    if (!h) return;
    for (var i = 0; i < arguments.length; i++) {
        try { if (arguments[i]) h.recycle(arguments[i]); } catch(e) {}
    }
}

/**
 * 智能路径处理
 * 传 "关闭按钮" → 自动变成 "./res/images/关闭按钮.png"
 * 传完整路径或已有后缀的不做处理
 * @param {string} name
 * @returns {string|null}
 */
function _smartPath(name) {
    if (!name) return null;
    if (name.indexOf('/') >= 0 || name.indexOf('\\') >= 0) return name;
    if (name.indexOf('.') >= 0) return name;
    return "./res/images/" + name + ".png";
}

// ==================== 通用重试执行器 ====================

/**
 * 带重试的通用执行器
 * 内部自动调用 _getHandler() 获取 OperHandler 实例
 *
 * @param {function} fn     — (handler) => 找到返回结果，没找到返回 null
 * @param {object}   opt    — { retry, interval }
 * @returns  fn 的返回值，全部重试失败返回 null
 */
function _retry(fn, opt) {
    opt = opt || {};
    var retries = opt.retry || 1;
    var interval = opt.interval || 500;
    for (var i = 0; i < retries; i++) {
        if (i > 0) sleep(interval);
        try {
            var result = fn(_getHandler());
            if (result) return result;
        } catch(e) {
            _floaty.e("尝试 " + (i+1) + "/" + retries + " 失败: " + e.message);
        }
    }
    return null;
}

// ==================== 找色功能 ====================

/**
 * 多点找色 — 根据多个点的颜色关系定位目标，找到后自动点击
 *
 * 适合：按钮、图标、固定 UI 元素
 * 比单点找色更稳定，因为同时校验多个点的颜色关系
 *
 * @param {string}  firstColor   首点颜色
 *                                格式："#AABBCC" 或 "#AABBCC-0x101010"（带偏差）
 *                                格式："0xCDD7E9-0x101010"
 * @param {string}  colorMulti   偏移点颜色，相对于首点的偏移坐标
 *                                格式："dx|dy|#颜色,dx|dy|#颜色,..."
 *                                示例："28|14|#E84B32-0x101010,50|23|#AC2726-0x101010"
 * @param {object}  [opt]        可选参数
 * @param {number}  [opt.threshold=0.9]   匹配度，0~1，越大越严格
 * @param {boolean} [opt.click=true]      找到后是否自动点击
 * @param {number}  [opt.retry=1]         没找到重试几次
 * @param {number}  [opt.interval=500]    每次重试间隔(毫秒)
 * @param {number}  [opt.sx]              搜索区域起点X，默认0（全屏）
 * @param {number}  [opt.sy]              搜索区域起点Y，默认0
 * @param {number}  [opt.ex]              搜索区域终点X，默认0（全屏）
 * @param {number}  [opt.ey]              搜索区域终点Y，默认0
 * @param {number}  [opt.direction=1]     扫描方向 1~8，默认1（从左到右）
 *
 * @returns {{x:number, y:number}|null}  找到返回坐标，没找到返回 null
 *
 * @example
 *   // 基本用法 — 找到就点击
 *   finder.findColor("#C7A1A1-0x101010", "28|14|#E84B32-0x101010");
 *
 *   @example
 *   // 只检测不点击
 *   finder.findColor("#C7A1A1-0x101010", "...", { click: false });
 *
 *   @example
 *   // 限定搜索区域 + 降低匹配度
 *   finder.findColor("#C7A1A1", "...", {
 *     threshold: 0.8,
 *     sx: 100, sy: 200, ex: 500, ey: 600
 *   });
 */
function findColor(firstColor, colorMulti, opt) {
    opt = opt || {};
    var clickFlag = opt.click !== false;
    return _retry(function(h) {
        var mat = h.captureScreenMat();
        if (!mat) return null;
        try {
            var pts = h.findMultiColor(mat, firstColor, colorMulti,
                opt.threshold || 0.9,
                opt.sx || 0, opt.sy || 0, opt.ex || 0, opt.ey || 0,
                1, opt.direction || 1);
            if (pts && pts.length > 0) {
                var p = pts[0];
                if (clickFlag) _click(p.x, p.y);
                return { x: p.x, y: p.y };
            }
            return null;
        } finally { _recycle(mat); }
    }, opt);
}

/**
 * 单点找色 — 只根据一个颜色找目标，找到后自动点击
 *
 * 适合：颜色独特、背景简单的情况
 * 注意：如果背景有相似颜色容易误判，建议用 findColor（多点找色）更稳定
 *
 * @param {string}  color         颜色
 *                                 格式："#00FF00" 或 "0xCDD7E9-0x101010"
 * @param {object}  [opt]         参数同 findColor
 * @returns {{x:number, y:number}|null}
 *
 * @example
 *   finder.findSingleColor("#00FF00");                    // 找绿色并点击
 *   finder.findSingleColor("#00FF00", { click: false });  // 只检测不点击
 */
function findSingleColor(color, opt) {
    opt = opt || {};
    var clickFlag = opt.click !== false;
    return _retry(function(h) {
        var mat = h.captureScreenMat();
        if (!mat) return null;
        try {
            var pts = h.findColor(mat, color,
                opt.threshold || 0.9,
                opt.sx || 0, opt.sy || 0, opt.ex || 0, opt.ey || 0,
                1, opt.direction || 1);
            if (pts && pts.length > 0) {
                var p = pts[0];
                if (clickFlag) _click(p.x, p.y);
                return { x: p.x, y: p.y };
            }
            return null;
        } finally { _recycle(mat); }
    }, opt);
}

/**
 * 单点比色 — 判断屏幕上某个颜色是否存在，不点击
 *
 * 跟 findSingleColor 的区别：
 *   - 内部使用 cmpColor（比色），效率更高
 *   - 不返回坐标，只返回 true/false
 *   - 适合快速判断界面状态
 *
 * @param {string}  color         颜色
 * @param {object}  [opt]         可选参数
 * @param {number}  [opt.threshold=0.9]   匹配度
 * @param {number}  [opt.retry=1]         重试次数
 * @param {number}  [opt.interval=500]    重试间隔
 * @returns {boolean}  true=颜色存在
 *
 * @example
 *   if (finder.cmpColor("#C7A1A1-0x101010")) {
 *       // 颜色出现了，可以做其他操作
 *   }
 */
function cmpColor(color, opt) {
    opt = opt || {};
    return !!_retry(function(h) {
        var mat = h.captureScreenMat();
        if (!mat) return null;
        try {
            if (h.cmpColor(mat, color, opt.threshold || 0.9)) { return true; }
            return null;
        } finally { _recycle(mat); }
    }, opt);
}

// ==================== 找图功能 ====================

/**
 * 模板匹配找图 — 用模板图片在大图中找相同位置，找到后自动点击
 *
 * 适合：固定按钮、固定图标
 * 注意：模板图片放在 ./res/images/ 目录下
 *       传文件名时可以不写路径和后缀，会自动拼接
 *
 * @param {string}  templateName  模板图片名
 *                                 传 "关闭按钮" 自动 → "./res/images/关闭按钮.png"
 *                                 传完整路径也可以 "./res/images/xx.png"
 * @param {object}  [opt]         可选参数
 * @param {number}  [opt.threshold=0.9]   匹配度，0~1
 * @param {number}  [opt.resize=0.5]      大图缩放倍数，0.5=缩小一倍（提速）
 * @param {boolean} [opt.click=true]      找到后是否点击
 * @param {number}  [opt.retry=1]         重试次数
 * @param {number}  [opt.interval=500]    重试间隔
 * @param {number}  [opt.sx~opt.ey]       搜索区域，默认全屏
 *
 * @returns {{x:number, y:number}|null}
 *
 * @example
 *   finder.findImg("关闭按钮");                    // 找关闭按钮并点击
 *   finder.findImg("升级.png", { threshold: 0.85 });  // 降低匹配度
 */
function findImg(templateName, opt) {
    opt = opt || {};
    var path = _smartPath(templateName);
    if (!path) { _floaty.e("findImg 模板名称为空"); return null; }
    var clickFlag = opt.click !== false;
    return _retry(function(h) {
        var temp = h.readResMat(path);
        if (!temp) { _floaty.e("模板图不存在: " + path); return null; }
        var mat = h.captureScreenMat();
        if (!mat) { _recycle(temp); return null; }
        try {
            var rects = h.findImg(mat, temp,
                opt.resize || 0.5, opt.threshold || 0.9,
                opt.sx || 0, opt.sy || 0, opt.ex || 0, opt.ey || 0,
                1, null);
            if (rects && rects.length > 0) {
                var r = rects[0];
                var cx = r.left + (r.width ? r.width/2 : (r.right - r.left)/2);
                var cy = r.top + (r.height ? r.height/2 : (r.bottom - r.top)/2);
                if (clickFlag) _click(Math.round(cx), Math.round(cy));
                _floaty.d("找到 " + templateName);
                return { x: Math.round(cx), y: Math.round(cy) };
            }
            return null;
        } finally { _recycle(mat, temp); }
    }, opt);
}

/**
 * SURF 全分辨率找图 — 基于特征点匹配，找到后自动点击
 *
 * 跟 findImg 的区别：
 *   - findImg：像素级对比，速度快，但图片缩放/旋转后可能找不到
 *   - findImgBySurf：特征点匹配，图片放大缩小旋转都能找到，速度慢一些
 *
 * 适合：3D 建筑、会旋转的物体、不同分辨率下的同一目标
 *
 * @param {string}  templateName          模板图片名
 * @param {object}  [opt]                 可选参数
 * @param {number}  [opt.threshold=0.6]   匹配度，0~1（SURF 默认 0.6，比模板匹配低）
 * @param {number}  [opt.resize=1.0]      大图缩放，1.0=不缩放
 * @param {number}  [opt.tempResize=1.0]  小图缩放，1.0=不缩放
 * @param {boolean} [opt.click=true]      找到后是否点击
 * @param {number}  [opt.retry=1]         重试次数
 * @param {number}  [opt.interval=500]    重试间隔
 * @param {number}  [opt.sx~opt.ey]       搜索区域
 *
 * @returns {{x:number, y:number}|null}
 *
 * @example
 *   finder.findImgBySurf("司令部");              // 找建筑并点击
 *   finder.findImgBySurf("野怪", { threshold: 0.5 });  // 降低要求
 */
function findImgBySurf(templateName, opt) {
    opt = opt || {};
    var path = _smartPath(templateName);
    if (!path) { _floaty.e("findImgBySurf 模板名称为空"); return null; }
    var clickFlag = opt.click !== false;
    return _retry(function(h) {
        var temp = h.readResMat(path);
        if (!temp) { _floaty.e("模板图不存在: " + path); return null; }
        var mat = h.captureScreenMat();
        if (!mat) { _recycle(temp); return null; }
        try {
            var pts = h.findImgBySurf(mat, temp,
                opt.resize || 1.0, opt.tempResize || 1.0,
                opt.sx || 0, opt.sy || 0, opt.ex || 0, opt.ey || 0,
                opt.threshold || 0.6, true);
            if (pts && pts.length >= 4) {
                var cx = 0, cy = 0;
                for (var i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
                cx = Math.round(cx / pts.length);
                cy = Math.round(cy / pts.length);
                if (clickFlag) _click(cx, cy);
                _floaty.d("SURF 找到 " + templateName);
                return { x: cx, y: cy };
            }
            return null;
        } finally { _recycle(mat, temp); }
    }, opt);
}

// ==================== 等待（超时循环） ====================

/**
 * 等待颜色出现 — 循环检测直到超时，出现则点击
 *
 * 跟 findColor 的区别：
 *   findColor 只试一次或指定的重试次数
 *   waitForColor 固定循环直到超时，适合等动画/弹窗
 *
 * @param {string}  firstColor       首点颜色
 * @param {string}  colorMulti       偏移颜色
 * @param {number}  [timeout=5000]   超时毫秒
 * @param {number}  [interval=500]   每次检测间隔
 * @param {object}  [opt]            其他参数同 findColor
 * @returns {{x:number, y:number}|null}
 *
 * @example
 *   // 等弹窗出现（最多等5秒）
 *   finder.waitForColor("#C7A1A1", "28|14|#E84B32", 5000);
 */
function waitForColor(firstColor, colorMulti, timeout, interval, opt) {
    timeout = timeout || 5000;
    interval = interval || 500;
    var deadline = Date.now() + timeout;
    opt = opt || {};
    opt.retry = 1;
    opt.interval = 100;
    while (Date.now() < deadline) {
        var r = findColor(firstColor, colorMulti, opt);
        if (r) return r;
        sleep(interval);
    }
    return null;
}

/**
 * 等待图片出现 — 循环检测直到超时，出现则点击
 * @param {string}  templateName     模板图片名
 * @param {number}  [timeout=5000]   超时毫秒
 * @param {number}  [interval=500]   检测间隔
 * @param {object}  [opt]            其他参数同 findImg
 * @returns {{x:number, y:number}|null}
 */
function waitForImg(templateName, timeout, interval, opt) {
    timeout = timeout || 5000;
    interval = interval || 500;
    var deadline = Date.now() + timeout;
    opt = opt || {};
    opt.retry = 1;
    opt.interval = 100;
    while (Date.now() < deadline) {
        var r = findImg(templateName, opt);
        if (r) return r;
        sleep(interval);
    }
    return null;
}

/**
 * 等待 SURF 图片出现 — 循环检测直到超时
 * @param {string}  templateName     模板图片名
 * @param {number}  [timeout=5000]   超时毫秒
 * @param {number}  [interval=500]   检测间隔
 * @param {object}  [opt]            其他参数同 findImgBySurf
 * @returns {{x:number, y:number}|null}
 */
function waitForImgBySurf(templateName, timeout, interval, opt) {
    timeout = timeout || 5000;
    interval = interval || 500;
    var deadline = Date.now() + timeout;
    opt = opt || {};
    opt.retry = 1;
    opt.interval = 100;
    while (Date.now() < deadline) {
        var r = findImgBySurf(templateName, opt);
        if (r) return r;
        sleep(interval);
    }
    return null;
}

// ==================== 纯检测（不点击） ====================

/**
 * 检测颜色是否存在（不点击）
 * @returns {boolean}
 */
function checkColor(firstColor, colorMulti, opt) {
    opt = opt || {};
    opt.click = false;
    return !!findColor(firstColor, colorMulti, opt);
}

/**
 * 检测图片是否存在（不点击）
 * @returns {boolean}
 */
function checkImg(templateName, opt) {
    opt = opt || {};
    opt.click = false;
    return !!findImg(templateName, opt);
}

/**
 * 检测 SURF 图片是否存在（不点击）
 * @returns {boolean}
 */
function checkImgBySurf(templateName, opt) {
    opt = opt || {};
    opt.click = false;
    return !!findImgBySurf(templateName, opt);
}

// ==================== 配置化（color.json） ====================

var _configCache = null;

/**
 * 读取 color.json 配置文件
 * 文件路径：./res/images/color.json
 * 读取后缓存，多次调用不会重复读文件
 */
function _loadConfig() {
    if (_configCache) return _configCache;
    try {
        var str = $file.read("./res/images/color.json");
        if (str) {
            _configCache = JSON.parse(str);
            return _configCache;
        }
    } catch(e) {
        _floaty.e("读取 color.json 失败: " + e.message);
    }
    return null;
}

/**
 * 从 color.json 配置执行多点找色
 *
 * 适合把常用的找色参数写在配置文件里，不用在代码里重复写颜色值
 *
 * color.json 格式：
 *   {
 *     "配置名": ["首点颜色", "偏移颜色", 相似度, sx, sy, ex, ey, count, direction]
 *   }
 *
 * @param {string}  name              配置名称
 * @param {object}  [opt]             可选参数
 * @param {boolean} [opt.click=true]  找到后是否点击
 * @param {number}  [opt.retry=10]    重试次数
 * @param {number}  [opt.interval=500] 重试间隔
 * @returns {boolean}
 *
 * @example
 *   // color.json:
 *   // { "主页": ["#C7A1A1-0x101010", "28|14|#E84B32-0x101010", 0.9, 0,0,0,0,1,1] }
 *   finder.findMultiColorx("主页");
 */
function findMultiColorx(name, opt) {
    opt = opt || {};
    var cfg = _loadConfig();
    if (!cfg || !cfg[name]) { _floaty.e("配置不存在: " + name); return false; }

    var arr = cfg[name];
    var firstColor, colorMulti, threshold, sx, sy, ex, ey, count, direction;
    if (typeof arr === 'string') {
        firstColor = arr;
        colorMulti = "";
        threshold = 0.9;
        sx = sy = ex = ey = 0;
        count = 1; direction = 1;
    } else if (Array.isArray(arr) && arr.length >= 2) {
        firstColor = arr[0];
        colorMulti = arr[1];
        threshold = arr.length > 2 ? arr[2] : 0.9;
        sx = arr.length > 3 ? arr[3] : 0;
        sy = arr.length > 4 ? arr[4] : 0;
        ex = arr.length > 5 ? arr[5] : 0;
        ey = arr.length > 6 ? arr[6] : 0;
        count = arr.length > 7 ? arr[7] : 1;
        direction = arr.length > 8 ? arr[8] : 1;
    } else {
        _floaty.e("配置格式错误: " + name);
        return false;
    }

    var r = findColor(firstColor, colorMulti, {
        threshold: threshold, sx: sx, sy: sy, ex: ex, ey: ey,
        direction: direction,
        click: opt.click !== false,
        retry: opt.retry || 10,
        interval: opt.interval || 500
    });

    _floaty.d((r ? "找到 --> " : "未找到 --> ") + name);
    return !!r;
}

/**
 * 从 color.json 配置执行单点找色
 *
 * color.json 格式：
 *   { "配置名": ["颜色", 相似度, sx, sy, ex, ey, count, direction] }
 *   或 { "配置名": "#颜色" }  （简化写法）
 *
 * @param {string}  name              配置名称
 * @param {object}  [opt]             同 findMultiColorx
 * @returns {boolean}
 */
function findColorx(name, opt) {
    opt = opt || {};
    var cfg = _loadConfig();
    if (!cfg || !cfg[name]) { _floaty.e("配置不存在: " + name); return false; }

    var arr = cfg[name];
    var color, threshold, sx, sy, ex, ey, count, direction;

    if (typeof arr === 'string') {
        color = arr; threshold = 0.9;
        sx = sy = ex = ey = 0;
        count = 1; direction = 1;
    } else if (Array.isArray(arr) && arr.length >= 1) {
        color = arr[0];
        threshold = arr.length > 1 ? arr[1] : 0.9;
        sx = arr.length > 2 ? arr[2] : 0;
        sy = arr.length > 3 ? arr[3] : 0;
        ex = arr.length > 4 ? arr[4] : 0;
        ey = arr.length > 5 ? arr[5] : 0;
        count = arr.length > 6 ? arr[6] : 1;
        direction = arr.length > 7 ? arr[7] : 1;
    } else {
        _floaty.e("配置格式错误: " + name);
        return false;
    }

    var r = findSingleColor(color, {
        threshold: threshold, sx: sx, sy: sy, ex: ex, ey: ey,
        direction: direction,
        click: opt.click !== false,
        retry: opt.retry || 10,
        interval: opt.interval || 500
    });

    _floaty.d((r ? "找到 --> " : "未找到 --> ") + name);
    return !!r;
}

/**
 * 从 color.json 配置执行单点比色
 *
 * 如果颜色字符串包含坐标（格式 "x|y|#颜色"），
 * 找到后可以自动点击该坐标
 *
 * color.json 格式：
 *   { "配置名": ["颜色", 相似度] }
 *   或 { "配置名": "x|y|#颜色" }  （含坐标，可自动点击）
 *
 * @param {string}  name              配置名称
 * @param {object}  [opt]
 * @param {boolean} [opt.click=false] 找到后是否自动点击（需要颜色含坐标）
 * @param {number}  [opt.retry=10]
 * @param {number}  [opt.interval=500]
 * @returns {boolean}
 *
 * @example
 *   // color.json 含坐标：{ "采集按钮": "500|800|#00FF00" }
 *   finder.cmpColorx("采集按钮", { click: true });  // 找到颜色并点击 (500,800)
 */
function cmpColorx(name, opt) {
    opt = opt || {};
    var cfg = _loadConfig();
    if (!cfg || !cfg[name]) { _floaty.e("配置不存在: " + name); return false; }

    var arr = cfg[name];
    var color, threshold;
    if (typeof arr === 'string') {
        color = arr; threshold = 0.9;
    } else if (Array.isArray(arr) && arr.length >= 1) {
        color = arr[0];
        threshold = arr.length > 1 ? arr[1] : 0.9;
    } else {
        _floaty.e("配置格式错误: " + name);
        return false;
    }

    // 从颜色字符串提取坐标（格式："x|y|#颜色"）
    var clickCoord = null;
    if (typeof color === 'string' && color.indexOf('|') >= 0) {
        var parts = color.split('|');
        if (parts.length >= 2) {
            var cx = parseInt(parts[0]);
            var cy = parseInt(parts[1]);
            if (!isNaN(cx) && !isNaN(cy)) { clickCoord = { x: cx, y: cy }; }
        }
    }

    var r = cmpColor(color, {
        threshold: threshold,
        retry: opt.retry || 10,
        interval: opt.interval || 500
    });

    if (r && opt.click && clickCoord) {
        _click(clickCoord.x, clickCoord.y);
    }

    _floaty.d((r ? "找到 --> " : "未找到 --> ") + name);
    return r;
}

// ==================== 导出 ====================

var api = {

    // ── 找色 ──
    findColor: findColor,           // 多点找色+点击
    findSingleColor: findSingleColor, // 单点找色+点击
    cmpColor: cmpColor,             // 单点比色（不点击）
    waitForColor: waitForColor,     // 等待颜色出现
    checkColor: checkColor,         // 检测颜色是否存在

    // ── 找图 ──
    findImg: findImg,               // 模板匹配+点击
    findImgBySurf: findImgBySurf,   // SURF全分辨率+点击
    waitForImg: waitForImg,         // 等待图片出现
    waitForImgBySurf: waitForImgBySurf,
    checkImg: checkImg,             // 检测图片是否存在
    checkImgBySurf: checkImgBySurf,

    // ── 配置化 ──
    findMultiColorx: findMultiColorx, // 从color.json读取多点找色
    findColorx: findColorx,           // 从color.json读取单点找色
    cmpColorx: cmpColorx              // 从color.json读取比色
};

api;
