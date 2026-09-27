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
// 返回：Point[]（第一个检测到的四边形的 4 个角点数组，可直接用 points[0].x / points[0].y 访问）
//      任一步骤失败或未检测到四边形时返回 null
// 参数：srcMatInput（可选）外部传入截图 Mat；传入则复用该图（本函数不回收，由调用方负责回收），
//      未传入则内部自动 captureScreenMat() 并回收
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
function detectQuadPoints(srcMatInput) {
    log("========== 检测四边形并获取拟合点坐标 ==========");
    /**
     * 私有子函数：从现成二值图中提取 3 个完好角点（左下 bl / 右下 br / 下角 bm）
     * 仅接收二值图入参，不重复截图 / HSV / 开闭预处理（单图复用，杜绝二次截图坐标偏移）
     * 只用 3 个轮廓插件函数，分工如下：
     *   ① getContoursArea     → 计算所有白色区域面积，只保留最大的菱形轮廓
     *   ② getContoursLength   → 获取最大菱形轮廓周长，计算简化精度 epsilon = 0.02 * 周长
     *   ③ getApproxPolyDPPoint → 简化轮廓，提取所有拐角坐标
     * 弃用凸包原因：画面顶部文字噪点会被包进凸包，导致菱形变形，故改用
     *   「过滤保留 3 个完好角（左/右/下）+ 反推公式补顶角」方案
     * 返回 [bl 左下, br 右下, bm 下角]；任一步失败返回 null
     */
    function extractThreeFromBinary(binaryMat) {
        if (!binaryMat) return null;
        let imgH = binaryMat.getHeight();
        try {
            // ① getContoursArea：全部白色区域面积，只保留最大的菱形轮廓
            let areas = imageHandler.getContoursArea(binaryMat, 0, 2, null);
            if (!areas || areas.length === 0) {
                log("【兜底】未检测到任何轮廓");
                return null;
            }
            let maxIndex = 0;
            for (let i = 1; i < areas.length; i++) {
                if (areas[i] > areas[maxIndex]) maxIndex = i;
            }
            log("【兜底】最大轮廓索引: " + maxIndex + "，面积: " + areas[maxIndex]);

            // ② getContoursLength：最大轮廓周长 → epsilon = 0.02 * 周长
            let lens = imageHandler.getContoursLength(binaryMat, 0, 2, null);
            let perimeter = (lens && lens[maxIndex] !== undefined) ? lens[maxIndex] : 0;
            let epsilon = 0.02 * perimeter;
            log("【兜底】最大轮廓周长: " + perimeter + "，epsilon: " + epsilon);

            // ③ getApproxPolyDPPoint：轮廓简化，提取所有拐角坐标
            let pointSets = imageHandler.getApproxPolyDPPoint(binaryMat, 0, 2, [maxIndex], epsilon);
            if (!pointSets || !pointSets[0] || pointSets[0].length < 3) {
                log("【兜底】多边形逼近角点不足 3 个");
                return null;
            }
            let vertices = pointSets[0];

            // 过滤顶部 10% 高度内的顶点（剔除文字遮挡的顶角与噪点）
            // 回调 10% 高度过滤：减少顶部文字破碎噪点混入顶点列表，稳定提取底部完整 3 个角点
            let thresholdY = imgH * 0.1;
            let valid = [];
            for (let i = 0; i < vertices.length; i++) {
                let v = vertices[i];
                let y = (v.y !== undefined) ? v.y : v[1]; // 兼容 {x,y} / [x,y]
                let x = (v.x !== undefined) ? v.x : v[0];
                if (y > thresholdY) {
                    valid.push({ x: x, y: y });
                }
            }
            log("【兜底】过滤后角点数: " + valid.length + "（阈值 y>" + thresholdY + "）");
            if (valid.length < 3) {
                log("【兜底】过滤后角点不足 3 个");
                return null;
            }

            // 三点分组（◇ 菱形：左/右/下三角完好，顶角被遮挡缺失）：
            // 1) 按 y 降序排序，y 最大的 = 下角 bm（画面最下方）
            // 2) 剩余两点（y 居中的左右两角）按 x 分：x 小 = 左边角 bl、x 大 = 右边角 br
            valid.sort(function (a, b) { return b.y - a.y; }); // y 降序
            let bm = valid[0]; // 下角（y 最大，画面最底部）
            let rest = valid.slice(1); // 剩余两点 = 左右两角
            let bl = rest[0].x <= rest[1].x ? rest[0] : rest[1]; // 左边角（x 小）
            let br = rest[0].x <= rest[1].x ? rest[1] : rest[0]; // 右边角（x 大）
            log("【兜底】排序后三点: 左下bl(" + bl.x + "," + bl.y + ") 右下br(" + br.x + "," + br.y + ") 下角bm(" + bm.x + "," + bm.y + ")");
            return [bl, br, bm];
        } catch (e) {
            log("【兜底】三点提取出错: " + (e.message || e));
            return null;
        }
    }

    let srcMat = null, HSV = null, mask = null, opened = null, closed = null, fitted = null;

    try {
        // ---- 第1步：截图（Mat格式同步截图，截取全屏；可传入外部截图复用同一张图）----
        if (srcMatInput) {
            // 外部传入截图：复用（不回收，由调用方负责）
            srcMat = srcMatInput;
            log(">>> 使用外部传入截图: " + srcMat);
        } else {
            log(">>> 第1步：截图 captureScreenMat()");
            srcMat = imageHandler.captureScreenMat();
            if (!srcMat) {
                log("【失败】captureScreenMat() 返回 null，截图失败！");
                log("    可能原因：1. 未授予截图权限 2. 模拟器需 $screen.onlyRecord(true)");
                return null;
            }
            log(">>> 截图成功: " + srcMat);
        }

        // ---- 第2步：RGB → HSV ----
        log(">>> 第2步：转HSV getHSV(srcMat, -1)");
        HSV = imageHandler.getHSV(srcMat, -1);
        if (!HSV) { log("【失败】getHSV 返回 null"); return null; }
        log(">>> HSV转换成功");

        // ---- 第3步：颜色范围提取 ----
        log(">>> 第3步：颜色范围提取 inRange(HSV, [0,0,90], [180,115,255])");
        mask = imageHandler.inRange(HSV, [0, 0, 90], [180, 115, 255]);
        if (!mask) { log("【失败】inRange 返回 null"); return null; }
        log(">>> 颜色范围提取成功（掩膜二值图）");

        // ---- 第4步：开操作（圆形结构元素，structType=2 椭圆、宽高相等即圆形，迭代 2 次）----
        log(">>> 第4步：开操作 open(mask, 2, 5, 5, -1, -1, 2)");
        opened = imageHandler.open(mask, 2, 5, 5, -1, -1, 2);
        if (!opened) { log("【失败】open 返回 null"); return null; }
        log(">>> 开操作成功");

        // ---- 第5步：闭操作（结构元素 8x8，迭代 2 次）----
        log(">>> 第5步：闭操作 close(opened, 0, 8, 8, -1, -1, 2)");
        closed = imageHandler.close(opened, 0, 8, 8, -1, -1, 2);
        if (!closed) { log("【失败】close 返回 null"); return null; }
        log(">>> 闭操作成功");

        // ---- 第6步：多边形检测（四边形，Angles=4，minArea=100）----
        // 文档来源：05-轮廓检测/多边形检测.md → polygonDetection(mat, angles, compareMode, minArea, maxArea, mode, method, epsilon)
        // 注：Angles=4, compareMode=0 表示仅检测四边形（边数等于4）
        log(">>> 第6步：四边形检测 polygonDetection(closed, 4, 0, 100, -1, 0, 2, -1)");
        let polyIndexes = imageHandler.polygonDetection(closed, 4, 0, 100, -1, 0, 2, -1);
        if (polyIndexes && polyIndexes.length > 0) {
            log(">>> 检测到 " + polyIndexes.length + " 个四边形，索引: " + JSON.stringify(polyIndexes));

            // ---- 第7步：多边形拟合，生成拟合轮廓图（正常识别路径）----
            // 文档来源：05-轮廓检测/多边形拟合.md → approxPolyDP(mat, mode, method, contoursIndex, thickness, lineType, epsilon)
            log(">>> 第7步：多边形拟合 approxPolyDP(closed, 0, 2, polyIndexes, 2, 8, -1)");
            fitted = imageHandler.approxPolyDP(closed, 0, 2, polyIndexes, 2, 8, -1);
            if (!fitted) {
                log("【失败】approxPolyDP 返回 null");
                return null;
            }
            log(">>> 多边形拟合图生成成功");

            // ---- 第8步：多边形拟合点，获取 4 个完整角点 ----
            // 文档来源：05-轮廓检测/多边形拟合点.md → getApproxPolyDPPoint(mat, mode, method, contoursIndex, epsilon)
            log(">>> 第8步：多边形拟合点 getApproxPolyDPPoint(closed, 0, 2, polyIndexes, -1)");
            let points = imageHandler.getApproxPolyDPPoint(closed, 0, 2, polyIndexes, -1);
            if (points && points[0] && points[0].length === 4) {
                log(">>> 正常识别：4 个完整角点 " + JSON.stringify(points[0]));
                return points[0];
            }
            log(">>> 四边形角点不足 4 个，尝试遮挡兜底");
        } else {
            log(">>> 未检测到四边形，尝试遮挡兜底（不重新截图，复用当前 closed 二值图）");
        }

        // ---- 遮挡兜底：复用 closed 二值图，三点提取 + 反推公式补顶角 ----
        // 三点来源：extractThreeFromBinary（3 个轮廓插件函数 + 顶部 10% 过滤，见函数头部注释）
        // 几何原理：◇ 菱形（左/右/下三角完好，顶角被遮挡缺失）→ tl = bl + br - bm（补缺失的顶角）
        let corners3 = extractThreeFromBinary(closed);
        if (!corners3) {
            log("【失败】三点提取失败，识别失败");
            return null;
        }
        let bl = corners3[0], br = corners3[1], bm = corners3[2];
        // 反推公式补被遮挡的顶角 tl（tl = bl + br - bm）
        let tl = {
            x: bl.x + br.x - bm.x,
            y: bl.y + br.y - bm.y
        };
        // 画布边界约束：强制锁定 tl 坐标在画面内，彻底解决三点外推 y 负数出屏问题
        tl.y = Math.max(0, tl.y);
        tl.x = Math.max(0, Math.min(tl.x, closed.getWidth()));
        log(">>> 遮挡兜底成功：tl(" + tl.x + "," + tl.y + ") bl(" + bl.x + "," + bl.y + ") br(" + br.x + "," + br.y + ") bm(" + bm.x + "," + bm.y + ")");
        log(">>> 校正后 tl 坐标: (" + tl.x + "," + tl.y + ")（已锁定在画面内，宽度=" + closed.getWidth() + "）");
        // 返回 [tl, br, bm, bl]（顶角、右边角、下角、左边角），贴合真实菱形结构，可直接用于 warpPerspective 透视变换
        return [tl, br, bm, bl];
    } catch (e) {
        log("检测四边形出错: " + (e.message || e));
        return null;
    } finally {
        // 资源回收（try-finally 确保释放；坐标数组非 Mat，不受回收影响）
        if (srcMatInput) {
            // 外部传入截图由调用方回收，这里只回收本函数创建的中间 Mat
            imageHandler.recycle(HSV, mask, opened, closed, fitted);
        } else {
            imageHandler.recycle(srcMat, HSV, mask, opened, closed, fitted);
        }
        log(">>> Mat 资源已释放");
    }
}

