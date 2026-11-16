/**
 * 声纳海域表 —— 海域号 → 棋盘尺寸 / 潜艇配置 / 内置标定四角
 *
 * ── 三个概念 ──
 *   海域号(area)   游戏里显示的「8号海域」，就是关卡序号
 *   棋盘尺寸(n)    该海域是 n×n 的格子（游戏里固定的，不是我们定的）
 *   标定四角(quad) 棋盘 4 个外角在 1280×720 画面上的坐标，按 上→右→下→左 排列
 *
 * ── 格子数规律 ──
 *   n = min(海域号 + 2, 10)
 *   海域 1 → 3×3   海域 2 → 4×4   ...   海域 8 → 10×10   海域 9 起也都是 10×10
 *   （数据来源：lwt15556/boom v1.1.0 的 config.py LEVEL_GRID_SIZES）
 *
 * ── 内置四角的来源与可信度 ──
 *   来自 boom 的 save_points/points.json（image_size 实测就是 1280×720，与本项目环境一致）。
 *   海域 1~7 的四角，boom 与 BoomBeachSonarRobot 两个项目【各自独立标定出同一组值】，
 *   互相印证，可信度很高。
 *   海域 8 起共用一个四角 —— 注意必须用「不下滑」那一组：
 *     boom 因为会先下滑露出棋盘，它的 8+ 关四角是 (676,96)(1100,355)(686,718)(262,352)，
 *     我们采用 Robot/Sonar 的不下滑版 (664,48)(1069,288)(671,625)(259,290)。
 *
 * ── 四角顺序（全项目统一，不可改）──
 *   上(top) → 右(right) → 下(bottom) → 左(left)
 *   对应逻辑坐标 (0,0) → (n,0) → (n,n) → (0,n)
 */

// 上游数据覆盖到第 70 海域
var MAX_AREA = 70;

// 四角顺序的中文名，界面上按这个顺序提示用户
var CORNER_NAMES = ['上', '右', '下', '左'];

// 四角对应的颜色（与 geometry.js 无关，纯粹给界面用）
var CORNER_COLORS = ['#FFFF00', '#3399FF', '#33CC33', '#FF3333'];

/**
 * 海域号 → 棋盘边长 n
 * @param {number} area 海域号（1 起）
 * @returns {number} n（3 ~ 10）
 */
function gridSizeOf(area) {
    area = parseInt(area, 10);
    if (!(area >= 1)) { return 0; }
    return Math.min(area + 2, 10);
}

/**
 * 海域号 → 该海域的潜艇长度列表
 *
 * 含义：这片海域里有几艘潜艇、每艘占几格。
 * 例：[2,2,3,4,5] = 2格×2艘 + 3格×1艘 + 4格×1艘 + 5格×1艘 = 共 16 格
 * 用途：策略层判断「已经打掉多少格、还剩哪些可能」，以及计算最少要探几格。
 *
 * @param {number} area 海域号
 * @returns {number[]} 潜艇长度数组（长度 = 潜艇艘数）
 */
function submarinesOf(area) {
    area = parseInt(area, 10);
    if (!(area >= 1)) { return []; }
    if (SPECIAL_SUBMARINES[area]) { return SPECIAL_SUBMARINES[area].slice(); }
    return DEFAULT_SUBMARINES.slice();
}

/**
 * 海域号 → 内置标定四角
 * @param {number} area 海域号
 * @returns {number[][]|null} [[x,y]×4]（上→右→下→左），没有则 null
 */
function builtinQuadOf(area) {
    area = parseInt(area, 10);
    if (!(area >= 1)) { return null; }
    var q = BUILTIN_QUADS[area] || BUILTIN_QUADS['default'];
    if (!q) { return null; }
    // 返回深拷贝，避免调用方改了内置数据
    return q.map(function (p) { return [p[0], p[1]]; });
}

/**
 * 取某海域的完整配置
 * @param {number} area 海域号
 * @returns {{area:number, n:number, submarines:number[], submarineTotal:number, quad:number[][]|null}}
 */
function getArea(area) {
    area = parseInt(area, 10);
    var n = gridSizeOf(area);
    var subs = submarinesOf(area);
    var total = 0;
    for (var i = 0; i < subs.length; i++) { total += subs[i]; }
    return {
        area: area,
        n: n,
        submarines: subs,
        submarineTotal: total,          // 潜艇共占多少格（= 需要打中的格数）
        quad: builtinQuadOf(area)
    };
}

/**
 * 该海域号是否有上游内置四角可用
 */
function hasBuiltinQuad(area) {
    return builtinQuadOf(area) !== null;
}

// ==================== 数据 ====================

/**
 * 1~10 海域的潜艇配置（11 起用默认值）
 * 来源：boom config.py 的 SPECIAL_SUBMARINES
 */
var SPECIAL_SUBMARINES = {
    1:  [3],
    2:  [2, 2],
    3:  [2, 2, 3],
    4:  [2, 3, 4],
    5:  [2, 3, 3, 4],
    6:  [2, 2, 3, 3, 5],
    7:  [2, 2, 3, 3, 4, 5],
    8:  [2, 2, 3, 3, 4, 4, 5],
    9:  [2, 3, 3, 4, 4, 5],
    10: [2, 2, 3, 4, 4, 5]
};

/** 海域 11 起统一用这一组 */
var DEFAULT_SUBMARINES = [2, 2, 3, 4, 5];

/**
 * 内置标定四角（1280×720，上→右→下→左）
 *
 * 1~7 各自独立；8 起（'default'）共用一个。
 * 'default' 同时作为海域 1~7 之外所有海域的兜底。
 */
var BUILTIN_QUADS = {
    1: [[666, 247], [786, 329], [662, 420], [543, 327]],
    2: [[661, 247], [831, 357], [669, 488], [499, 362]],
    3: [[662, 225], [874, 363], [669, 532], [455, 367]],
    4: [[667, 192], [916, 362], [665, 562], [413, 359]],
    5: [[660, 165], [958, 353], [670, 593], [372, 356]],
    6: [[664, 125], [998, 336], [670, 609], [333, 338]],
    7: [[661, 89], [1034, 321], [666, 625], [294, 317]],
    // 海域 8~70 全部共用这一组（63 个海域实测完全一致）
    'default': [[664, 48], [1069, 288], [671, 625], [259, 290]]
};

// ==================== 导出 ====================
// 本项目约定：文件最后一个表达式就是导出值（同 imageFinder.js 的 `api;`）
// 同时写 module.exports 以兼容 node 离线单测

var levels = {
    MAX_AREA: MAX_AREA,
    CORNER_NAMES: CORNER_NAMES,
    CORNER_COLORS: CORNER_COLORS,
    gridSizeOf: gridSizeOf,
    submarinesOf: submarinesOf,
    builtinQuadOf: builtinQuadOf,
    hasBuiltinQuad: hasBuiltinQuad,
    getArea: getArea
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = levels;
}

levels;
