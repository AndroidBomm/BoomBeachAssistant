/**
 * 声纳巡逻（自动探测打格子）
 * ==================================================================
 * 游戏机制（用户实测，必须照做）：
 *   断网 → 点一个格子发射 → **返回海岛主界面** → **重新进声纳界面**
 *   → 这时才能看到那个格子的结果（因为服务器没收到，结果是本地暂存的）
 *   → 想保留：恢复网络，服务器同步这一发
 *     不保留：强停游戏，服务器从没收到过，这一发白打（炮弹不消耗）
 *
 * 关键前提（都是实测出来的，别改）：
 *   1. 图色插件的 connectedComponentsWithStats / polygonDetection 在本机返回 null，
 *      一律用 getPixelColor 逐点扫描，不用连通域。
 *   2. 游戏有挂机超时弹窗「有人吗？」，会整屏变暗，必须先点掉。
 *   3. 棋盘四角用 levels.js 的内置标定值（1号海域实测误差 <5px，比自动识别稳）。
 *   4. 空格子底色约 (90,134,152)；偏离该色足够远即视为「已打过的格子」。
 *   5. root 异步回调只在「客户端运行按钮」启动的实例里可靠；
 *      adb 广播 / WS 启动的实例回调不触发 —— 所以本脚本必须从工程界面启动。
 */

/*
 * ==================================================================
 * 阅读地图（改代码前先看这块，按行号跳转）
 * ------------------------------------------------------------------
 *  51   §A 可调参数      CFG / USE_FLOATY / say / ST_* 常量
 *  84   §B 小工具        hexToRgb / dist2
 *  93   §B 图色插件      initPlugin / shot / classifyCell
 * 181   §C 棋盘帧校验    isBoardFrame (boardLike / waterLike)
 * 209   §C 挂机弹窗      idleVisible / dismissIdle
 * 224   §C 棋盘几何      boardOf / centerOf
 * 243   §C 读格子        readStates / boardText
 * 271   §D 界面进出      enterBoard / closeBoard
 * 297   §D 防盲点+海域    onBoard / measureBoard / detectArea / ensureBoard
 * 470   §F 断网          rootSync / syncUid / netEnable / netDisable / grayDialog
 * 616   §G 主流程        main / probeStep
 * 619   §G 单实例守卫    iamStillOwner
 * 634   §G 探测地图      mapLoad / mapSave / startGame / killGame / probeOne
 * 687   §H 强停带核验    killGameVerified
 * 705   §H WiFi 伪重启   wifiPseudoRestart（主方案）
 * 728   §H 丢弃调度      discardShot
 * 744   §E 按图找按钮    findBtn / findTplBig / tplImg（插件 findImgFast 版）
 * 881   §I 清海域        clearStart / clearStep
 * 1009  入口             main()
 *
 * 同名功能存在多套实现，**活链路是右边这套**，左边是历史遗留：
 *   截图        snapMat / snapLandscape  →  shot()             ← 用这个
 *   在不在棋盘   onBoardLoose(已删)        →  onBoard / onBoardAny
 *   进棋盘      ensureBoard            →  ensureBoardAny      ← 探测用这个
 *   调 root     bridgeSh               →  rootSync            ← 用这个
 *   杀游戏      killGame               →  killGameVerified    ← 丢弃用这个
 *   找按钮      findTpl / findTplBig    →  findBtn             ← 用这个
 *   读模板      tplMat                 →  tplImg              ← $img.read 缓存
 *   ⚠️ 想删历史遗留前先 grep 调用点：多数还在兜底分支里。
 *
 * 三条硬规则（2026-11 真机踩出来的，别犯）：
 *   1. 找图用 imageHandler.findImgFast(img, temp, threshold, sx, sy, ex, ey, count, strictMode)
 *      —— 不是 findImg（它内部 resize+像素ROI 混用会抛 CvException 并被插件吞成 null）。
 *   2. sx/sy/ex/ey 是 **0~10000 归一化坐标**，不是像素！用 nx()/ny() 换算。
 *   3. 首参必须是 Mat（captureScreenMat 的返回），不能是 $screen.getScreen() 的 Image。
 * ==================================================================
 */

var geo = require('./modules/sonar/geometry.js');
var levels = require('./modules/sonar/levels.js');
var net = (typeof netControl !== 'undefined') ? netControl : require('./modules/netControl.js');
var floatys = require('./modules/floatyLog.js');

// ==================== 可调参数 ====================
var CFG = {
    area: 4,
    mode: 'probe',           // 'probe'=断网探测（不消耗炮弹，默认）  'online'=在线直打（会消耗炮弹）
    serverType: 1,           // 0=国服 1=国际服
    emptyRgb: [90, 134, 152],
    emptyTol: 38,
    closeBtn: [52, 38],      // 棋盘左上角 ×
    actIcon: [1235, 256],    // 主界面右侧活动图标（实测 2026-11-16；旧值 1260,230 点不开）
    actSonaArrow: [1212, 488],// 「声呐巡逻」行右侧箭头（兜底值，优先用 sonar_row 模板锚点+偏移）
    sonarOffset: [312, 156], // sonar_row.png 左上角 → 箭头中心的偏移
    blueBomb: [1116, 652],
    redBomb: [1210, 650],
    idleBtn: [390, 462],
    retryBtn: [347, 427],    // 「连接中断」弹窗里的「重试」
    discardMode: 'wifi',     // 'wifi'=WiFi伪重启(快,默认)  'kill'=强停重开(慢,兜底)
    maxProbe: 25
};

var USE_FLOATY = false;
var _pathPatched = false;   // 调试时关掉浮窗（浮窗在这个实例里会刷屏）
var OUT_PATH = '/sdcard/Download/海岛助手/_sonar_out.txt';
var _lines = [];
function say(t) {
    _lines.push(String(t));
    try { $file.write(_lines.join('\n'), OUT_PATH); } catch (e) { }
    // 心跳：外面每 2 分钟看一次这个文件的时间戳，超过 6 分钟没动就判定卡死
    try { $file.write(String(Date.now()), '/sdcard/Download/海岛助手/_sonar_beat.txt'); } catch (e) { }
    if (USE_FLOATY) { try { floatys.i(String(t)); } catch (e) { } }
}

var ST_EMPTY = 0, ST_MISS = 1, ST_HIT = 2, ST_UNKNOWN = 3;