// ---- 调用示例：获取第一个四边形的 4 个角点坐标（后续业务可直接调用 detectQuadPoints()）----
let quadPoints = detectQuadPoints();
if (quadPoints) {
    for (let pi = 0; pi < quadPoints.length; pi++) {
        log("角点" + pi + ": (" + quadPoints[pi].x + ", " + quadPoints[pi].y + ")");
    }
} else {
    log("未获取到四边形坐标（返回 null）");
}

// ============================================================
// 海岛奇兵声呐识别：透视矫正 → 网格扫描 → 潜艇判定 → 逆透视映射
// 依赖：detectQuadPoints()（获取海域四边形四点，支持传入外部截图复用同一张原图）
// 文档来源：冉遗鱼图色插件JS版v4.7.6.doc
//   warpPerspective(img, srcPoint, dstPoint, width?, height?) → 07-图像运算/透视变换.md
//   matToGray(mat)     → 02-图像预处理/灰度处理.md
//   getPixelColor(mat, x, y) → 03-颜色处理/获取RGB颜色值.md
// ============================================================

// 声呐识别配置（格子数量不硬编码，gridCount 可自由设置 5×5、6×6 等任意 N×N）
const SONAR_CFG = {
    size: 500,        // 矫正正方形画布边长（仅用于统一拉伸，不代表游戏格子）
    gridCount: 3,     // 海域格子数量（N×N，可改为 6、7 等任意值）
    insetRatio: 0.3,  // 内部点向内偏移比例（避开黑色网格边框）
    blackGray: 10,    // 灰度 < 10 → 纯黑空隙
    whiteGray: 200    // 灰度 > 200 → 白色潜艇亮点
};

