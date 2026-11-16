/**
 * 声纳校准 —— 核心逻辑（不依赖界面，可单独测试）
 *
 * ── 干什么 ──
 *   1. 管理「海域 → 四角坐标」的存取（res/sonar_points.json）
 *   2. 把 四角 + n² 个格中心 + 手柄 合成到截图上，供界面显示
 *   3. 触摸坐标（界面像素）→ 图片坐标（1280×720）的换算
 *   4. 找离手指最近的角、校验四角是否合法
 *
 * ── 为什么用「合成图」而不是全屏绘制 ──
 *   把框直接画进图片里，框和图片天然对齐、零坐标误差，也不受控件缩放影响。
 *   代价是每次要重新合成，所以拖动时节流（见 calibTick）。
 *
 * ── 内存 ──
 *   插件会自己追踪它生成的所有 Mat：
 *     readMat() 读进来的「原图」归我们管 → 用 h.recycle(mat) 释放
 *     绘图产生的中间 Mat 全归插件管  → 用 h.recyclePartMat() 一次性释放
 *
 * ── 四角顺序（全项目统一）──
 *   上(top) → 右(right) → 下(bottom) → 左(left)
 */

var geometry = require("./geometry.js");
var levels = require("./levels.js");

// AutoGOD 的 $log / $file 是全局对象；离线用 node 跑单测时不存在，所以包一层。
function _err(msg) {
    try { if (typeof $log !== "undefined" && $log) { $log.e(msg); } } catch (e) {}
}
function _info(msg) {
    try { if (typeof $log !== "undefined" && $log) { $log.i(msg); } } catch (e) {}
}
function _hasFile() {
    return (typeof $file !== "undefined" && $file);
}

// ==================== 路径 ====================

var BG_DIR        = "./res/sonar_bg";            // 海域截图目录：<海域号>.png
var POINTS_PATH   = "./res/sonar_points.json";   // 标定结果
var PREVIEW_PATH  = "./res/_calib_preview.png";  // 界面显示的合成图（每次覆盖）
var CHECK_DIR     = "./res/sonar_check";         // 核对图目录

// 参考画面尺寸（游戏横屏时的实际截图尺寸）
var REF_W = 1280;
var REF_H = 720;

// 手柄半径（图片像素）
var HANDLE_R = 14;

// ==================== 标定数据存取 ====================

/** 读标定数据；文件不存在或坏了都返回空结构 */
function loadPoints() {
    var empty = { version: 1, screen: [REF_W, REF_H], areas: {} };
    try {
        if (!$file.exists(POINTS_PATH)) { return empty; }
        var txt = $file.read(POINTS_PATH);
        if (!txt || txt.length < 2) { return empty; }
        var d = JSON.parse(txt);
        if (!d || !d.areas) { return empty; }
        return d;
    } catch (e) {
        _err("读标定数据失败: " + e.message);
        return empty;
    }
}

/** 写标定数据 */
function savePoints(d) {
    try {
        var dir = POINTS_PATH.replace(/\/[^\/]*$/, "");
        if (!$file.exists(dir)) { $file.mkdir(dir); }
        $file.write(JSON.stringify(d, null, 2), POINTS_PATH);
        return true;
    } catch (e) {
        _err("写标定数据失败: " + e.message);
        return false;
    }
}

/** 取某海域已保存的四角，没有返回 null */
function getSavedQuad(area) {
    var d = loadPoints();
    var a = d.areas[String(area)];
    if (!a || !a.quad) { return null; }
    // 深拷贝，防止调用方改坏缓存
    return a.quad.map(function (p) { return [p[0], p[1]]; });
}

/** 取某海域保存的完整记录（含 n / 格中心） */
function getSavedArea(area) {
    var d = loadPoints();
    return d.areas[String(area)] || null;
}

/**
 * 保存某海域的四角，同时算出 n² 个格中心一起存进去
 * @param {number} area   海域号
 * @param {number[][]} quad 四角（上→右→下→左）
 * @param {string} source 'manual' | 'builtin' | 'copied'
 * @returns {boolean}
 */