// ==================== 工具 ====================
function hexToRgb(h) {
    if (!h || h.length < 7) return null;
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}
// 注意：函数名叫 dist2，但返回的是**欧氏距离**（已开根号），不是平方
function dist2(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
}
// ==================== 插件 ====================
var ih = null;
function initPlugin() {
    if (ih) return true;
    // 注意：不要用 hasPermit() 做硬门槛，也不要去调 $screen.getPermit()
    //（实测：getPermit 会把权限通道搞坏；hasPermit 在部分启动方式下返回 false 但截图其实可用）
    // require 的相对路径按「入口脚本所在目录」解析，子脚本启动时会落到 scripts/ 下，
    // 所以这里按候选路径逐个试，并在初始化后校验。
    var _cands = [
        '/sdcard/Download/海岛助手/modules/OperHandler.js',
        './modules/OperHandler.js',
        '../modules/OperHandler.js'
    ];
    var _err = '';
    for (var _i = 0; _i < _cands.length && !ih; _i++) {
        try {
            ih = require(_cands[_i]);
            if (!ih) { _err += '[' + _cands[_i] + ']返回空 '; }
        } catch (e) { _err += '[' + _cands[_i] + ']' + (e && e.message ? e.message : e) + ' '; }
    }
    if (!ih) { say('插件加载失败: ' + _err); return false; }
    try { ih.imageHandlerInit(); }
    catch (e) { say('插件初始化异常: ' + (e && e.message ? e.message : e)); }
    var m = null;
    try { m = ih.captureScreenMat(); } catch (e) { m = null; }
    if (!m) {
        say('没有截屏权限，正在申请（请在系统弹窗点「立即开始」）…');
        try { $screen.getPermit(); } catch (e) { }
        sleep(3000);
        try { m = ih.captureScreenMat(); } catch (e) { m = null; }
    }
    if (m) { say('截图 OK ' + m.getWidth() + 'x' + m.getHeight()); }
    else { say('截图仍然失败'); }
    return true;
}
function shot() { return ih.captureScreenMat(); }

// 截图：优先用图色插件的 captureScreenMat()（封装 $screen.getScreen()，不用 root，实测 64ms）
// 实测结论（2026-11-15 探针）：游戏在前台、AutoGOD 在后台时它照样能截到游戏；
// 之前「截到 AutoGOD 自己」是因为当时 AutoGOD 就在前台；「返回 null」是截屏权限掉了，
// 调一次 $screen.getPermit() 就恢复。root 的 screencap 留作兜底。
var SNAP = '/sdcard/Download/海岛助手/_snap.png';
function snapMat(cb, tries) {
    tries = tries || 3;
    var m = null;
    if (!ih) { return cb(null); }
    try { m = ih.captureScreenMat(); } catch (e) { m = null; }
    if (m && m.getWidth && m.getWidth() > 0) { return cb(m); }
    // 兜底 1：申请权限后重试
    try {
        if (!$screen.hasPermit()) { $screen.getPermit(); sleep(1500); }
        m = ih.captureScreenMat();
        if (m && m.getWidth && m.getWidth() > 0) { return cb(m); }
    } catch (e) { }
    // 兜底 2：root screencap 落盘再读
    sh('screencap -p ' + SNAP, function () {
        var m2 = null;
        try { m2 = ih.readMat(SNAP); } catch (e) { m2 = null; }
        if (!m2) { say('截图失败（插件与 root 都没拿到）'); return cb(null); }
        return cb(m2);
    });
}



// 三种状态：0=没打过  1=打空了(水坑)  2=命中潜艇(残骸)
// 实测像素：空格 ~(90,134,152)；水坑 ~(33,88,115) 暗；残骸 ~(181,184,187) 亮
// 等到横屏（1280x720）截图为止：切前台后游戏可能要几百毫秒才画出来，
// 这期间截到的是 AutoGOD 自己的竖屏界面，拿去量棋盘必然认错。
function snapLandscape(cb, tries) {
    tries = (tries === undefined ? 6 : tries);
    snapMat(function (m) {
        if (m && m.getWidth() > m.getHeight()) return cb(m);
        if (tries <= 0) { say('多次截图仍不是横屏（可能游戏没在前台）'); return cb(null); }
        say('截图不是横屏，重试（剩 ' + tries + ' 次）');
        setTimeout(function () { snapLandscape(cb, tries - 1); }, 1200);
    }, 3);
}


// ==================== 棋盘帧校验 ====================
// 为什么要校验：截图偶尔会截到过渡帧（黑屏/主基地/胜利界面），
// 此时每个格心都是「非底色」，readStates 会把整盘读成 x，脚本就会误判「没有空格子」。
function boardQuadOf() {
    var c = levels.getArea(CFG.area);
    return (c && c.quad) ? c.quad : null;
}
function isBoardFrame(mat) {
    if (!mat) return false;
    var q = boardQuadOf();
    if (!q) return false;
    var T = q[0], R = q[1], B = q[2], L = q[3];
    var ok = 0, total = 0;
    for (var i = 1; i <= 3; i++) {
        for (var j = 1; j <= 3; j++) {
            var u = i / 4, v = j / 4;
            var x = Math.round(T[0] + (R[0] - T[0]) * u + (L[0] - T[0]) * v + (B[0] + T[0] - R[0] - L[0]) * u * v);
            var y = Math.round(T[1] + (R[1] - T[1]) * u + (L[1] - T[1]) * v + (B[1] + T[1] - R[1] - L[1]) * u * v);
            var rgb = hexToRgb(ih.getPixelColor(mat, x, y));
            if (!rgb) continue;
            total++;
            // 棋盘格偏青灰：蓝分量明显高于红，绿也高于红
            if (rgb[0] >= 55 && rgb[1] >= 100 && rgb[2] >= 118 && rgb[2] > rgb[0] + 22 && rgb[1] > rgb[0] + 16) ok++;
        }
    }
    return total >= 6 && ok >= 6;
}

// ==================== 挂机弹窗 ====================
function idleVisible(mat) {
    var c = hexToRgb(ih.getPixelColor(mat, 640, 300));
    if (!c) return false;
    return (c[0] + c[1] + c[2]) / 3 < 55;
}
function dismissIdle() {
    var m = shot();
    if (!idleVisible(m)) return false;
    say('挂机弹窗，点「重新载入游戏」');
    $act.click(CFG.idleBtn[0], CFG.idleBtn[1]);
    sleep(7000);
    return true;
}

// ==================== 棋盘几何 ====================
function boardOf(area) {
    var c = levels.getArea(area);
    if (!c || !c.quad) return null;
    var r = geo.boardCenters(c.quad, c.n);
    if (!r || !r.centers) return null;
    return { area: area, n: c.n, subs: c.submarines, quad: c.quad, centers: r.centers, H: r.H };
}
function centerOf(b, row, col) {
    // levels.js 的 quad 顺序是 [上, 右, 下, 左]
    var q = b.quad, n = b.n;
    var T = q[0], R = q[1], B = q[2], L = q[3];
    var u = (col + 0.5) / n, v = (row + 0.5) / n;
    return [
        Math.round(T[0] + (R[0] - T[0]) * u + (L[0] - T[0]) * v + (B[0] + T[0] - R[0] - L[0]) * u * v),
        Math.round(T[1] + (R[1] - T[1]) * u + (L[1] - T[1]) * v + (B[1] + T[1] - R[1] - L[1]) * u * v)
    ];
}

