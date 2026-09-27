/**
* 最简单的权限获取（带状态提示）
*/
function getScreenPermission() {
    // 先检查是否已有权限
    if ($screen.hasPermit()) {
        log("已有截屏权限");
        return true;
    }

    // 如果没有权限，则获取权限
    log("正在请求截屏权限...");
    $screen.getPermit();

    // 检查最终权限状态
    if ($screen.hasPermit()) {
        log("截屏权限获取成功");
        return true;
    } else {
        log("截屏权限获取失败");
        return false;
    }
}

getScreenPermission(); // 调用权限获取函数



log("开始运行");



let imageHandler = require('./modules/OperHandler.js');


imageHandler.imageHandlerInit(); //只能初始化一次


// ========== 类型诊断：检测截图返回的对象格式 ==========



// ============================================================
// 图色插件：检测四边形并返回多边形拟合点坐标（可复用函数）
// 流程：截图 → HSV → 颜色范围 → 开操作 → 闭操作 → 四边形检测 → 多边形拟合 → 拟合点坐标
// 返回：Point[][]（每个四边形的角点坐标数组）；任一步骤失败或未检测到四边形时返回 null
// 文档来源：冉遗鱼图色插件JS版v4.7.6.doc
//   captureScreenMat()          → 16-图像IO与转换/Mat截图.md
//   getHSV(mat, type)           → 03-颜色处理/获取HSV图像.md
//   inRange(mat, lower, upper)  → 03-颜色处理/颜色范围提取.md
//   open(mat, structType,w,h,ax,ay,it)     → 04-形态学操作/开操作.md
//   close(mat, structType,w,h,ax,ay,it)    → 04-形态学操作/闭操作.md
//   polygonDetection(mat,angles,cmp,minA,maxA,mode,method,eps) → 05-轮廓检测/多边形检测.md
//   approxPolyDP(mat,mode,method,indexArr,thickness,lineType,eps) → 05-轮廓检测/多边形拟合.md
//   getApproxPolyDPPoint(mat,mode,method,indexArr,eps)         → 05-轮廓检测/多边形拟合点.md
// ============================================================
function detectQuadPoints() {
    log("========== 检测四边形并获取拟合点坐标 ==========");
    let srcMat = null, HSV = null, mask = null, opened = null, closed = null, fitted = null;

    try {
        // ---- 第1步：截图（Mat格式同步截图，截取全屏）----
        log(">>> 第1步：截图 captureScreenMat()");
        srcMat = imageHandler.captureScreenMat();
        if (!srcMat) {
            loge("【失败】captureScreenMat() 返回 null，截图失败！");
            log("    可能原因：1. 未授予截图权限 2. 模拟器需 $screen.onlyRecord(true)");
            return null;
        }
        log(">>> 截图成功: " + srcMat);

        // ---- 第2步：RGB → HSV ----
        log(">>> 第2步：转HSV getHSV(srcMat, -1)");
        HSV = imageHandler.getHSV(srcMat, -1);
        if (!HSV) { loge("【失败】getHSV 返回 null"); return null; }
        log(">>> HSV转换成功");

        // ---- 第3步：颜色范围提取 ----
        log(">>> 第3步：颜色范围提取 inRange(HSV, [0,0,90], [180,115,255])");
        mask = imageHandler.inRange(HSV, [0, 0, 90], [180, 115, 255]);
        if (!mask) { loge("【失败】inRange 返回 null"); return null; }
        log(">>> 颜色范围提取成功（掩膜二值图）");

        // ---- 第4步：开操作（圆形结构元素，structType=2 椭圆、宽高相等即圆形）----
        log(">>> 第4步：开操作 open(mask, 2, 5, 5, -1, -1, 1)");
        opened = imageHandler.open(mask, 2, 5, 5, -1, -1, 1);
        if (!opened) { loge("【失败】open 返回 null"); return null; }
        log(">>> 开操作成功");

        // ---- 第5步：闭操作（结构元素 8x8）----
        log(">>> 第5步：闭操作 close(opened, 0, 8, 8, -1, -1, 1)");
        closed = imageHandler.close(opened, 0, 8, 8, -1, -1, 1);
        if (!closed) { loge("【失败】close 返回 null"); return null; }
        log(">>> 闭操作成功");

        // ---- 第6步：多边形检测（四边形，Angles=4，minArea=100）----
        // 文档来源：05-轮廓检测/多边形检测.md → polygonDetection(mat, angles, compareMode, minArea, maxArea, mode, method, epsilon)
        // 注：Angles=4, compareMode=0 表示仅检测四边形（边数等于4）
        log(">>> 第6步：四边形检测 polygonDetection(closed, 4, 0, 100, -1, 0, 2, -1)");
        let polyIndexes = imageHandler.polygonDetection(closed, 4, 0, 100, -1, 0, 2, -1);
        if (!polyIndexes || polyIndexes.length === 0) {
            log(">>> 未检测到四边形（当前画面可能无符合条件的目标）");
            return null;
        }
        log(">>> 检测到 " + polyIndexes.length + " 个四边形，索引: " + JSON.stringify(polyIndexes));

        // ---- 第8步：多边形拟合，生成拟合轮廓图（执行顺序在坐标计算之前）----
        // 文档来源：05-轮廓检测/多边形拟合.md → approxPolyDP(mat, mode, method, contoursIndex, thickness, lineType, epsilon)
        log(">>> 第8步：多边形拟合 approxPolyDP(closed, 0, 2, polyIndexes, 2, 8, -1)");
        fitted = imageHandler.approxPolyDP(closed, 0, 2, polyIndexes, 2, 8, -1);
        if (!fitted) {
            loge("【失败】approxPolyDP 返回 null");
            return null;
        }
        log(">>> 多边形拟合图生成成功");

        // ---- 第7步：多边形拟合点，基于索引数组计算精确坐标 ----
        // 文档来源：05-轮廓检测/多边形拟合点.md → getApproxPolyDPPoint(mat, mode, method, contoursIndex, epsilon)
        log(">>> 第7步：多边形拟合点 getApproxPolyDPPoint(closed, 0, 2, polyIndexes, -1)");
        let points = imageHandler.getApproxPolyDPPoint(closed, 0, 2, polyIndexes, -1);
        if (!points) {
            loge("【失败】getApproxPolyDPPoint 返回 null");
            return null;
        }
        log(">>> 获取到 " + points.length + " 组四边形角点坐标");
        return points;
    } catch (e) {
        loge("检测四边形出错: " + (e.message || e));
        return null;
    } finally {
        // 资源回收（try-finally 确保释放；坐标数组非 Mat，不受回收影响）
        imageHandler.recycle(srcMat, HSV, mask, opened, closed, fitted);
        log(">>> Mat 资源已释放");
    }
}

// ---- 调用示例：获取四边形拟合点坐标（后续业务可直接调用 detectQuadPoints()）----
let quadPoints = detectQuadPoints();
if (quadPoints) {
    for (let pi = 0; pi < quadPoints.length; pi++) {
        log("第" + pi + "个四边形角点坐标: " + JSON.stringify(quadPoints[pi]));
    }
} else {
    log("未获取到四边形坐标（返回 null）");
}