function setSavedQuad(area, quad, source) {
    var levels = require("./levels.js");
    var n = levels.gridSizeOf(area);
    if (!n) { $log.e("海域号非法: " + area); return false; }

    var pts = [];
    try {
        var bc = geometry.boardCenters(quad, n);
        for (var i = 0; i < bc.centers.length; i++) {
            pts.push([Math.round(bc.centers[i][0]), Math.round(bc.centers[i][1])]);
        }
    } catch (e) {
        _err("算格中心失败: " + e.message);
        return false;
    }

    var d = loadPoints();
    d.areas[String(area)] = {
        n: n,
        quad: quad.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; }),
        points: pts,
        source: source || "manual",
        savedAt: nowStr()
    };
    return savePoints(d);
}

/** 删除某海域的标定 */
function removeSavedQuad(area) {
    var d = loadPoints();
    if (d.areas[String(area)]) {
        delete d.areas[String(area)];
        return savePoints(d);
    }
    return true;
}

/** 当前时间字符串 */
function nowStr() {
    var d = new Date();
    function p(v) { return (v < 10 ? "0" : "") + v; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
           p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

// ==================== 四角解析 ====================

/**
 * 取某海域该用哪个四角
 * 优先顺序：用户标定 → 内置数据
 * @returns {{quad:number[][]|null, source:string}}
 *          source: 'saved' | 'builtin' | 'none'
 */
function resolveQuad(area) {
    var q = getSavedQuad(area);
    if (q) { return { quad: q, source: "saved" }; }

    var levels = require("./levels.js");
    var b = levels.builtinQuadOf(area);
    if (b) { return { quad: b, source: "builtin" }; }

    return { quad: null, source: "none" };
}

/**
 * 把某海域的四角复制给所有「同尺寸」的其他海域
 * 依据：海域 8~70 的棋盘位置完全相同，标一个顶六十多个
 * @returns {number[]} 被写入的海域号列表
 */
function applyToSameSize(fromArea, quad) {
    var levels = require("./levels.js");
    var n = levels.gridSizeOf(fromArea);
    if (!n) { return []; }

    var d = loadPoints();
    var touched = [];
    var pts = null;
    try {
        var bc = geometry.boardCenters(quad, n);
        pts = bc.centers.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; });
    } catch (e) {
        _err("算格中心失败: " + e.message);
        return [];
    }

    var q = quad.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; });
    for (var a = 1; a <= levels.MAX_AREA; a++) {
        if (a === fromArea) { continue; }
        if (levels.gridSizeOf(a) !== n) { continue; }
        d.areas[String(a)] = {
            n: n, quad: q, points: pts,
            source: "copied", from: fromArea, savedAt: nowStr()
        };
        touched.push(a);
    }
    if (touched.length) { savePoints(d); }
    return touched;
}

// ==================== 坐标换算 ====================

/**
 * 触摸坐标（相对控件的界面像素）→ 图片坐标（1280×720）
 *
 * 前提：<img> 用 scaleType="fitxy" 铺满控件，所以是线性映射。
 * 控件实际显示尺寸从 view.getW()/getH() 取，不写死。
 *
 * @param {number} evX    event.getX()
 * @param {number} evY    event.getY()
 * @param {number} viewW  view.getW()
 * @param {number} viewH  view.getH()
 * @param {number} imgW   图片实际宽（一般 1280）
 * @param {number} imgH   图片实际高（一般 720）
 * @returns {number[]} [x, y] 图片坐标（已夹到图片范围内）
 */
function touchToImage(evX, evY, viewW, viewH, imgW, imgH) {
    if (!viewW || !viewH) { return [0, 0]; }
    var x = evX * imgW / viewW;
    var y = evY * imgH / viewH;
    return [clamp(x, 0, imgW - 1), clamp(y, 0, imgH - 1)];
}

function clamp(v, lo, hi) {
    if (v < lo) { return lo; }
    if (v > hi) { return hi; }
    return v;
}

/**
 * 找离给定点最近的那个角
 * @param {number[][]} quad 四角
 * @param {number} x
 * @param {number} y
 * @param {number} maxDist 超过这个距离就认为没点中任何角
 * @returns {number} 角下标 0~3，没点中返回 -1
 */