// ==================== 读格子状态 ====================
// 为什么要取 9 个点：潜艇残骸只是格子内一小块**偏心的白色**，
// 只取正中心经常落在旁边的蓝灰底上，会把「有潜艇」误判成「空」。
// 实测：有残骸的格子内部最亮 ≈200~206，空格底色均匀 (90,134,152)。
function cellSample(b, r, c, mat) {
    var p = centerOf(b, r, c);
    if (!p) return null;
    var cx = p[0], cy = p[1];
    var OFF = [[0, 0], [0, -10], [0, 10], [-10, 0], [10, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]];
    var maxLum = -1, centerRgb = null;
    for (var i = 0; i < OFF.length; i++) {
        var raw = ih.getPixelColor(mat, cx + OFF[i][0], cy + OFF[i][1]);
        var rgb = hexToRgb(raw);
        if (!rgb) continue;
        if (i === 0) centerRgb = rgb;
        var lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
        if (lum > maxLum) maxLum = lum;
    }
    if (!centerRgb) return null;
    return { centerRgb: centerRgb, maxLum: maxLum };
}
function classifySample(s) {
    if (!s) return ST_UNKNOWN;
    if (s.maxLum >= 160) return ST_HIT;                        // 残骸很亮
    if (dist2(s.centerRgb, CFG.emptyRgb) <= CFG.emptyTol) return ST_EMPTY;
    return ST_MISS;                                             // 水坑很暗
}
function readStates(b, mat) {
    var n = b.n, out = [];
    for (var r = 0; r < n; r++) {
        var line = [];
        for (var c = 0; c < n; c++) {
            var s = cellSample(b, r, c, mat);
            line.push(classifySample(s));
        }
        out.push(line);
    }
    return out;
}
function boardText(states) {
    var out = [];
    for (var r = 0; r < states.length; r++) {
        var s = '';
        for (var c = 0; c < states[r].length; c++) {
            s += states[r][c] === ST_EMPTY ? '.' : (states[r][c] === ST_UNKNOWN ? '?' : 'x');
        }
        out.push(s);
    }
    return out.join(' | ');
}
// ==================== 界面进出 ====================
// 返回 true/false：原来没有 return，调用方 `if (!enterBoard())` 永远判失败。
// 现在：进棋盘后截一张图确认，认得出棋盘才算成功。
function enterBoard() {
    var m0 = shot();
    if (m0 && onBoard(m0, CFG.area)) return true;      // 已经在棋盘上，别乱点
    sleep(1200);
    var ap = findBtn('act');
    if (!ap) { say('enterBoard：找不到活动图标，不盲点'); return false; }
    $act.click(ap[0], ap[1]);
    sleep(2500);
    var rp = findBtn('arrow');
    if (!rp) { say('enterBoard：找不到声呐箭头'); return false; }
    $act.click(rp[0], rp[1]);
    sleep(5000);
    dismissIdle();
    var m1 = shot();
    var ok = !!(m1 && onBoard(m1, CFG.area));
    if (!ok) say('enterBoard 判定：没进到棋盘');
    return ok;
}
function closeBoard() {
    $act.click(CFG.closeBtn[0], CFG.closeBtn[1]);
    sleep(1800);
}

// ==================== 是否在声纳棋盘（防盲点） ====================
function boardLike(rgb) {
    if (!rgb) return false;
    // 棋盘格约 (90,134,152)：偏亮、偏青，蓝明显高于红；
    // 海面约 (15,68,98) 或 (24,118,129)：红很低，用 R>=60 就能排掉。
    return rgb[0] >= 60 && rgb[1] >= 110 && rgb[2] >= 125 &&
           rgb[2] > rgb[0] + 25 && rgb[1] > rgb[0] + 20;
}
// 判断「现在画面是不是这块棋盘」。
// 不看「格子是不是空的」——因为格子可能已经打过（暗水坑）或命中（亮残骸）。
// 只看菱形内部是不是「非海水」：海水比棋盘和打过/命中的格子都暗且偏蓝。
function waterLike(c) {
    return !!(c && c[2] < 105 && c[1] < 85 && c[0] < 30);
}
function onBoard(mat, area) {
    var b = boardOf(area || CFG.area);
    if (!b || !mat) return false;
    var q = b.quad, T = q[0], R = q[1], B = q[2], L = q[3];
    var ok = 0, tot = 0, i, j;
    for (i = 0; i <= 12; i++) {
        for (j = 0; j <= 12; j++) {
            var u = 0.06 + i * 0.88 / 12, v = 0.06 + j * 0.88 / 12;
            var x = Math.round(T[0] + (R[0] - T[0]) * u + (L[0] - T[0]) * v + (B[0] + T[0] - R[0] - L[0]) * u * v);
            var y = Math.round(T[1] + (R[1] - T[1]) * u + (L[1] - T[1]) * v + (B[1] + T[1] - R[1] - L[1]) * u * v);
            var c = px(mat, x, y);
            if (!c) continue;
            tot++;
            if (!waterLike(c)) ok++;
        }
    }
    return tot > 0 && ok >= tot * 0.80;
}
function measureBoard(mat) {
    // 量棋盘尺寸：按「行内命中跨度」量，而不是简单外接框。
    // 简单外接框会被上方的亮色海面/浪花拉大（实测 546×450，真值约 443×362），
    // 所以改成：每行求命中点的跨度（允许 8px 以内的空隙，因为格线与弹坑会断开），
    // 只保留跨度够大的行（≥ 最大跨度的 55%），再用这些行的跨度与纵向范围定尺寸。
    if (!mat) return null;
    var STEP = 2, GAP = 8, MINSPAN = 40;
    var rows = [];
    for (var y = 150; y <= 600; y += STEP) {
        var firstX = -1, lastX = -1, miss = 0, runStart = -1;
        for (var x = 380; x <= 940; x += STEP) {
            var c = px(mat, x, y);
            var hit = c && boardLike(c);
            if (hit) {
                if (firstX < 0) firstX = x;
                lastX = x; miss = 0; runStart = -1;
            } else if (firstX >= 0) {
                miss += STEP;
                if (miss > GAP) {
                    if (runStart < 0) runStart = x;
                }
            }
        }
        if (firstX >= 0 && (lastX - firstX) >= MINSPAN) rows.push([y, firstX, lastX]);
    }
    if (rows.length < 8) return null;
    var maxSpan = 0, i;
    for (i = 0; i < rows.length; i++) {
        var sp = rows[i][2] - rows[i][1];
        if (sp > maxSpan) maxSpan = sp;
    }
    var keep = [], th = Math.max(MINSPAN, maxSpan * 0.55);
    for (i = 0; i < rows.length; i++) {
        if ((rows[i][2] - rows[i][1]) >= th) keep.push(rows[i]);
    }
    if (keep.length < 5) return null;
    // ★ 高度必须用「所有有效行」的首末行。菱形上下两端的行很短，会被上面的 55% 过滤掉，
    //   只用 keep 会把高度量小（实测 280，真值 370），进而认错海域号。
    var minY = rows[0][0], maxY = rows[rows.length - 1][0];
    var w = maxSpan, h = maxY - minY;
    var best = null, bestScore = 1e9;
    for (var a = 1; a <= 10; a++) {
        var q = levels.builtinQuadOf(a);
        if (!q) continue;
        var xs = [q[0][0], q[1][0], q[2][0], q[3][0]];
        var ys = [q[0][1], q[1][1], q[2][1], q[3][1]];
        var w0 = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        var h0 = Math.max.apply(null, ys) - Math.min.apply(null, ys);
        var sc = Math.abs(w - w0) / w0 + Math.abs(h - h0) / h0;
        if (sc < bestScore) { bestScore = sc; best = a; }
    }
    say('量到棋盘 ' + w + '×' + h + '（有效行 ' + keep.length + '），最像 ' + best + ' 号（误差 ' + bestScore.toFixed(3) + '）');
    if (bestScore > 0.18) return null;
    return { area: best, w: w, h: h, score: bestScore };
}
function detectArea(mat) {
    var m = measureBoard(mat);
    if (!m) return null;
    return m.area;
}
function boardScreen(cb) {
    snapMat(function (m) { cb(!!(m && onBoard(m, CFG.area))); }, 1);
}