// 获取灰度图指定点的灰度值（灰度图 R=G=B，取 R 通道即灰度）
function grayValueAt(grayMat, x, y) {
    try {
        let hex = imageHandler.getPixelColor(grayMat, x, y); // 返回 #RRGGBB
        if (!hex || hex.length < 7) return -1;
        return parseInt(hex.substring(1, 3), 16); // R 通道即灰度值
    } catch (e) {
        log("读取灰度值失败 (" + x + "," + y + "): " + e.message);
        return -1;
    }
}

// 声呐识别主流程
function detectSonar() {
    log("========== 海岛奇兵声呐识别开始 ==========");
    let srcMat = null, warped = null, gray = null, invWarped = null;

    try {
        // ---- 第1步：截图（整张原图，供矫正与逆变换使用）----
        log(">>> 第1步：截图 captureScreenMat()");
        srcMat = imageHandler.captureScreenMat();
        if (!srcMat) {
            log("【失败】captureScreenMat() 返回 null，截图失败！");
            return;
        }
        log(">>> 截图成功: " + srcMat);
        // ⚠️ 临时调试：查看效果，后续可删除
        if (srcMat) {
            let saveOk = imageHandler.saveMat(srcMat, "/sdcard/sonar_1_src.png", "png", 100);
            log(saveOk === true ? ">>> 已保存原图: /sdcard/sonar_1_src.png" : "【失败】保存原图: " + saveOk);
        }

        // ---- 第2步：获取海域四边形四点（复用同一张截图，避免两次截图导致的坐标漂移）----
        log(">>> 第2步：detectQuadPoints(srcMat) 获取四边形四点");
        let quadPoints = detectQuadPoints(srcMat);
        if (!quadPoints || quadPoints.length !== 4) {
            log("【失败】未获取到四边形四点，退出");
            return;
        }
        log(">>> 四边形四点: " + JSON.stringify(quadPoints));

        // ---- 第3步：透视变换，将倾斜菱形矫正为正方形画布（src/dst 四点一一对应，逆时针）----
        let size = SONAR_CFG.size;
        let dstPoints = [[0, 0], [0, size], [size, size], [size, 0]]; // 标准正方形（逆时针：左上→左下→右下→右上）
        log(">>> 第3步：warpPerspective 矫正到 " + size + "×" + size + " 画布");
        warped = imageHandler.warpPerspective(srcMat, quadPoints, dstPoints);
        if (!warped) { loge("【失败】warpPerspective 返回 null"); return; }
        log(">>> 矫正成功: " + warped);
        // ⚠️ 临时调试：查看效果，后续可删除
        if (warped) {
            let saveOk = imageHandler.saveMat(warped, "/sdcard/sonar_2_warped.png", "png", 100);
            log(saveOk === true ? ">>> 已保存矫正图: /sdcard/sonar_2_warped.png" : "【失败】保存矫正图: " + saveOk);
        }

        // ---- 第4步：转灰度，便于像素值判断 ----
        log(">>> 第4步：matToGray 转灰度");
        gray = imageHandler.matToGray(warped);
        if (!gray) { loge("【失败】matToGray 返回 null"); return; }
        log(">>> 灰度转换成功: " + gray);
        // ⚠️ 临时调试：查看效果，后续可删除
        if (gray) {
            let saveOk = imageHandler.saveMat(gray, "/sdcard/sonar_3_gray.png", "png", 100);
            log(saveOk === true ? ">>> 已保存灰度图: /sdcard/sonar_3_gray.png" : "【失败】保存灰度图: " + saveOk);
        }

        // ---- 第5步：网格遍历，判定潜艇 ----
        let gridCount = SONAR_CFG.gridCount;
        let cellSize = size / gridCount; // 单个小格子宽度 = 画布宽度 / gridCount
        let inset = cellSize * SONAR_CFG.insetRatio; // 向内偏移量（30%）
        let subs = []; // 发现的潜艇列表
        log(">>> 第5步：网格扫描 " + gridCount + "×" + gridCount + "，单格 " + cellSize.toFixed(1) + "px");
        for (let row = 0; row < gridCount; row++) {
            for (let col = 0; col < gridCount; col++) {
                // 格子中心点
                let cx = col * cellSize + cellSize / 2;
                let cy = row * cellSize + cellSize / 2;
                // 向内偏移 30% 取上下左右 4 个内部点（避开黑色网格边框）
                let innerPoints = [
                    { x: cx, y: cy - inset }, // 上
                    { x: cx, y: cy + inset }, // 下
                    { x: cx - inset, y: cy }, // 左
                    { x: cx + inset, y: cy }  // 右
                ];
                // 边界保护：坐标限制在画布内
                for (let ip = 0; ip < innerPoints.length; ip++) {
                    innerPoints[ip].x = Math.max(0, Math.min(size - 1, Math.round(innerPoints[ip].x)));
                    innerPoints[ip].y = Math.max(0, Math.min(size - 1, Math.round(innerPoints[ip].y)));
                }
                // 内部 4 点灰度：任一 < blackGray → 判定为纯黑空隙
                let isBlackGap = false;
                for (let ip = 0; ip < innerPoints.length; ip++) {
                    if (grayValueAt(gray, innerPoints[ip].x, innerPoints[ip].y) < SONAR_CFG.blackGray) {
                        isBlackGap = true;
                        break;
                    }
                }
                // 中心点灰度 > whiteGray → 白色潜艇亮点
                let centerGray = grayValueAt(gray, Math.round(cx), Math.round(cy));
                let isWhiteSpot = centerGray > SONAR_CFG.whiteGray;
                // 两个条件同时满足 → 该格存在潜艇
                if (isBlackGap && isWhiteSpot) {
                    subs.push({ row: row, col: col, cx: cx, cy: cy, centerGray: centerGray });
                    log(">>> 发现潜艇: 第" + row + "行 第" + col + "列 中心(" + Math.round(cx) + "," + Math.round(cy) + ") 灰度" + centerGray);
                }
            }
        }
        log(">>> 共发现 " + subs.length + " 个潜艇格子");

        // ---- 第6步：逆透视变换（对矫正图做逆变换，输出与屏幕同尺寸的图，图中坐标即真实屏幕坐标）----
        // 注意：不能对整张原图 srcMat 做逆透视（会导致图像变黑/扭曲）；img 应为矫正图 warped
        // 文档来源：07-图像运算/透视变换.md → warpPerspective(img, srcPoint, dstPoint, width, height)
        //          16-图像IO与转换/获取图片宽高.md → mat.getWidth() / mat.getHeight()
        let screenW = srcMat.getWidth();   // 屏幕宽
        let screenH = srcMat.getHeight();  // 屏幕高
        log(">>> 第6步：逆透视 warpPerspective(warped, dstPoints, quadPoints, " + screenW + ", " + screenH + ")");
        invWarped = imageHandler.warpPerspective(warped, dstPoints, quadPoints, screenW, screenH);
        if (!invWarped) {
            log("【失败】逆透视变换返回 null");
        } else {
            log(">>> 逆透视变换成功: " + invWarped + "（输出与屏幕同尺寸，坐标即真实屏幕坐标）");
            // ⚠️ 临时调试：查看效果，后续可删除
            if (invWarped) {
                let saveOk = imageHandler.saveMat(invWarped, "/sdcard/sonar_4_invWarped.png", "png", 100);
                log(saveOk === true ? ">>> 已保存逆透视图: /sdcard/sonar_4_invWarped.png" : "【失败】保存逆透视图: " + saveOk);
            }
            // 单点坐标映射：把矫正图中的潜艇中心坐标映射回真实屏幕坐标（只打印，不点击）
            // 注：getPixelPos 为 YL 插件函数（文档未收录），兼容 {x,y} 或 [x,y] 返回值，解析失败回退矫正图坐标
            for (let si = 0; si < subs.length; si++) {
                let s = subs[si];
                let pos = imageHandler.getPixelPos(invWarped, Math.round(s.cx), Math.round(s.cy));
                let sx = (pos && pos.x !== undefined) ? pos.x : (pos && pos.length >= 2 ? pos[0] : Math.round(s.cx));
                let sy = (pos && pos.y !== undefined) ? pos.y : (pos && pos.length >= 2 ? pos[1] : Math.round(s.cy));
                log("潜艇[行" + s.row + " 列" + s.col + "] 屏幕坐标: (" + sx + ", " + sy + ")");
            }
        }

        log("========== 海岛奇兵声呐识别结束 ==========");
    } catch (e) {
        log("声呐识别出错: " + (e.message || e));
    } finally {
        // 资源回收（全部 Mat 用完即回收，避免内存泄漏）
        imageHandler.recycle(srcMat, warped, gray, invWarped);
        log(">>> Mat 资源已释放");
    }
}

