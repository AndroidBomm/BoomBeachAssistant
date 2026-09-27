/**
 * 声呐棋盘坐标换算 —— 地基模块
 *
 * ── 为什么必须自己实现 ──
 * 图色插件只有 warpPerspective(img, src4, dst4)，它能变换【图像】，
 * 但**不能变换【点坐标】**（没有 getPerspectiveTransform / perspectiveTransform）。
 * 而我们需要把「棋盘 4 个外角」换算成 n×n 个格子的屏幕点击坐标，
 * 所以必须自己算 3×3 单应矩阵。
 *
 * ── 什么是单应矩阵 ──
 * 棋盘在游戏里是一个透视投影的正方形（菱形）。逻辑坐标 (0,0)~(n,n)
 * 到屏幕坐标是一个「平面到平面」的投影变换，用 3×3 矩阵 H 表示：
 *
 *     [u]       [x]           u = (h11*x + h12*y + h13) / (h31*x + h32*y + 1)
 *     [v] = H · [y]           v = (h21*x + h22*y + h23) / (h31*x + h32*y + 1)
 *     [w]       [1]
 *
 * 4 组对应点可以确定 8 个未知数（h33 固定为 1），解一个 8 元一次方程组。
 *
 * ── 四角顺序（全项目统一，不可改）──
 *     上(top) → 右(right) → 下(bottom) → 左(left)
 *
 *     对应逻辑坐标 (0,0) → (n,0) → (n,n) → (0,n)
 *
 * ── 已验证的参考数据（来自 lwt15556/boom v1.1.0）──
 *   10 关: (664,48) (1069,288) (671,625) (259,290)  → 单格约 81 × 57.7 px
 *    1 关: (666,247) (786,329) (662,420) (543,327)  → 单格仍是 81 px（与关卡无关）
 */

// ==================== 内部：线性方程组求解 ====================

/**
 * 高斯-约当消元解 8 元一次方程组
 * @param {number[][]} A 8×8 系数矩阵
 * @param {number[]} b 8 个常数项
 * @returns {number[]} 8 个解
 */
function _solve8(A, b) {
    var n = 8;
    var m = [];
    var i, j, k;

    // 构造增广矩阵
    for (i = 0; i < n; i++) {
        m.push(A[i].concat([b[i]]));
    }

    for (var col = 0; col < n; col++) {
        // 选主元（取绝对值最大的行，提高数值稳定性）
        var piv = col;
        for (var r = col + 1; r < n; r++) {
            if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
        }
        if (Math.abs(m[piv][col]) < 1e-12) {
            throw new Error('单应矩阵求解失败：4 个点退化（共线或重合）');
        }
        if (piv !== col) { var tmp = m[col]; m[col] = m[piv]; m[piv] = tmp; }

        // 主元归一化
        var p = m[col][col];
        for (k = col; k <= n; k++) m[col][k] /= p;

        // 消去其他行的该列
        for (var rr = 0; rr < n; rr++) {
            if (rr === col) continue;
            var f = m[rr][col];
            if (f === 0) continue;
            for (k = col; k <= n; k++) m[rr][k] -= f * m[col][k];
        }
    }

    var out = [];
    for (i = 0; i < n; i++) out.push(m[i][n]);
    return out;
}

// ==================== 对外：单应矩阵 ====================

/**
 * 用 4 组对应点求 3×3 单应矩阵
 * @param {number[][]} src 源点 [[x,y],[x,y],[x,y],[x,y]]
 * @param {number[][]} dst 目标点 [[x,y],[x,y],[x,y],[x,y]]
 * @returns {number[]} 长度为 9 的矩阵，行优先 [h11,h12,h13, h21,h22,h23, h31,h32,h33]
 */