function px(m, x, y) {
    var h = ih.getPixelColor(m, x, y);
    if (!h || h.length < 8) return null;
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}

// 在「进行中的活动」列表里找「声呐巡逻」那一行的绿色箭头：
//   右侧 x 1150~1230 有绿色箭头，且该行左侧缩略图是蓝色海水（B 远大于 R）
// 找到返回箭头 y，找不到返回 -1
function findSonarArrowY(m) {
    var blueY = -1, bestBlue = -1, y, i;
    for (y = 200; y <= 700; y += 6) {
        var sum = 0, n = 0;
        for (i = 860; i <= 960; i += 10) {
            var d = px(m, i, y);
            if (d) { sum += (d[2] - d[0]); n++; }
        }
        if (!n) continue;
        var bl = sum / n;
        if (bl > bestBlue) { bestBlue = bl; blueY = y; }
    }
    if (bestBlue < 60) return -1;
    for (y = blueY + 40; y <= 700; y += 6) {
        var green = 0;
        for (i = 1150; i <= 1230; i += 6) {
            var c = px(m, i, y);
            if (c && c[1] > 140 && c[1] - c[0] > 50 && c[1] - c[2] > 50) green++;
        }
        if (green >= 4) return y;
    }
    return -1;
}

// 进入声纳棋盘。实测两种界面：
//   A) 「进行中的活动」列表（右侧绿色箭头）  -> 点声呐巡逻那行的箭头 (1187, y)
//   B) 首次的「声呐巡逻」三栏介绍面板        -> 点任意处（640,360）关闭
// 每一步之后都重新截图确认；确认不到棋盘就不再往下点（棋盘中心会真的发射炮弹）
function ensureBoard(cb) {
    var rounds = 0;
    function round() {
        boardScreen(function (ok) {
            if (ok) { say('在棋盘上'); return cb(true); }
            if (rounds++ >= 5) { say('多次尝试仍不在声纳棋盘，中止（不盲点）'); return cb(false); }
            say('进入第 ' + rounds + ' 轮');
            try { /*$app.run 已移除*/ 0; } catch (e) { }
            sleep(3200);
            say('点活动图标');
            $act.click(CFG.actIcon[0], CFG.actIcon[1]);
            sleep(2600);
            snapMat(function (m) {
                if (!m) { say('截图失败'); return setTimeout(round, 1500); }
                if (onBoard(m, CFG.area)) { say('在棋盘上'); return cb(true); }
                if (m.getHeight() > m.getWidth()) { say('游戏不在前台（竖屏），重来'); return setTimeout(round, 1500); }
                try { $file.copy(SNAP, '/sdcard/Download/海岛助手/_dbg_panel.png'); say('已存 _dbg_panel.png'); } catch (e) { say('存图失败 ' + e); }
                var ay = findSonarArrowY(m);
                if (ay > 0) {
                    say('找到声呐巡逻行 y=' + ay + '，点箭头');
                    $act.click(1187, ay);
                    sleep(4200);
                    return boardScreen(function (k) {
                        if (k) { say('在棋盘上'); return cb(true); }
                        setTimeout(round, 1200);
                    });
                }
                say('没看到活动列表，按介绍面板处理：点任意处');
                $act.click(640, 360);
                sleep(2600);
                boardScreen(function (k2) {
                    if (k2) { say('在棋盘上'); return cb(true); }
                    setTimeout(round, 1200);
                });
            }, 1);
        });
    }
    round();
}

// ==================== 断网 ====================
// 为什么要有 sync 兜底：
//   从「客户端运行按钮 / $engine.run」启动时，netControl 的异步回调可靠；
//   但从调试通道（adb broadcast runJs / WS runJsCode）启动的实例，异步回调一个都不触发。
//   那种实例里只有 $root.exeRootShellSync 能用（且此时没有 UI，主线程不是 UI 线程，不会假死）。
//   所以：先走 netControl（正常路径），失败再走 sync 直连 iptables（调试路径）。

var PKG = { 0: 'com.tencent.tmgp.supercell.boombeach', 1: 'com.supercell.boombeach' };

var CMD_PATH = '/sdcard/Download/海岛助手/_net_cmd.txt';
var ACK_PATH = '/sdcard/Download/海岛助手/_net_ack.txt';
// 子脚本里 $root 不可用 → 交给主实例（main.js 的 root 桥）代跑
// 「是不是在声纳棋盘」的**与海域号无关**的判据：左上角那个红 × 只在棋盘上有。
// 进棋盘时还不知道海域号，所以不能用 onBoard(mat, area)。
function onBoardAny(m) {
    if (!m) return false;
    return findTpl(m, 'close', 0, 0, 150, 120, 0.75) !== null;
}