function nearestCorner(quad, x, y, maxDist) {
    var best = -1, bestD = maxDist;
    for (var i = 0; i < quad.length; i++) {
        var d = Math.hypot(quad[i][0] - x, quad[i][1] - y);
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

// ==================== 校验 ====================

/**
 * 保存前的校验：四角是否合理
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validateForSave(quad, n, imgW, imgH) {
    var res = geometry.validateQuad(quad, imgW || REF_W, imgH || REF_H);
    var errors = res.errors.slice();
    var warnings = res.warnings.slice();

    if (n && n >= 2) {
        // 每格不能太小，否则点不准
        try {
            var bc = geometry.boardCenters(quad, n);
            var cs = geometry.cellSizes(bc.H, n);
            if (cs.avgW < 14 || cs.avgH < 14) {
                errors.push("格子太小（平均 " + Math.round(cs.avgW) + "×" + Math.round(cs.avgH) +
                            " 像素），四角可能画得太小或画反了");
            }
            if (cs.avgW > 400 || cs.avgH > 400) {
                errors.push("格子太大（平均 " + Math.round(cs.avgW) + "×" + Math.round(cs.avgH) +
                            " 像素），四角可能画错了");
            }
        } catch (e) {
            errors.push("算格中心失败: " + e.message);
        }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

// ==================== 合成预览图 ====================

/**
 * 把 四角 + 格中心 + 手柄 + 标签 画到截图上，另存为预览图
 *
 * @param {object} h       OperHandler 实例（图色插件）
 * @param {string} bgPath  背景截图路径（不存在则用纯色底）
 * @param {number[][]} quad 四角（上→右→下→左）
 * @param {number} n       棋盘边长
 * @param {string} outPath 输出路径
 * @param {number} hlCorner 高亮的角下标（-1 表示不高亮）
 * @returns {string|null}  成功返回 outPath，失败返回 null
 */
function composePreview(h, bgPath, quad, n, outPath, hlCorner) {
    var levels = require("./levels.js");
    var src = null;
    try {
        // 1) 底图：有截图就用截图，没有就造一张深色底
        if (bgPath && $file.exists(bgPath)) {
            src = h.readMat(bgPath);
        }
        if (!src) {
            src = h.createMat(REF_W, REF_H, "#102030");
        }
        if (!src) {
            _err("合成预览失败：拿不到底图");
            return null;
        }

        var imgW = safeInt(function () { return src.cols(); }, REF_W);
        var imgH = safeInt(function () { return src.rows(); }, REF_H);

        // 2) 把四角按图片实际尺寸缩放（万一截图不是 1280×720）
        var sx = imgW / REF_W, sy = imgH / REF_H;
        var q = quad.map(function (p) { return [p[0] * sx, p[1] * sy]; });

        var cur = src;

        // 3) 画菱形框（注意：插件要求点是 {x,y} 对象，不是 [x,y] 数组）
        var pts = q.map(function (p) { return { x: Math.round(p[0]), y: Math.round(p[1]) }; });
        var t = h.drawLines2(cur, pts, "#FFFF00", 3, true);
        if (t) { cur = t; }

        // 4) 画 n² 个格中心
        var centers = null;
        try {
            var bc = geometry.boardCenters(quad, n);
            centers = bc.centers;
        } catch (e) {
            centers = null;
        }
        if (centers) {
            for (var i = 0; i < centers.length; i++) {
                var cx = centers[i][0] * sx, cy = centers[i][1] * sy;
                t = h.drawCircle(cur, Math.round(cx), Math.round(cy), 3, "#00FFFF", -1, 8);
                if (t) { cur = t; }
            }
        }

        // 5) 画 4 个角手柄 + 中文标签
        for (var c = 0; c < q.length; c++) {
            var col = levels.CORNER_COLORS[c] || "#FFFFFF";
            var r = (c === hlCorner) ? HANDLE_R + 5 : HANDLE_R;
            t = h.drawCircle(cur, Math.round(q[c][0]), Math.round(q[c][1]), r, col, 4, 8);
            if (t) { cur = t; }
            t = h.putText(cur, Math.round(q[c][0]) + 20, Math.round(q[c][1]) - 20,
                          levels.CORNER_NAMES[c] || "", col, 1.6);
            if (t) { cur = t; }
        }

        // 6) 存盘
        var dir = outPath.replace(/\/[^\/]*$/, "");
        if (!$file.exists(dir)) { $file.mkdir(dir); }
        h.saveMat(cur, outPath, "png", 100);

        return outPath;

    } catch (e) {
        _err("合成预览图出错: " + e.message);
        return null;

    } finally {
        // 原图归我们管；绘图中间产物由插件统一回收
        try { if (src) { h.recycle(src); } } catch (e2) {}
        try { h.recyclePartMat(); } catch (e3) {}
    }
}

/** 安全取整数（属性取不到时用兜底值） */
function safeInt(fn, dflt) {
    try {
        var v = fn();
        if (typeof v === "number" && v > 0) { return v; }
    } catch (e) {}
    return dflt;
}

/**
 * 生成一张「核对图」永久保存（不会每次覆盖），供事后查看
 * @returns {string|null}
 */
function makeCheckImage(h, area) {
    var levels = require("./levels.js");
    var r = resolveQuad(area);
    if (!r.quad) { return null; }
    var n = levels.gridSizeOf(area);
    var out = CHECK_DIR + "/" + area + ".png";
    return composePreview(h, bgPathOf(area), r.quad, n, out, -1);
}

// ==================== 截图路径 ====================

/** 某海域的截图路径 */
function bgPathOf(area) {
    return BG_DIR + "/" + area + ".png";
}

/** 某海域是否已有截图 */
function hasBg(area) {
    try { return $file.exists(bgPathOf(area)); } catch (e) { return false; }
}

/** 保存一张截图给指定海域（传入截屏 Mat） */
function saveBgFromMat(h, area, mat) {
    try {
        if (!$file.exists(BG_DIR)) { $file.mkdir(BG_DIR); }
        h.saveMat(mat, bgPathOf(area), "png", 100);
        return true;
    } catch (e) {
        _err("保存海域截图失败: " + e.message);
        return false;
    }
}

/** 删除某海域的截图 */
function removeBg(area) {
    try {
        if ($file.exists(bgPathOf(area))) { $file.del(bgPathOf(area)); }
        return true;
    } catch (e) {
        return false;
    }
}

/** 列出已有截图的海域号 */
function listBgAreas() {
    var out = [];
    try {
        if (!$file.exists(BG_DIR)) { return out; }
        var files = $file.ls(BG_DIR);
        for (var i = 0; i < files.length; i++) {
            var m = /^(\d+)\.png$/i.exec(files[i]);
            if (m) { out.push(parseInt(m[1], 10)); }
        }
    } catch (e) {}
    out.sort(function (a, b) { return a - b; });
    return out;
}

// ==================== 导出 ====================

var calib = {
    // 路径常量
    BG_DIR: BG_DIR,
    POINTS_PATH: POINTS_PATH,
    PREVIEW_PATH: PREVIEW_PATH,
    CHECK_DIR: CHECK_DIR,
    REF_W: REF_W,
    REF_H: REF_H,

    // 数据存取
    loadPoints: loadPoints,
    savePoints: savePoints,
    getSavedQuad: getSavedQuad,
    getSavedArea: getSavedArea,
    setSavedQuad: setSavedQuad,
    removeSavedQuad: removeSavedQuad,
    resolveQuad: resolveQuad,
    applyToSameSize: applyToSameSize,

    // 坐标
    touchToImage: touchToImage,
    nearestCorner: nearestCorner,
    clamp: clamp,

    // 校验
    validateForSave: validateForSave,

    // 合成
    composePreview: composePreview,
    makeCheckImage: makeCheckImage,

    // 截图
    bgPathOf: bgPathOf,
    hasBg: hasBg,
    saveBgFromMat: saveBgFromMat,
    removeBg: removeBg,
    listBgAreas: listBgAreas,

    // 杂项
    nowStr: nowStr
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = calib;
}

calib;
