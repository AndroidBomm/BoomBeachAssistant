/**
 * geometry.js 离线验证脚本
 *
 * 用 lwt15556/boom v1.1.0 里人工标定的**真实棋盘四角**当标准答案。
 *
 * ── 一个必须搞清楚的概念 ──
 * 棋盘是「菱形格」铺成的。所以：
 *   · 81 × 57.7 px 是【单个菱形格的横向/纵向跨度】（即外接框尺寸）
 *     → 这就是原项目 diamond_w=80 / diamond_h=56 的来源
 *   · 相邻格中心是沿【对角线】偏移的，水平偏移 = 81/2 ≈ 40.5，垂直偏移 = 57.7/2 ≈ 28.9
 *     → 相邻格中心的欧氏距离只有约 47~49 px，**不是 81**
 * 混淆这两个概念会导致掩膜尺寸设错一半。
 *
 * 运行：node modules/sonar/geometry.test.js
 */

var G = require('./geometry.js');

var pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  [通过] ' + name); }
    else { fail++; console.log('  [失败] ' + name + (detail ? '  → ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function fmt(p) { return '(' + p[0] + ',' + p[1] + ')'; }
function r1(v) { return Math.round(v * 10) / 10; }

// ==================== 测试数据（原项目真实标定）====================

var CASES = [
    { level: 10, n: 10, quad: [[664, 48], [1069, 288], [671, 625], [259, 290]] },
    { level: 1, n: 3, quad: [[666, 247], [786, 329], [662, 420], [543, 327]] },
    { level: 2, n: 4, quad: [[661, 247], [831, 357], [669, 488], [499, 362]] },
    { level: 5, n: 7, quad: [[660, 165], [958, 353], [670, 593], [372, 356]] }
];
var SCREEN = [1280, 720];

// ==================== 测试 1：四角往返映射 ====================

console.log('\n=== 测试 1：四角往返映射（H 把逻辑角精确映回屏幕角）===');
CASES.forEach(function (cs) {
    var lc = G.logicalCorners(cs.n);
    var H = G.computeHomography(lc, cs.quad);
    var maxErr = 0;
    for (var i = 0; i < 4; i++) {
        var p = G.transformPoint(H, lc[i][0], lc[i][1]);
        maxErr = Math.max(maxErr, Math.hypot(p[0] - cs.quad[i][0], p[1] - cs.quad[i][1]));
    }
    check('第 ' + cs.level + ' 关 (n=' + cs.n + ')：四角往返误差 < 1e-6 px', maxErr < 1e-6,
          '最大 ' + maxErr.toExponential(2));
});

// ==================== 测试 2：菱形格尺寸（diamond_w/diamond_h 的来源）====================

console.log('\n=== 测试 2：菱形格的真实尺寸 ===');
console.log('  （用格子的 4 个逻辑顶点算出它在屏幕上的四边形，再量外接框）');

var r10 = G.boardCenters(CASES[0].quad, CASES[0].n);
var H10 = r10.H;

/**
 * 取某格在屏幕上的 4 个顶点（逻辑角）
 * 逻辑顶点顺序：(c,r) (c+1,r) (c+1,r+1) (c,r+1)
 */
function cellQuad(H, r, c) {
    return [
        G.transformPoint(H, c, r),
        G.transformPoint(H, c + 1, r),
        G.transformPoint(H, c + 1, r + 1),
        G.transformPoint(H, c, r + 1)
    ];
}
function bboxOf(pts) {
    var xs = pts.map(function (p) { return p[0]; });
    var ys = pts.map(function (p) { return p[1]; });
    return { w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
             h: Math.max.apply(null, ys) - Math.min.apply(null, ys) };
}

// 采样几个位置的格子，看尺寸是否一致
var samples = [[0, 0], [0, 9], [9, 0], [9, 9], [4, 4], [5, 5]];
console.log('  第 10 关各位置菱形格的外接框尺寸:');
var ws = [], hs = [];
samples.forEach(function (rc) {
    var b = bboxOf(cellQuad(H10, rc[0], rc[1]));
    ws.push(b.w); hs.push(b.h);
    console.log('    格(' + rc[0] + ',' + rc[1] + ')  宽 ' + r1(b.w) + ' px   高 ' + r1(b.h) + ' px');
});
var wMin = Math.min.apply(null, ws), wMax = Math.max.apply(null, ws);
var hMin = Math.min.apply(null, hs), hMax = Math.max.apply(null, hs);
console.log('  → 宽范围 ' + r1(wMin) + ' ~ ' + r1(wMax) + ' px   高范围 ' + r1(hMin) + ' ~ ' + r1(hMax) + ' px');

// ★ 关键结论：格子大小**随位置变化**（透视投影），不是固定值！
//   原项目对所有格子用固定 80x56 掩膜，是「用平均值近似」——这会带来系统性误差。
//   我们算出了每格精确四边形，可以按格自适应。
check('格宽随位置变化（透视），范围 65~100 px', wMin > 65 && wMax < 100,
      '实测 ' + r1(wMin) + '~' + r1(wMax));
check('格高随位置变化（透视），范围 40~85 px', hMin > 40 && hMax < 85,
      '实测 ' + r1(hMin) + '~' + r1(hMax));
check('尺寸变化幅度 > 20%（说明固定掩膜会有系统误差）',
      (hMax / hMin) > 1.2, '高比 ' + r1(hMax / hMin));
check('最上面的格子最小（透视远处）', bboxOf(cellQuad(H10, 0, 0)).h < bboxOf(cellQuad(H10, 9, 9)).h);

// 整盘平均尺寸应该接近 81 x 57.7
var allW = 0, allH = 0, cnt = 0;
for (var rr = 0; rr < 10; rr++) {
    for (var cc = 0; cc < 10; cc++) {
        var b2 = bboxOf(cellQuad(H10, rr, cc));
        allW += b2.w; allH += b2.h; cnt++;
    }
}
var avgW = allW / cnt, avgH = allH / cnt;
console.log('  → 整盘 100 格平均: 宽 ' + r1(avgW) + ' px   高 ' + r1(avgH) + ' px');
check('整盘平均格宽 ≈ 81 px（= (1069-259)/10）', near(avgW, 81, 3), r1(avgW));
check('整盘平均格高 ≈ 57.7 px（= (625-48)/10）', near(avgH, 57.7, 3), r1(avgH));

// ==================== 测试 3：相邻格中心偏移 = w/2, h/2 ====================

console.log('\n=== 测试 3：相邻格中心偏移（这是掩膜定位的关键）===');
var c00 = G.cellPoint(r10.centers, 10, 0, 0);
var c01 = G.cellPoint(r10.centers, 10, 0, 1);
var c10 = G.cellPoint(r10.centers, 10, 1, 0);
var dxCol = c01[0] - c00[0], dyCol = c01[1] - c00[1];
var dxRow = c10[0] - c00[0], dyRow = c10[1] - c00[1];
console.log('  格(0,0) → 格(0,1)  偏移 (' + dxCol + ',' + dyCol + ')   →  列方向 = 右下');
console.log('  格(0,0) → 格(1,0)  偏移 (' + dxRow + ',' + dyRow + ')   →  行方向 = 左下');
// 偏移量应等于「该处格子尺寸的一半」——格子越小，偏移越小（透视）
var localW = bboxOf(cellQuad(H10, 0, 0)).w;
var localH = bboxOf(cellQuad(H10, 0, 0)).h;
console.log('  该处格子的本地尺寸: 宽 ' + r1(localW) + '  高 ' + r1(localH));
check('列方向偏移 x ≈ +本地格宽/2', near(dxCol, localW / 2, 2),
      dxCol + ' vs ' + r1(localW / 2));
check('行方向偏移 x ≈ -本地格宽/2', near(dxRow, -localW / 2, 2),
      dxRow + ' vs -' + r1(localW / 2));
check('两个方向 y 偏移都为正（都往下）', dyCol > 0 && dyRow > 0);
check('y 偏移 ≈ 本地格高/2', near(dyCol, localH / 2, 2) && near(dyRow, localH / 2, 2),
      dyCol + '/' + dyRow + ' vs ' + r1(localH / 2));
// 靠近底部的格子（透视近处）比顶部大
// 注意：不能只比 +x 方向偏移——透视在两个轴向上的放大倍率不同，
//       这里直接比格子本身的宽度更准确。
var wTopLeft = bboxOf(cellQuad(H10, 0, 0)).w;
var wBottom = bboxOf(cellQuad(H10, 9, 9)).w;
check('底部格子比顶部格子大（透视放大）', wBottom > wTopLeft * 1.2,
      '底部 ' + r1(wBottom) + ' vs 顶部 ' + r1(wTopLeft));

// ==================== 测试 4：格中心安全性 ====================

console.log('\n=== 测试 4：格中心安全性 ===');
CASES.forEach(function (cs) {
    var r = G.boardCenters(cs.quad, cs.n);
    var v = G.validateCenters(r.centers, cs.quad, cs.n);
    check('第 ' + cs.level + ' 关：' + (cs.n * cs.n) + ' 个中心全部在棋盘内、无重复',
          v.ok && r.centers.length === cs.n * cs.n,
          v.errors.join('; '));
});

// ==================== 测试 5：四角合法性校验 ====================

console.log('\n=== 测试 5：四角合法性校验 ===');
var q10 = G.validateQuad(CASES[0].quad, SCREEN[0], SCREEN[1]);
check('真实四角通过校验', q10.ok, q10.errors.join('; '));
console.log('  指标: 宽' + q10.metrics.width + ' 高' + q10.metrics.height +
            ' 宽高比' + q10.metrics.aspect + ' 面积占比' + (q10.metrics.areaFraction * 100).toFixed(1) + '%');
check('顶点顺序错误能被检出', !G.validateQuad([[664, 48], [259, 290], [671, 625], [1069, 288]], 1280, 720).ok);
check('面积过小能被检出', !G.validateQuad([[100, 100], [110, 100], [110, 110], [100, 110]], 1280, 720).ok);
check('非凸/乱序能被检出', !G.validateQuad([[0, 0], [10, 300], [600, 200], [300, 10]], 1280, 720).ok);
check('超出屏幕能被检出', !G.validateQuad([[100, 0], [2000, 100], [2000, 600], [100, 500]], 1280, 720).ok);

// ==================== 测试 6：退化输入防护 ====================

console.log('\n=== 测试 6：退化输入防护（宁可抛错也不能返回垃圾）===');
var threw = false;
try { G.computeHomography([[0, 0], [0, 0], [0, 0], [0, 0]], CASES[1].quad); } catch (e) { threw = true; }
check('4 点重合时抛错', threw);
threw = false;
try { G.computeHomography([[0, 0], [1, 1], [2, 2], [3, 3]], CASES[1].quad); } catch (e) { threw = true; }
check('4 点共线时抛错', threw);

// ==================== 测试 7：格中心排列顺序 ====================

console.log('\n=== 测试 7：格中心排列顺序（row 优先）===');
var p00 = G.cellPoint(r10.centers, 10, 0, 0);
var p09 = G.cellPoint(r10.centers, 10, 0, 9);
var p90 = G.cellPoint(r10.centers, 10, 9, 0);
var p99 = G.cellPoint(r10.centers, 10, 9, 9);
console.log('  格(0,0)=' + fmt(p00) + '  格(0,9)=' + fmt(p09) +
            '  格(9,0)=' + fmt(p90) + '  格(9,9)=' + fmt(p99));
check('格(0,0) 在最上方', p00[1] < p09[1] && p00[1] < p90[1] && p00[1] < p99[1]);
check('格(9,9) 在最下方', p99[1] > p09[1] && p99[1] > p90[1]);
check('格(0,9) 在最右', p09[0] > p00[0] && p09[0] > p99[0]);
check('格(9,0) 在最左', p90[0] < p00[0] && p90[0] < p99[0]);
check('索引 = row * n + col',
      r10.centers[0] === p00 && r10.centers[9] === p09 &&
      r10.centers[90] === p90 && r10.centers[99] === p99);

// ==================== 测试 8：按格自适应掩膜尺寸（★ 我们比原项目强的地方）====================

console.log('\n=== 测试 8：cellSize / cellSizes（按格自适应掩膜）===');
var allSizes = G.cellSizes(H10, 10);
console.log('  整盘尺寸统计: 宽 ' + r1(allSizes.minW) + '~' + r1(allSizes.maxW) +
            ' (均 ' + r1(allSizes.avgW) + ')   高 ' + r1(allSizes.minH) + '~' + r1(allSizes.maxH) +
            ' (均 ' + r1(allSizes.avgH) + ')');
check('cellSizes 返回 n² 个格子', allSizes.sizes.length === 100);
check('平均宽 ≈ 81（对应 diamond_w=80）', near(allSizes.avgW, 81, 3), r1(allSizes.avgW));
check('平均高 ≈ 57（对应 diamond_h=56）', near(allSizes.avgH, 57, 3), r1(allSizes.avgH));

var s00 = G.cellSize(H10, 0, 0);
var s99 = G.cellSize(H10, 9, 9);
check('cellSize 与 cellQuad 量出的一致',
      near(s00.w, bboxOf(G.cellQuad(H10, 0, 0)).w, 1e-6));
check('每格尺寸确实不同（透视）', Math.abs(s00.h - s99.h) > 20,
      '顶部 ' + r1(s00.h) + ' vs 底部 ' + r1(s99.h));

// 关键：固定掩膜 vs 自适应掩膜的误差有多大
var fixedW = 80, fixedH = 56;
var maxWErr = 0, maxHErr = 0;
allSizes.sizes.forEach(function (s) {
    maxWErr = Math.max(maxWErr, Math.abs(s.w - fixedW) / fixedW);
    maxHErr = Math.max(maxHErr, Math.abs(s.h - fixedH) / fixedH);
});
console.log('  若用固定 80x56 掩膜，最大尺寸误差: 宽 ' + (maxWErr * 100).toFixed(1) +
            '%  高 ' + (maxHErr * 100).toFixed(1) + '%');
check('固定掩膜的最大误差 > 15%（说明自适应有实际价值）',
      maxWErr > 0.15 || maxHErr > 0.15,
      '宽 ' + (maxWErr * 100).toFixed(1) + '% 高 ' + (maxHErr * 100).toFixed(1) + '%');

// cellSizes 的顺序必须与 centers 一致
var okOrder = true;
for (var t = 0; t < 100; t++) {
    var sz = allSizes.sizes[t];
    var cp = r10.centers[t];
    // 格中心应落在外接框内
    if (cp[0] < sz.cx - sz.w || cp[0] > sz.cx + sz.w ||
        cp[1] < sz.cy - sz.h || cp[1] > sz.cy + sz.h) { okOrder = false; break; }
}
check('cellSizes 与 centers 顺序一致（索引对应同一个格）', okOrder);

// ==================== 汇总 ====================

console.log('\n========================================');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