// 不看海域号地把棋盘打开（进去之后再 detectArea）
function ensureBoardAny() {
    var m = shot();
    if (onBoardAny(m)) { say('已在棋盘上'); return true; }
    for (var k = 1; k <= 4; k++) {
        say('进棋盘 第 ' + k + ' 次尝试');
        var ap = findBtn('act');
        if (!ap) { say('找不到活动图标，跳过这一轮'); sleep(1500); continue; }
        $act.click(ap[0], ap[1]);
        sleep(2600);
        m = shot();
        if (onBoardAny(m)) { say('已在棋盘上'); return true; }
        // 介绍面板（第一次进会弹）→ 点任意处；活动列表 → 点声呐行箭头
        if (findTpl(m, 'sonar_row', 800, 260, 1280, 620, 0.85)) {
            var rp = findBtn('arrow');
            $act.click(rp[0], rp[1]);
        } else {
            say('没看到声呐行，按介绍面板处理：点任意处');
            $act.click(640, 360);
            sleep(2200);
            var ap2 = findBtn('act');
            if (ap2) { $act.click(ap2[0], ap2[1]); sleep(2400); }
            var rp2 = findBtn('arrow');
            if (rp2) { $act.click(rp2[0], rp2[1]); }
        }
        sleep(4800);
        dismissIdle();
        m = shot();
        if (onBoardAny(m)) { say('已在棋盘上'); return true; }
    }
    say('多次尝试仍进不去棋盘，中止（不盲点）');
    return false;
}

function bridgeSh(cmd) {
    var id = String(Date.now()) + "_" + Math.floor(Math.random() * 10000);
    try { $file.write(id + "|" + cmd, CMD_PATH); }
    catch (e) { return { code: -1, out: "", err: '写命令失败: ' + e }; }
    var t0 = Date.now(), raw = '';
    while (Date.now() - t0 < 12000) {
        try { raw = String($file.read(ACK_PATH) || ''); } catch (e) { raw = ''; }
        if (raw) {
            try {
                var o = JSON.parse(raw);
                if (o && o.id === id) return o;
            } catch (e2) { }
        }
        sleep(150);
    }
    return { code: -2, out: "", err: '等待主实例 root 超时' };
}
function rootSync(cmd) {
    // 在主实例里优先用同步 root（实测可用）
    try {
        var o = $root.exeRootShellSync(cmd);
        if (o !== null && o !== undefined) return String(o);
    } catch (e) { say('同步root异常：' + (e && e.message ? e.message : e)); }
    var r = bridgeSh(cmd);
    if (r.code === -2) throw new Error('root 桥超时');
    return String(r.out || "");
}
function syncUid() {
    var pkg = PKG[CFG.serverType];
    var out = rootSync("dumpsys package " + pkg + " | grep -m1 'userId='");
    var m = out.match(/userId=(\d+)/);
    return m ? parseInt(m[1]) : 0;
}
function syncOn(uid) {
    rootSync('iptables -w -I OUTPUT 1 -m owner --uid-owner ' + uid + ' -p tcp -j DROP');
}
function syncOff(uid) {
    for (var i = 0; i < 5; i++) {
        var o = '';
        try { o = rootSync('iptables -w -D OUTPUT -m owner --uid-owner ' + uid + ' -p tcp -j DROP'); }
        catch (e) { break; }
        if (String(o).indexOf('Bad rule') >= 0 || String(o).indexOf('No chain') >= 0) break;
    }
}
var _syncUidCache = 0;
function netEnable() {
    // 只用同步 root：一旦碰过异步 $root.exeRootShell，同步通道就会被毒死
    say('断网：取 UID…');
    try {
        _syncUidCache = syncUid();
    } catch (e) {
        return { ok: false, err: '取 UID 异常：' + (e && e.message ? e.message : e) };
    }
    if (!_syncUidCache) return { ok: false, err: '取不到 UID' };
    say('UID=' + _syncUidCache + '，加丢包规则…');
    try { syncOff(_syncUidCache); } catch (e0) { }   // 先清残留，否则旧规则会让核验假通过
    try {
        syncOn(_syncUidCache);
    } catch (e2) {
        return { ok: false, err: '加规则失败：' + (e2 && e2.message ? e2.message : e2) };
    }
    // ★ 必须核验规则真的插进去了：这一步以前没有，导致规则没生效时照发，
    //   那一发就真的提交给服务器（2026-11-15 实测因此白扣 1 发）。
    var _chk = '';
    try { _chk = String(rootSync("iptables -w -S OUTPUT | grep -c 'uid-owner " + _syncUidCache + "'") || ''); } catch (e3) { _chk = ''; }
    var _rn = parseInt((_chk.match(/([0-9]+)/) || [0, '0'])[1], 10);
    if (_rn !== 1) return { ok: false, err: '断网规则数异常（核验=' + _chk + '，应为 1 条），不发弹' };
    say('已断网（sync）并核验，规则数=1');
    return { ok: true, via: 'sync' };
}
function netDisable() {
    if (!_syncUidCache) return { ok: true };
    try { syncOff(_syncUidCache); say('已恢复网络（sync）'); return { ok: true }; }
    catch (e) { say('恢复网络异常：' + (e && e.message ? e.message : e)); return { ok: false }; }
}

function grayDialog(mat) {
    var n = 0, tot = 0;
    for (var x = 480; x <= 800; x += 20) {
        for (var y = 230; y <= 490; y += 20) {
            var rgb = hexToRgb(ih.getPixelColor(mat, x, y));
            if (!rgb) continue;
            tot++;
            var mx = Math.max(rgb[0], rgb[1], rgb[2]), mn = Math.min(rgb[0], rgb[1], rgb[2]);
            var lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
            if (mx - mn < 12 && lum >= 40 && lum <= 115) n++;
        }
    }
    return tot > 0 && n > tot * 0.6;
}
// ==================== 在线直打（不用断网）====================
// 适用：炮弹数 >= 空格数（比如 1号海域 3×3 只有 9 格，手上 18 发）。
// 在线打的结果是立即显示在格子上的，不需要退出重进。
// ==================== 主流程 ====================
var S = { board: null, states: null, probed: 0, hits: 0, misses: 0, known: {} };

// ==================== 单实例守卫 ====================
// 现象：同一次运行会出现两份完全相同的日志（点两次同格子、白烧两发炮弹）。
// 原因：点「启动」时 require 被重复触发 / 上一次的运行没退。
// 做法：用一个自增「代次」文件，后来的实例把自己作废。
var RUNID_PATH = '/sdcard/Download/海岛助手/_sonar_runid.txt';
var MY_RUNID = String(Date.now()) + '_' + Math.floor(Math.random() * 100000);
try { $file.write(MY_RUNID, RUNID_PATH); } catch (e) { }
function iamStillOwner() {
    try {
        var cur = $file.read(RUNID_PATH);
        return String(cur).trim() === MY_RUNID;
    } catch (e) { return false; }
}


// ==================== 探测地图（一格一个会话） ====================
// 用户给的规则（m03839）：
//   断网后一次进游戏只能看一格的结果；想看别的格子必须杀掉游戏重开。
//   所以：每次只探一格 -> 记录 -> 杀掉游戏 -> 恢复网络 -> 重开 -> 下一个格子。
//   全部探完后，恢复网络，再一次把所有「有潜艇」的格子点掉。
var MAP_PATH = '/sdcard/Download/海岛助手/_sonar_map.json';
var M = null;   // { area, n, cells: { "r,c": 0|1 }, done:{...} }