// ---- 调用示例：执行声呐识别 ----
// detectSonar();

// ============================================================
// 从二值图中提取白色菱形海域的 3 个完整角点（左下、右下、右上）
// 适用场景：顶部顶角被文字/噪点遮挡，多边形逼近得到破碎轮廓，顶角不可靠，
//           直接过滤顶部噪点后取 3 个稳定角点（之后可反推第 4 个顶角）
// 输入流程（与 detectQuadPoints 前置一致）：截图 → HSV → 颜色范围提取
//   → 开运算（椭圆）→ 闭操作（8x8）→ 二值图
// 返回：[{x,y}, {x,y}, {x,y}]（左下 bl、右下 br、右上 tr）；失败返回 null
// 文档来源：冉遗鱼图色插件JS版v4.7.6.doc
//   getContoursArea(mat, mode, method, indexArr)       → 05-轮廓检测/轮廓面积.md
//   getContoursLength(mat, mode, method, indexArr)     → 05-轮廓检测/轮廓长度.md
//   getApproxPolyDPPoint(mat, mode, method, indexArr, epsilon) → 05-轮廓检测/多边形拟合点.md
// ============================================================
function extractThreeCorners() {
    log("========== 提取海域 3 个完整角点（左下/右下/右上） ==========");
    let srcMat = null, HSV = null, mask = null, opened = null, closed = null;

    try {
        // ---- 前置：截图 ----
        log(">>> 前置1：截图 captureScreenMat()");
        srcMat = imageHandler.captureScreenMat();
        if (!srcMat) {
            loge("【失败】captureScreenMat() 返回 null，截图失败！");
            return null;
        }

        // ---- 前置：转 HSV ----
        log(">>> 前置2：转HSV getHSV(srcMat, -1)");
        HSV = imageHandler.getHSV(srcMat, -1);
        if (!HSV) { loge("【失败】getHSV 返回 null"); return null; }

        // ---- 前置：颜色范围提取 ----
        log(">>> 前置3：颜色范围提取 inRange(HSV, [0,0,90], [180,115,255])");
        mask = imageHandler.inRange(HSV, [0, 0, 90], [180, 115, 255]);
        if (!mask) { loge("【失败】inRange 返回 null"); return null; }

        // ---- 前置：开运算（椭圆结构元素，宽高相等即圆形，迭代 2 次）----
        log(">>> 前置4：开运算 open(mask, 2, 5, 5, -1, -1, 2)");
        opened = imageHandler.open(mask, 2, 5, 5, -1, -1, 2);
        if (!opened) { loge("【失败】open 返回 null"); return null; }

        // ---- 前置：闭操作（结构元素 8x8，迭代 2 次）→ 得到二值图 ----
        log(">>> 前置5：闭操作 close(opened, 0, 8, 8, -1, -1, 2)");
        closed = imageHandler.close(opened, 0, 8, 8, -1, -1, 2);
        if (!closed) { loge("【失败】close 返回 null"); return null; }
        let binaryMat = closed; // 二值图
        let imgH = binaryMat.getHeight(); // 图像高度（用于顶部过滤阈值）

        // ---- 第1步：提取所有轮廓面积，取最大轮廓（过滤面积太小的轮廓）----
        log(">>> 第1步：getContoursArea 提取轮廓，取面积最大者");
        let areas = imageHandler.getContoursArea(binaryMat, 0, 2, null);
        if (!areas || areas.length === 0) {
            loge("【失败】未检测到任何轮廓");
            return null;
        }
        let maxIndex = 0;
        for (let i = 1; i < areas.length; i++) {
            if (areas[i] > areas[maxIndex]) maxIndex = i;
        }
        log(">>> 最大轮廓索引: " + maxIndex + "，面积: " + areas[maxIndex]);

        // ---- 第2步：取最大轮廓周长，epsilon = 0.02 * 轮廓周长 ----
        log(">>> 第2步：getContoursLength 取周长，计算 epsilon");
        let lens = imageHandler.getContoursLength(binaryMat, 0, 2, null);
        let perimeter = (lens && lens[maxIndex] !== undefined) ? lens[maxIndex] : 0;
        let epsilon = 0.02 * perimeter;
        log(">>> 最大轮廓周长: " + perimeter + "，epsilon: " + epsilon);

        // ---- 第3步：多边形逼近，获取角点坐标集合 ----
        log(">>> 第3步：getApproxPolyDPPoint 多边形逼近");
        let pointSets = imageHandler.getApproxPolyDPPoint(binaryMat, 0, 2, [maxIndex], epsilon);
        if (!pointSets || pointSets.length === 0 || !pointSets[0] || pointSets[0].length < 3) {
            loge("【失败】多边形逼近角点不足 3 个");
            return null;
        }
        let vertices = pointSets[0]; // 最大轮廓的逼近角点数组（Point[]）
        log(">>> 逼近角点数: " + vertices.length);

        // ---- 第4步：过滤顶部噪点（y <= 图像高度 10% 的点丢弃，顶角被遮挡不可靠）----
        // 回调 10% 高度过滤：减少顶部文字破碎噪点混入顶点列表，稳定提取底部完整 3 个角点
        let thresholdY = imgH * 0.1;
        let valid = [];
        for (let i = 0; i < vertices.length; i++) {
            let v = vertices[i];
            let y = (v.y !== undefined) ? v.y : v[1]; // 兼容 {x,y} / [x,y]
            let x = (v.x !== undefined) ? v.x : v[0];
            if (y > thresholdY) {
                valid.push({ x: x, y: y });
            }
        }
        log(">>> 过滤后角点数: " + valid.length + "（阈值 y>" + thresholdY + "）");
        if (valid.length < 3) {
            loge("【失败】过滤后角点不足 3 个");
            return null;
        }

        // ---- 第5步：排序 → 左下(bl)、右下(br)、下角(bm) ----
        // ◇ 菱形：左/右/下三角完好，顶角被遮挡缺失
        // 按 y 降序：y 最大的 = 下角 bm（画面最下方）；剩余两点按 x 分：x 小 = 左边角 bl、x 大 = 右边角 br
        valid.sort(function (a, b) { return b.y - a.y; });
        let bm = valid[0];                                        // y 最大 = 下角
        let rest = valid.slice(1);                                // 剩余两点 = 左右两角
        let bl = rest[0].x <= rest[1].x ? rest[0] : rest[1];      // x 小 = 左边角（左下）
        let br = rest[0].x <= rest[1].x ? rest[1] : rest[0];      // x 大 = 右边角（右下）

        log(">>> 3 角点: 左下(" + bl.x + "," + bl.y + ") 右下(" + br.x + "," + br.y + ") 下角(" + bm.x + "," + bm.y + ")");
        return [bl, br, bm];
    } catch (e) {
        loge("提取 3 角点出错: " + (e.message || e));
        return null;
    } finally {
        // 资源回收（二值图 closed 即 binaryMat，一并回收）
        imageHandler.recycle(srcMat, HSV, mask, opened, closed);
        log(">>> Mat 资源已释放");
    }
}