function computeHomography(src, dst) {
    if (!src || !dst || src.length !== 4 || dst.length !== 4) {
        throw new Error('computeHomography: 必须各传 4 个点');
    }
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
        var x = src[i][0], y = src[i][1];
        var u = dst[i][0], v = dst[i][1];
        A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    var h = _solve8(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * 用单应矩阵变换一个点（齐次坐标 + 除法）
 * @param {number[]} H 3×3 矩阵（长度 9）
 * @param {number} x
 * @param {number} y
 * @returns {number[]} [u, v]
 */
function transformPoint(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    if (Math.abs(w) < 1e-12) throw new Error('transformPoint: w=0，点无法投影');
    return [
        (H[0] * x + H[1] * y + H[2]) / w,
        (H[3] * x + H[4] * y + H[5]) / w
    ];
}

/**
 * 批量变换点
 * @param {number[]} H
 * @param {number[][]} pts [[x,y],...]
 * @returns {number[][]}
 */
function transformPoints(H, pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
        out.push(transformPoint(H, pts[i][0], pts[i][1]));
    }
    return out;
}

// ==================== 对外：棋盘格中心 ====================

/**
 * 计算棋盘逻辑坐标的 4 个角（顺序：上→右→下→左）
 * @param {number} n 棋盘边长
 * @returns {number[][]}
 */
function logicalCorners(n) {
    return [[0, 0], [n, 0], [n, n], [0, n]];
}

/**
 * 由棋盘四角算出 n×n 个格子的屏幕中心坐标
 *
 * 取每格中心 (col + 0.5, row + 0.5) 而不是整数格点 ——
 * 因为格点在菱形上落在格子交界处，中心才是可点击的位置。
 *
 * @param {number[][]} quad 屏幕上的四角，顺序 上→右→下→左
 * @param {number} n 棋盘边长（3~10）
 * @returns {{centers:number[][], H:number[], gridSize:number}} centers 按 row 优先排列
 */
function boardCenters(quad, n) {
    if (!quad || quad.length !== 4) throw new Error('boardCenters: quad 必须是 4 个点');
    if (!(n >= 2 && n <= 20)) throw new Error('boardCenters: gridSize 超出合理范围: ' + n);

    var H = computeHomography(logicalCorners(n), quad);
    var centers = [];
    for (var row = 0; row < n; row++) {
        for (var col = 0; col < n; col++) {
            var p = transformPoint(H, col + 0.5, row + 0.5);
            centers.push([Math.round(p[0]), Math.round(p[1])]);
        }
    }
    return { centers: centers, H: H, gridSize: n };
}

/**
 * 取某一格的屏幕坐标（方便按行列访问）
 * @param {number[][]} centers boardCenters 的结果
 * @param {number} n
 * @param {number} row
 * @param {number} col
 * @returns {number[]} [x, y]
 */
function cellPoint(centers, n, row, col) {
    return centers[row * n + col];
}

// ==================== 格子的真实形状（★ 比原项目更好的地方）====================

/**
 * 取某一格的 4 个逻辑顶点在屏幕上的坐标
 *
 * 逻辑顶点顺序：(c,r) → (c+1,r) → (c+1,r+1) → (c,r+1)
 * 屏幕上这 4 点构成一个菱形（或平行四边形）。
 *
 * @param {number[]} H 单应矩阵
 * @param {number} row
 * @param {number} col
 * @returns {number[][]} 4 个屏幕顶点
 */
function cellQuad(H, row, col) {
    var c = col, r = row;
    return [
        transformPoint(H, c,     r),
        transformPoint(H, c + 1, r),
        transformPoint(H, c + 1, r + 1),
        transformPoint(H, c,     r + 1)
    ];
}

/**
 * 量出某一格在屏幕上的实际尺寸
 *
 * ★ 为什么需要这个 ★
 * 棋盘是透视投影的，格子大小**随位置变化**（实测第 10 关从 70×43 变到 95×77，
 * 相差 35%）。原项目对所有格子用**固定** 80×56 的掩膜，等于用平均值近似，
 * 会造成系统性误差：上面的格子掩膜超出边界（沾到邻居），下面的格子盖不满（漏掉内容）。
 *
 * 我们既然算得出每格的精确四边形，就应该**按格自适应掩膜尺寸**。
 *
 * @param {number[]} H
 * @param {number} row
 * @param {number} col
 * @returns {{w:number, h:number, quad:number[][], cx:number, cy:number}}
 */
function cellSize(H, row, col) {
    var q = cellQuad(H, row, col);
    var xs = [q[0][0], q[1][0], q[2][0], q[3][0]];
    var ys = [q[0][1], q[1][1], q[2][1], q[3][1]];
    var w = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    var h = Math.max.apply(null, ys) - Math.min.apply(null, ys);
    return {
        w: w,
        h: h,
        quad: q,
        // 外接框中心（可能与格中心略有差异，做调试用）
        cx: (Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2,
        cy: (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2
    };
}

/**
 * 一次性算出全部格子的尺寸（vision 模块初始化时调用一次即可）
 *
 * @param {number[]} H
 * @param {number} n
 * @returns {{sizes:Array, avgW:number, avgH:number, minW:number, maxW:number, minH:number, maxH:number}}
 */
function cellSizes(H, n) {
    var sizes = [];
    var wSum = 0, hSum = 0;
    var minW = Infinity, maxW = -Infinity, minH = Infinity, maxH = -Infinity;
    for (var row = 0; row < n; row++) {
        for (var col = 0; col < n; col++) {
            var s = cellSize(H, row, col);
            sizes.push(s);
            wSum += s.w; hSum += s.h;
            if (s.w < minW) minW = s.w;
            if (s.w > maxW) maxW = s.w;
            if (s.h < minH) minH = s.h;
            if (s.h > maxH) maxH = s.h;
        }
    }
    var total = n * n;
    return {
        sizes: sizes,
        avgW: wSum / total,
        avgH: hSum / total,
        minW: minW, maxW: maxW,
        minH: minH, maxH: maxH
    };
}

// ==================== 校验（安全第一）====================

/** 叉积，用于判断点相对方向 */
function _cross(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** 判断四边形是否为凸（且顶点按序） */
function isConvexQuad(quad) {
    var sign = 0;
    for (var i = 0; i < 4; i++) {
        var c = _cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]);
        if (Math.abs(c) < 1e-9) return false;
        var s = c > 0 ? 1 : -1;
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
    }
    return true;
}

/** 四边形面积（鞋带公式，取绝对值） */
function quadArea(quad) {
    var s = 0;
    for (var i = 0; i < 4; i++) {
        var a = quad[i], b = quad[(i + 1) % 4];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
}

/** 点在四边形内测试（射线法，通用多边形） */
function pointInPoly(pt, poly) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1];
        var xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * 校验棋盘四角是否合法
 *
 * 校验项（照搬原项目的 safety check 思路）：
 *   1. 顶点顺序必须是 上→右→下→左（用 y/x 的大小关系判断）
 *   2. 必须是凸四边形，且无自交
 *   3. 对角线长度不能太小（防退化）
 *   4. 宽高比在合理范围
 *   5. 面积占比在合理范围
 *   6. 四角都要在屏幕内
 *
 * @param {number[][]} quad
 * @param {number} screenW
 * @param {number} screenH
 * @returns {{ok:boolean, errors:string[], metrics:Object}}
 */
function validateQuad(quad, screenW, screenH) {
    var errors = [];
    var m = {};

    if (!quad || quad.length !== 4) {
        return { ok: false, errors: ['quad 必须是 4 个点'], metrics: {} };
    }

    var top = quad[0], right = quad[1], bottom = quad[2], left = quad[3];

    // 1) 顺序检查
    if (!(top[1] < right[1] && right[1] < bottom[1])) {
        errors.push('顶点顺序错误：应为 上→右→下→左（要求 top.y < right.y < bottom.y）');
    }
    if (!(left[0] < top[0] && top[0] < right[0])) {
        errors.push('顶点顺序错误：应为 左.x < 上.x < 右.x');
    }

    // 2) 凸性
    if (!isConvexQuad(quad)) errors.push('四边形不是凸的（或顶点乱序/自交）');

    // 3) 对角线
    var d1 = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
    var d2 = Math.hypot(left[0] - right[0], left[1] - right[1]);
    m.diagTB = Math.round(d1);
    m.diagLR = Math.round(d2);
    var minDiag = Math.min(screenW, screenH) * 0.12;
    if (d1 < minDiag || d2 < minDiag) {
        errors.push('对角线太短（' + Math.round(Math.min(d1, d2)) + ' < ' + Math.round(minDiag) + '），棋盘可能识别错误');
    }

    // 4) 宽高比
    var bw = Math.max(right[0], bottom[0]) - Math.min(left[0], top[0]);   // 近似横跨
    var bh = bottom[1] - top[1];                                          // 近似纵跨
    var ratio = bh > 0 ? bw / bh : 0;
    m.width = Math.round(bw);
    m.height = Math.round(bh);
    m.aspect = Math.round(ratio * 1000) / 1000;
    if (!(ratio >= 0.45 && ratio <= 1.6)) {
        errors.push('宽高比异常（' + m.aspect + '，期望 0.45~1.6）');
    }

    // 5) 面积占比
    var area = quadArea(quad);
    var frac = area / (screenW * screenH);
    m.area = Math.round(area);
    m.areaFraction = Math.round(frac * 10000) / 10000;
    if (!(frac >= 0.015 && frac <= 0.75)) {
        errors.push('面积占比异常（' + (frac * 100).toFixed(1) + '%，期望 1.5%~75%）');
    }

    // 6) 在屏幕内
    for (var i = 0; i < 4; i++) {
        if (quad[i][0] < 0 || quad[i][0] > screenW || quad[i][1] < 0 || quad[i][1] > screenH) {
            errors.push('第 ' + (i + 1) + ' 个角超出屏幕范围: ' + JSON.stringify(quad[i]));
        }
    }

    return { ok: errors.length === 0, errors: errors, metrics: m };
}

/**
 * 校验算出的格中心是否安全可用
 *
 * ★ 这一条是「宁可停机也不乱点」的保险 ——
 *    点位算错的后果是脚本乱点屏幕，可能点掉道具、误操作账号。
 *
 * @param {number[][]} centers
 * @param {number[][]} quad
 * @param {number} n
 * @returns {{ok:boolean, errors:string[], warnings:string[], metrics:Object}}
 */
function validateCenters(centers, quad, n) {
    var errors = [], warnings = [], m = {};

    // 1) 数量
    if (centers.length !== n * n) {
        errors.push('格中心数量错误：' + centers.length + ' != ' + (n * n));
    }

    // 2) 全部落在 quad 内
    var outside = 0;
    for (var i = 0; i < centers.length; i++) {
        if (!pointInPoly(centers[i], quad)) outside++;
    }
    m.outsideCount = outside;
    if (outside > 0) errors.push('有 ' + outside + ' 个格中心落在棋盘外');

    // 3) 无重复点
    var seen = {}, dup = 0;
    for (var j = 0; j < centers.length; j++) {
        var k = centers[j][0] + ',' + centers[j][1];
        if (seen[k]) dup++; else seen[k] = 1;
    }
    m.duplicateCount = dup;
    if (dup > 0) errors.push('有 ' + dup + ' 个重复的格中心');

    // 4) 相邻格间距一致性（判断是否算歪了）
    if (centers.length === n * n && n >= 2) {
        var hd = [], vd = [];
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n - 1; c++) {
                var a = centers[r * n + c], b = centers[r * n + c + 1];
                hd.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
            }
        }
        for (var c2 = 0; c2 < n; c2++) {
            for (var r2 = 0; r2 < n - 1; r2++) {
                var a2 = centers[r2 * n + c2], b2 = centers[(r2 + 1) * n + c2];
                vd.push(Math.hypot(b2[0] - a2[0], b2[1] - a2[1]));
            }
        }
        var hmin = Math.min.apply(null, hd), hmax = Math.max.apply(null, hd);
        var vmin = Math.min.apply(null, vd), vmax = Math.max.apply(null, vd);
        m.hSpacing = [Math.round(hmin * 10) / 10, Math.round(hmax * 10) / 10];
        m.vSpacing = [Math.round(vmin * 10) / 10, Math.round(vmax * 10) / 10];
        // 透视投影下间距本就会渐变，但不能差太离谱
        if (hmax / Math.max(hmin, 1e-6) > 2.0) {
            warnings.push('横向格间距差异过大（' + m.hSpacing.join('~') + '），透视可能算错');
        }
        if (vmax / Math.max(vmin, 1e-6) > 2.0) {
            warnings.push('纵向格间距差异过大（' + m.vSpacing.join('~') + '），透视可能算错');
        }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings, metrics: m };
}

// ==================== 导出 ====================
//
// 本项目模块的导出约定是【文件最后一个表达式】（如 imageFinder.js 结尾的 `api;`、
// configManager.js 结尾的 `configManager;`），而不是 module.exports。
// 为同时兼容 node（离线跑 geometry.test.js）与 AutoGOD，两种都写。

var geometry = {
    // 核心
    computeHomography: computeHomography,
    transformPoint: transformPoint,
    transformPoints: transformPoints,
    logicalCorners: logicalCorners,
    // 棋盘
    boardCenters: boardCenters,
    cellPoint: cellPoint,
    // 格子真实形状（★ 按格自适应掩膜，原项目没有的能力）
    cellQuad: cellQuad,
    cellSize: cellSize,
    cellSizes: cellSizes,
    // 校验
    validateQuad: validateQuad,
    validateCenters: validateCenters,
    // 几何工具（其他地方也会用到）
    isConvexQuad: isConvexQuad,
    quadArea: quadArea,
    pointInPoly: pointInPoly
};

// 兼容 node（离线跑 geometry.test.js 用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = geometry;
}

// AutoGOD / EasyClick 的导出约定：文件最后一个表达式就是模块的导出值
geometry;