function mapLoad(area, n) {
    var o = null;
    // 第一次跑时地图文件还不存在，$file.read 会打一条「源文件不存在」警告 → 先判存在再读
    try { if ($file.exists(MAP_PATH)) o = JSON.parse($file.read(MAP_PATH)); } catch (e) { o = null; }
    if (!o || o.area !== area || o.n !== n) o = { area: area, n: n, cells: {} };
    return o;
}
function mapSave() {
    try { $file.write(JSON.stringify(M), MAP_PATH); } catch (e) { }
}
function cellKey(r, c) { return r + ',' + c; }

// 起游戏 / 杀游戏（都用 root，超时也当成功）
// 启动游戏后轮询等待（不再死等 55 秒）：认出棋盘或主基地就算起来了。
// 死等的坏处：游戏没起来也照样往下走，回调链一断就永久卡住。
function startGame(cb) {
    sh('monkey -p ' + PKG[CFG.serverType] + ' -c android.intent.category.LAUNCHER 1', function () {
        say('已启动游戏，等待载入（轮询）');
        var waited = 0;
        function tick() {
            waited += 3000;
            var m = shot();
            var up = false;
            if (m) {
                if (onBoardAny(m)) up = true;
                else {
                    // 主基地：右下角有蓝弹图标（说明是基地工具条）或左上角有等级圆
                    var c = px(m, 70, 40);
                    if (c && c[0] < 80 && c[1] > 90 && c[2] > 120) up = true;
                }
            }
            if (up) { say('游戏已就绪（等了 ' + Math.round(waited / 1000) + ' 秒）'); return cb(); }
            if (waited >= 90000) { say('❗等 90 秒游戏仍未就绪，中止'); return cb('timeout'); }
            setTimeout(tick, 3000);
        }
        setTimeout(tick, 3000);
    });
}
function killGame(cb) {
    sh('nsenter -t 1 -m am force-stop ' + PKG[CFG.serverType] + ' 2>/dev/null || am force-stop ' + PKG[CFG.serverType], function () {
        say('已强停游戏（丢弃这一发）');
        setTimeout(cb, 2500);
    });
}

// ==================== 强停（带核验）====================
// 旧版不管强停成没成都说「已强停」，然后立刻 netDisable()。
// root 抖动导致强停失败时，游戏还活着、网又通了 -> 它会把挂起的那一发补发上去 -> 白扣。
// 所以必须用 pidof 核验进程真的没了；三次还活着 -> 保持断网并中止，绝不恢复网络。
function killGameVerified(cb, tryNo) {
    tryNo = tryNo || 1;
    sh('nsenter -t 1 -m am force-stop ' + PKG[CFG.serverType] + ' 2>/dev/null || am force-stop ' + PKG[CFG.serverType], function () {
        setTimeout(function () {
            var pid = '';
            try { pid = String(rootSync('pidof ' + PKG[CFG.serverType]) || '').trim(); } catch (e) { pid = ''; }
            if (!pid) { say('已确认进程已退出（第 ' + tryNo + ' 次）'); return cb(true); }
            say('❗进程还在（pid=' + pid + '），重试强停 ' + tryNo);
            if (tryNo >= 3) { say('❗三次强停仍存活，保持断网、绝不恢复网络'); return cb(false); }
            killGameVerified(cb, tryNo + 1);
        }, 900);
    });
}

// ==================== WiFi 伪重启（主方案，约 25 秒）====================
// 不杀进程：断链路 -> 逼出「连接中断」-> 删 DROP -> 点重试 -> 游戏自己重新载入
// 重载会把内存里那一发丢掉，服务器从没收到过，所以不扣炮弹。
// 返回 true=成功（已重新进棋盘）；false=失败（调用方切副方案）
function wifiPseudoRestart() {
    say('丢弃(主)：WiFi 伪重启');
    try {
        sh("su -c \"nohup sh -c 'svc wifi disable; sleep 4; svc wifi enable' >/dev/null 2>&1 &\"");
    } catch (e) { say('下发 WiFi 切换异常：' + (e && e.message ? e.message : e)); return false; }
    sleep(16000);                       // 等 WiFi 自己回来 + 游戏弹窗
    var mat = shot();
    var has = mat ? grayDialog(mat) : false;
    if (!has) { say('等 16 秒没见到「连接中断」弹窗'); return false; }
    say('见到「连接中断」弹窗');
    netDisable();                       // ★ 先删 DROP，否则点重试还是断网
    $act.click(CFG.retryBtn[0], CFG.retryBtn[1]);   // 立即点，不留空窗（防客户端补发）
    say('已点重试，等游戏自己重载');
    sleep(9000);
    dismissIdle();
    if (!enterBoard()) { say('重载后没能回到棋盘'); return false; }
    return true;
}

// ==================== 丢弃调度 ====================
function discardShot(cb) {
    if (CFG.discardMode === 'wifi') {
        var ok = false;
        try { ok = wifiPseudoRestart(); } catch (e) { say('WiFi 伪重启异常：' + (e && e.message ? e.message : e)); }
        if (ok) { say('丢弃(主)完成'); return cb(true); }
        say('丢弃(主)失败 → 切副方案');
    }
    say('丢弃(副)：强停重开');
    killGameVerified(function (dead) {
        if (!dead) { say('❗无法确认进程退出，保持断网并中止'); return cb(false); }
        netDisable();
        startGame(function () { setTimeout(function () { cb(true); }, 3000); });
    });
}