// ============================================================
// ⚠️ 临时调试：检测外部本地图并保存每一步中间图（用后删除）
// 独立复刻检测流程（与 detectQuadPoints 逻辑一致），每步 saveMat 供查看效果
// 文档来源：16-图像IO与转换/读取外部图片.md → readMat(path)
//          16-图像IO与转换/保存图片.md → saveMat(mat, path, format, q)
// 保存产物：/sdcard/debug_1_src.png ~ debug_6_fitted.png
// ============================================================
(function debugExternalImage() {
    let debugMat = null, hsv = null, mask = null, opened = null, closed = null, fitted = null;
    try {
        // ---- 第0步：读取外部图 ----
        debugMat = imageHandler.readMat("/storage/emulated/0/_bbma_screen.png");
        if (!debugMat) {
            log("【失败】readMat 读取外部图片失败（路径: /storage/emulated/0/_bbma_screen.png）");
            return;
        }
        log(">>> 外部图片读取成功: " + debugMat);
        imageHandler.saveMat(debugMat, "/sdcard/debug_1_src.png", "png", 100);
        log(">>> 已保存 debug_1_src.png（原图）");

        // ---- 第1步：转 HSV ----
        hsv = imageHandler.getHSV(debugMat, -1);
        if (!hsv) { log("【失败】getHSV 返回 null"); return; }
        imageHandler.saveMat(hsv, "/sdcard/debug_2_hsv.png", "png", 100);
        log(">>> 已保存 debug_2_hsv.png（HSV）");

        // ---- 第2步：颜色范围提取 ----
        mask = imageHandler.inRange(hsv, [0, 0, 90], [180, 115, 255]);
        if (!mask) { log("【失败】inRange 返回 null"); return; }
        imageHandler.saveMat(mask, "/sdcard/debug_3_mask.png", "png", 100);
        log(">>> 已保存 debug_3_mask.png（颜色掩膜）");

        // ---- 第3步：开运算（椭圆结构元素，迭代 2 次）----
        opened = imageHandler.open(mask, 2, 5, 5, -1, -1, 2);
        if (!opened) { log("【失败】open 返回 null"); return; }
        imageHandler.saveMat(opened, "/sdcard/debug_4_open.png", "png", 100);
        log(">>> 已保存 debug_4_open.png（开运算）");

        // ---- 第4步：闭操作（8x8，迭代 2 次）→ 二值图 ----
        closed = imageHandler.close(opened, 0, 8, 8, -1, -1, 2);
        if (!closed) { log("【失败】close 返回 null"); return; }
        imageHandler.saveMat(closed, "/sdcard/debug_5_close.png", "png", 100);
        log(">>> 已保存 debug_5_close.png（闭操作二值图）");

        // ---- 第5步：四边形检测（正常路径）----
        let polyIndexes = imageHandler.polygonDetection(closed, 4, 0, 100, -1, 0, 2, -1);
        let quad = null;
        if (polyIndexes && polyIndexes.length > 0) {
            fitted = imageHandler.approxPolyDP(closed, 0, 2, polyIndexes, 2, 8, -1);
            if (fitted) {
                imageHandler.saveMat(fitted, "/sdcard/debug_6_fitted.png", "png", 100);
                log(">>> 已保存 debug_6_fitted.png（多边形拟合图）");
            }
            let points = imageHandler.getApproxPolyDPPoint(closed, 0, 2, polyIndexes, -1);
            if (points && points[0] && points[0].length === 4) {
                quad = points[0];
            }
        }
        // ---- 遮挡兜底：三点提取 + 平行四边形公式补顶角（与 detectQuadPoints 内部逻辑一致）----
        if (!quad) {
            log(">>> 正常检测无完整 4 点，尝试遮挡兜底（三点反推，复用 closed）");
            let imgH = closed.getHeight();
            let areas = imageHandler.getContoursArea(closed, 0, 2, null);
            if (areas && areas.length > 0) {
                let maxIndex = 0;
                for (let i = 1; i < areas.length; i++) {
                    if (areas[i] > areas[maxIndex]) maxIndex = i;
                }
                let lens = imageHandler.getContoursLength(closed, 0, 2, null);
                let perimeter = (lens && lens[maxIndex] !== undefined) ? lens[maxIndex] : 0;
                let epsilon = 0.02 * perimeter;
                let pointSets = imageHandler.getApproxPolyDPPoint(closed, 0, 2, [maxIndex], epsilon);
                if (pointSets && pointSets[0]) {
                    // 过滤阈值与主函数统一：imgH*0.1（回调 10% 高度过滤，减少顶部文字破碎噪点混入顶点列表，稳定提取底部完整 3 个角点）
                    let thresholdY = imgH * 0.1;
                    let valid = [];
                    let vertices = pointSets[0];
                    for (let i = 0; i < vertices.length; i++) {
                        let v = vertices[i];
                        let y = (v.y !== undefined) ? v.y : v[1];
                        let x = (v.x !== undefined) ? v.x : v[0];
                        if (y > thresholdY) valid.push({ x: x, y: y });
                    }
                    if (valid.length >= 3) {
                        // 三点分组（◇ 菱形：左/右/下三角完好，顶角被遮挡缺失，与 extractThreeFromBinary 一致）
                        valid.sort(function (a, b) { return b.y - a.y; }); // y 降序
                        let bm = valid[0]; // 下角（y 最大，画面最底部）
                        let rest = valid.slice(1); // 剩余两点 = 左右两角
                        let bl = rest[0].x <= rest[1].x ? rest[0] : rest[1]; // 左边角（x 小）
                        let br = rest[0].x <= rest[1].x ? rest[1] : rest[0]; // 右边角（x 大）
                        log(">>> 3 角点: 左下(" + bl.x + "," + bl.y + ") 右下(" + br.x + "," + br.y + ") 下角(" + bm.x + "," + bm.y + ")");
                        let tl = { x: bl.x + br.x - bm.x, y: bl.y + br.y - bm.y };
                        // 画布边界约束：强制锁定 tl 坐标在画面内，彻底解决三点外推 y 负数出屏问题（与主函数一致）
                        tl.y = Math.max(0, tl.y);
                        tl.x = Math.max(0, Math.min(tl.x, closed.getWidth()));
                        log(">>> 校正后 tl 坐标: (" + tl.x + "," + tl.y + ")（已锁定在画面内，宽度=" + closed.getWidth() + "）");
                        quad = [tl, br, bm, bl];
                    }
                }
            }
        }
        // ---- 输出结果 ----
        if (quad && quad.length === 4) {
            log(">>> 检测角点: " + JSON.stringify(quad));
            log(">>> 角点顺序: tl=" + quad[0].x + "," + quad[0].y +
                " tr=" + quad[1].x + "," + quad[1].y +
                " br=" + quad[2].x + "," + quad[2].y +
                " bl=" + quad[3].x + "," + quad[3].y);
        } else {
            log(">>> 未检测到有效四边形角点（返回 null）");
        }
    } catch (e) {
        log("调试外部图检测出错: " + (e.message || e));
    } finally {
        imageHandler.recycle(debugMat, hsv, mask, opened, closed, fitted);
        log(">>> Mat 资源已释放");
    }
})();