// ==================== 按图找按钮（插件版 findImg）====================
var _tplCache = {};
function tplMat(name) {
    if (_tplCache[name]) return _tplCache[name];
    var path = '/sdcard/Download/海岛助手/res/sonar_tpl/' + name + '.png';
    var m = null;
    try { m = ih.readMat(path); } catch (e) { say('readMat异常(' + name + ')：' + (e && e.message ? e.message : e)); m = null; }
    if (m) { _tplCache[name] = m; say('[诊断] tplMat(' + name + ') = ' + m.getWidth() + 'x' + m.getHeight()); }
    else { say('[诊断] ❗tplMat(' + name + ') = null（路径 ' + path + '）'); }
    return m;
}
// 用图色插件的 findImgFast 找模板（threshold 在前，ROI 是像素，内部不缩放）
// 官方图色工具 TuSeToolWPF 的代码生成器用的就是这个，不是 findImg。
// 返回模板中心 [x, y]；找不到返回 null。
function findTplBig(big, name, sx, sy, ex, ey, thr) {
    if (!big) return null;
    var small = tplMat(name);
    if (!small) return null;
    var W = 0, H = 0;
    try { W = big.getWidth(); H = big.getHeight(); } catch (e) { }
    var x1 = Math.max(0, sx || 0), y1 = Math.max(0, sy || 0);
    var x2 = Math.min(W, (ex === undefined ? W : ex));
    var y2 = Math.min(H, (ey === undefined ? H : ey));
    if (x2 <= x1 || y2 <= y1) return null;
    // ★ 插件的范围参数是「全分辨率写法 0~10000」的归一化坐标，不是像素！
    // 技能 auto-god-image-plugin「注意事项」第 4 条明确写了。传像素会把 ROI 缩成左上角一小块。
    var nx = function (px, total) { return Math.round(px * 10000 / total); };
    var arr = null;
    try { arr = ih.findImgFast(big, small, thr || 0.85,
                               nx(x1, W), nx(y1, H), nx(x2, W), nx(y2, H), 1, false); }
    catch (e) { say('[诊断] findImgFast 异常(' + name + ')：' + (e && e.message ? e.message : e)); return null; }
    if (!arr || !arr.length) { say('[诊断] findImgFast 无命中(' + name + ') thr=' + (thr || 0.85)); return null; }
    var o = arr[0];
    return [Math.round((o.left + o.right) / 2), Math.round((o.top + o.bottom) / 2)];
}
// 兼容旧调用：内部自己抓一张 $screen.getScreen()
function findTpl(m, name, sx, sy, ex, ey, thr) {
    // m 必须是 Mat（shot() 给的截屏）。绝不能在这里再调 $screen.getScreen()，
    // 那返回的是 Image 不是 Mat，findImgFast 会报「第 1 张图片请使用Mat格式图片」。
    return findTplBig(m, name, sx, sy, ex, ey, thr);
}
var _missCnt = { act: 0, arrow: 0, blue: 0, red: 0, close: 0 };
// 找不到就返回 null —— 绝不拿兜底坐标硬点（那是空炸的来源）。
// 先切游戏到前台再截一次图，因为 AutoGOD 被顶前台时会截到它自己。
function findBtn(name) {
    var p = _findBtnOnce(name);
    if (p) return p;
    try { $app.run(PKG[CFG.serverType]); } catch (e) { }
    sleep(1500);
    p = _findBtnOnce(name);
    if (p) return p;
    _missCnt[name] = (_missCnt[name] || 0) + 1;
    say('❗找不到按钮「' + name + '」（第 ' + _missCnt[name] + ' 次），不盲点');
    return null;
}
function _findBtnOnce(name) {
    var m = shot();
    if (!m) return null;
    var p = null;
    if (name === 'act') p = findTpl(m, 'act', 1140, 100, 1280, 520, 0.78);
    else if (name === 'close') p = findTpl(m, 'close', 0, 0, 150, 120, 0.75);
    else if (name === 'blue') p = findTpl(m, 'blue', 1040, 590, 1180, 720, 0.85);
    else if (name === 'red') p = findTpl(m, 'red', 1160, 590, 1280, 720, 0.85);
    else if (name === 'arrow') {
        // 先找「声呐巡逻」那一行的缩略图，再按固定偏移推到右侧绿色箭头
        var r0 = findTplBig(m, 'sonar_row', 820, 300, 1280, 560, 0.80);
        if (r0) p = [r0[0] + CFG.sonarOffset[0], r0[1] + CFG.sonarOffset[1]];
    }
    if (p) _missCnt[name] = 0;
    return p;
}


// 探测一个格子（一个会话只探一格）
function probeOne(b, r, c, done) {
    var p = centerOf(b, r, c);
    say('--- 探测 (' + r + ',' + c + ') 格心 ' + p[0] + ',' + p[1] + ' ---');
    var ne = netEnable();
    if (!ne || !ne.ok) { say('断网失败：' + (ne && ne.err ? ne.err : '未知')); return done(null); }
    say('已断网 UID=' + _syncUidCache);
    if (!enterBoard()) { say('进棋盘失败（打之前），放弃这一格（不发弹）'); netDisable(); return done(null); }
    setTimeout(function () {
        var bp = findBtn('blue');
        if (!bp) { say('找不到蓝弹按钮，放弃这一格（不盲点、不发弹）'); return done(null); }
        $act.click(bp[0], bp[1]); sleep(700);
        $act.click(p[0], p[1]); sleep(2300);
        say('已发射');
        var cp = findBtn('close');
        if (!cp) { say('找不到关闭 ×，放弃这一格'); return done(null); }
        $act.click(cp[0], cp[1]); sleep(2600);
        if (!enterBoard()) { say('关棋盘后重进失败，读数不可靠，放弃这一格'); return done(null); }
        setTimeout(function () {
            snapMat(function (m) {
                if (!m) { say('读结果失败（截图无效）'); return done(null); }
                var st = readStates(b, m)[r][c];
                var nm = (st === ST_EMPTY ? '没打中/空' : (st === ST_HIT ? '命中潜艇' : '打空(水坑)'));
                say('结果 = ' + nm + '  code=' + st);
                done(st);
            }, 4);
        }, 6500);
    }, 5500);
}

var FLOW = { order: [], idx: 0, b: null };
var ACC = { ok: 0, fail: 0 };

function bootGame(cb) {
    say('重启游戏（保证一个干净会话）');
    killGame(function () {
        netDisable();
        say('网络已恢复');
        startGame(function () { setTimeout(cb, 4000); });
    });
}

function probeStep() {
    if (!iamStillOwner()) { say('检测到更新的实例，停止'); return finish(); }
    if (FLOW.idx >= FLOW.order.length) {
        say('探测阶段完成：成功 ' + ACC.ok + ' 格，失败 ' + ACC.fail + ' 格');
        return clearStart();
    }
    var rc = FLOW.order[FLOW.idx];
    ensureBoard(function (okB) {
        if (!okB) { say('未能进入棋盘，跳过 (' + rc[0] + ',' + rc[1] + ')'); ACC.fail++; FLOW.idx++; return bootGame(probeStep); }
        probeOne(FLOW.b, rc[0], rc[1], function (st) {
            if (st !== null && st !== ST_UNKNOWN) { M.cells[cellKey(rc[0], rc[1])] = st; mapSave(); ACC.ok++; }
            else { ACC.fail++; }
            FLOW.idx++;
            // 丢弃这一发：WiFi 伪重启为主（约 25s），失败自动切强停重开（约 50s）
            discardShot(function (okDiscard) {
                if (!okDiscard) { say('丢弃失败，为安全停止（不继续发弹）'); return finish(); }
                setTimeout(probeStep, 800);
            });
        });
    });
}

// ==================== 清海域：只打已确认有潜艇的格子 ====================
var CLEAR = { list: [], i: 0 };
function clearStart() {
    var hits = [];
    for (var k in M.cells) if (M.cells[k] === ST_HIT) hits.push(k.split(',').map(Number));
    say('地图里确认有潜艇的格子：' + hits.length + ' 个');
    if (!hits.length) { say('没探到潜艇，结束（不空炸）'); return finish(); }
    CLEAR.list = hits; CLEAR.i = 0;
    ensureBoard(function (ok) {
        if (!ok) { say('未能进入棋盘，结束'); return finish(); }
        var m0 = shot();
        var det0 = m0 ? detectArea(m0) : null;
        if (det0 && det0 !== CFG.area) { say('❗海域已变成 ' + det0 + '（地图是 ' + CFG.area + '），停止清场'); return finish(); }
        say('开始清：网络保持畅通');
        clearStep();
    });
}
// 清场：一发一确认。上次 4 号海域误打 3 发，就是因为这里一口气打完不确认。
function clearStep() {
    if (CLEAR.i >= CLEAR.list.length) { say('清场完成，共 ' + CLEAR.list.length + ' 发'); return finish(); }
    var m = shot();
    if (!m) { say('截图失败，停止清场'); return finish(); }
    if (!onBoardAny(m)) { say('不在棋盘上了，停止清场'); return finish(); }
    var det = detectArea(m);
    if (det && det !== CFG.area) { say('❗海域已变成 ' + det + '（原 ' + CFG.area + '），停止清场'); return finish(); }
    var bd = boardOf(CFG.area);
    if (!bd) { say('海域 ' + CFG.area + ' 没有标定数据，停止'); return finish(); }
    FLOW.b = bd;

    var rc = CLEAR.list[CLEAR.i];
    var p = centerOf(bd, rc[0], rc[1]);
    say('炸第 ' + (CLEAR.i + 1) + '/' + CLEAR.list.length + ' 发 (' + rc[0] + ',' + rc[1] + ') 格心 ' + p[0] + ',' + p[1]);
    var bp = findBtn('blue');
    if (!bp) { say('找不到蓝弹按钮，停止清场（不盲点）'); return finish(); }
    $act.click(bp[0], bp[1]); sleep(900);
    $act.click(p[0], p[1]); sleep(2600);
    setTimeout(function () {
        var m2 = shot();
        if (!m2) { say('打后截图失败，停止清场'); return finish(); }
        var st = readStates(bd, m2)[rc[0]][rc[1]];
        if (st === ST_EMPTY) {
            say('❗这一发好像没打出去（该格还是空的），停止清场，避免继续空炸');
            return finish();
        }
        CLEAR.i++;
        setTimeout(clearStep, 900);
    }, 1800);
}

function main() {
    say('========== 断网探测开始 ==========');
    say('实例ID ' + MY_RUNID);
    if (!iamStillOwner()) { say('检测到有更新的实例，本实例退出'); return; }
    if (!initPlugin()) { say('插件初始化失败'); return; }
    say('插件已就绪');
    // 把游戏切到前台：截图只能截到前台应用，AutoGOD 留在前台就只会截到自己。
    // （root 不需要 AutoGOD 在前台，已实测：后台调 su 只用 4ms）
    try { $app.run(PKG[CFG.serverType]); } catch (e) { say('切前台失败：' + (e && e.message ? e.message : e)); }
    sleep(4000);
    say('已切到游戏前台');

    // ★ 先把棋盘打开（此时还不知道海域号），再认海域号
    if (!ensureBoardAny()) return finish();
    snapLandscape(function (_m) {
        var _det = _m ? detectArea(_m) : null;
        if (_det && _det !== CFG.area) { say('自动识别：' + _det + ' 号海域（配置是 ' + CFG.area + '），已切换'); CFG.area = _det; }
        else if (!_det) { say('认不出海域号，中止（不盲点）'); return finish(); }
        else { say('海域号 ' + CFG.area + ' 与实测一致'); }
        afterArea();
    });
}

function afterArea() {
    FLOW.b = boardOf(CFG.area);
    if (!FLOW.b) { say('海域 ' + CFG.area + ' 没有标定数据'); return finish(); }
    M = mapLoad(CFG.area, FLOW.b.n);
    say('海域 ' + CFG.area + ' ' + FLOW.b.n + '×' + FLOW.b.n + '，已记录 ' + Object.keys(M.cells).length + ' 格');

    var n = FLOW.b.n, mid = (n - 1) / 2, all = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++)
        if (M.cells[cellKey(r, c)] === undefined) all.push([r, c]);
    all.sort(function (a, b) {
        return (Math.abs(a[0] - mid) + Math.abs(a[1] - mid)) - (Math.abs(b[0] - mid) + Math.abs(b[1] - mid));
    });
    if (CFG.maxProbe > 0 && all.length > CFG.maxProbe) all = all.slice(0, CFG.maxProbe);
    FLOW.order = all; FLOW.idx = 0;
    say('待探测 ' + all.length + ' 格');

    // 没东西要探就直接进清理阶段
    if (!all.length) { say('没有待探测格子，直接清'); return clearStart(); }
    setTimeout(probeStep, 500);
}

function sh(cmd, cb) {
    if (typeof cb !== 'function') cb = function () { };
    // 2026-11-15 实测结论：这个实例里 **同步版** $root.exeRootShellSync 稳定可用（4ms 返回），
    // 而异步版 $root.exeRootShell 的回调经常不触发（就是日志里「root 超时」的来源）。
    // 所以这里直接用同步版，执行完立刻回调，不再有 12 秒超时。
    var out = '';
    try {
        out = String($root.exeRootShellSync(cmd) || '');
        return cb(null, out);
    } catch (e) {
        var msg = (e && e.message) ? e.message : String(e);
        try { $log.e('[声纳] root 异常: ' + cmd + ' → ' + msg); } catch (e2) { }
        return cb(msg, '');
    }
}

var UID = 0;
function finish() {
    say('========== 结束，共探测 ' + S.probed + ' 格 ==========');
    say('最终棋盘：' + (S.states ? boardText(S.states) : '（还没读到棋盘）'));
    // 安全兜底：无论怎么退出的，都必须把 DROP 规则清干净，绝不让游戏留在断网状态
    try {
        var pk = net.resolvePackage(CFG.serverType) || '';
        var uid = UID;
        var cmds = [];
        if (uid) {
            cmds.push('iptables -w -D OUTPUT -m owner --uid-owner ' + uid + ' -p tcp -j DROP');
            cmds.push('iptables -w -D OUTPUT -m owner --uid-owner ' + uid + ' -j DROP');
        }
        cmds.push('iptables -S OUTPUT | grep -c uid-owner');
        for (var i = 0; i < cmds.length; i++) { try { $root.exeRootShellSync(cmds[i]); } catch (e) { } }
        say('已执行断网规则清理兜底');
    } catch (e) { say('清理兜底异常：' + (e && e.message ? e.message : e)); }
}

// ==================== 入口 ====================
try {
    if (USE_FLOATY) { try { floatys.show(); } catch (e) { } }
    main();
} catch (e) {
    try { say('异常：' + (e && e.message ? e.message : e)); } catch (e2) { log('异常:' + e); }
}
