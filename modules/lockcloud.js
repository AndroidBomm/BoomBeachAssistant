/**
 * 锁云功能模块
 * @module lockcloud
 * @description 提供锁云状态检测、CSV文件管理等功能
 * @since 1.0.0
 */

// AIGame Java类导入

/**
 * 获取CSV文件的外部存储路径
 * 
 * @function getCsvExternalPath
 * @memberof module:lockcloud
 * @description
 * 获取用于存储CSV文件的外部存储路径。使用Java原生方法确保路径正确。
 * 
 * @returns {string|null} 外部存储路径字符串，如果不可用则返回null
 * 
 * @example
 * let path = getCsvExternalPath();
 * console.log("CSV外部存储路径:", path);
 * 
 * @since 1.1.0
 */
function getCsvExternalPath() {
    try {
        // 使用AIGame内置的context对象获取外部文件目录
        let externalFilesDir = context.getExternalFilesDir(null);

        if (externalFilesDir != null) {
            return externalFilesDir.getAbsolutePath();
        } else {
            $log.e("无法获取外部文件目录");
            return null;
        }
    } catch (e) {
        $log.e("获取外部存储路径失败: " + e.message);
        return null;
    }
}

/**
 * 复制res/csv文件夹中的所有文件到外部存储路径
 * 
 * @function copyCsvFilesToExternal
 * @memberof module:lockcloud
 * @description
 * 将应用内部的res/csv文件夹中的所有CSV文件复制到外部存储路径。
 * 用于首次使用时的CSV文件初始化。
 * 
 * @returns {boolean} 复制结果 - true 表示复制成功，false 表示复制失败
 * 
 * @example
 * let success = copyCsvFilesToExternal();
 * if (success) {
 *     console.log("CSV文件复制成功");
 * } else {
 *     console.log("CSV文件复制失败");
 * }
 * 
 * @since 1.1.0
 */
function copyCsvFilesToExternal() {
    try {
        // 获取CSV外部存储路径
        let externalPath = getCsvExternalPath();

        // 检查路径是否有效
        if (externalPath === null) {
            $log.e("无法获取有效的外部存储路径");
            return false;
        }

        // 创建csv子文件夹路径
        let csvFolderPath = $file.join(externalPath, "csv");

        // 确保csv文件夹存在
        $file.ensureDir(csvFolderPath);

        // 获取项目内部的res/csv路径
        let internalCsvPath = "res/csv";

        // 检查内部CSV文件夹是否存在
        if (!$file.exists(internalCsvPath)) {
            $log.e("内部CSV文件夹不存在: " + internalCsvPath);
            return false;
        }

        // 获取内部CSV文件夹中的所有文件
        let csvFiles = $file.ls(internalCsvPath);

        if (csvFiles.length === 0) {
            $log.w("CSV文件夹中没有找到文件");
            return false;
        }

        let copyCount = 0;

        // 复制每个文件
        for (let i = 0; i < csvFiles.length; i++) {
            // $file.ls() 返回的是完整路径，需要提取文件名
            let fullPath = csvFiles[i];
            let fileName = $file.name(fullPath);
            let targetPath = $file.join(csvFolderPath, fileName);

            try {
                // 读取源文件内容（支持assets文件）
                let fileContent = $file.read(fullPath);

                if (fileContent === null || fileContent === undefined) {
                    $log.e("文件内容为空或读取失败: " + fileName);
                    continue;
                }

                // 写入到目标路径
                $file.write(fileContent, targetPath);
                copyCount++;
            } catch (e) {
                $log.e("复制文件失败: " + fileName + ", 错误: " + e.message);
            }
        }

        if (copyCount === 0) {
            $log.w("没有复制任何CSV文件");
        } else {
            $log.i("CSV文件复制完成，共复制 " + copyCount + " 个文件到: " + csvFolderPath);
        }

        return copyCount > 0;

    } catch (e) {
        $log.e("复制CSV文件过程出错: " + e.message);
        return false;
    }
}

/**
 * 检查并初始化CSV文件（首次使用检测）
 * 
 * @function checkAndInitializeCsvFiles
 * @memberof module:lockcloud
 * @description
 * 检查外部存储中的CSV文件是否需要初始化，如果需要则自动复制内部CSV文件。
 * 用于首次使用应用时的CSV文件自动初始化。
 * 
 * @returns {boolean} 初始化结果 - true 表示初始化成功或无需初始化，false 表示初始化失败
 * 
 * @example
 * let result = checkAndInitializeCsvFiles();
 * if (result) {
 *     console.log("CSV文件初始化完成");
 * } else {
 *     console.log("CSV文件初始化失败");
 * }
 * 
 * @since 1.1.0
 */
function checkAndInitializeCsvFiles() {
    try {
        // 获取外部CSV路径
        let externalCsvPath = getCsvExternalPath();

        // 检查路径是否有效
        if (externalCsvPath === null) {
            return false;
        }

        // 构建外部csv文件夹路径
        let externalCsvDirPath = $file.join(externalCsvPath, "csv");

        // 检查是否需要初始化：文件夹不存在，或者存在但没有文件
        let needInitialization = false;

        if (!$file.exists(externalCsvDirPath)) {
            $log.i("外部CSV文件夹不存在，需要初始化");
            needInitialization = true;
        } else {
            // 文件夹存在，检查是否是文件夹
            if (!$file.isDir(externalCsvDirPath)) {
                $log.e("外部CSV路径存在但不是文件夹: " + externalCsvDirPath);
                return false;
            }

            // 获取文件夹中的文件列表
            let filesList = $file.ls(externalCsvDirPath);
            if (filesList === null || filesList.length === 0) {
                $log.i("外部CSV文件夹存在但没有文件，需要初始化");
                needInitialization = true;
            } else {
                $log.i("外部CSV文件夹已存在且有 " + filesList.length + " 个文件，无需初始化");
            }
        }

        // 如果需要初始化
        if (needInitialization) {
            $log.i("检测到CSV文件需要初始化，正在复制CSV文件...");

            // 调用复制函数
            let copySuccess = copyCsvFilesToExternal();

            if (copySuccess) {
                $log.i("CSV文件初始化完成");
                return true;
            } else {
                $log.e("CSV文件初始化失败");
                return false;
            }
        }

        // 已有文件，但强制覆盖脚本文件（修复兼容性）
        try {
            var delScripts = ["(解压后ROOT执行)一键替换国服.sh", "(解压后ROOT执行)一键替换国际服.sh",
                              "卸载所有(国服).sh", "卸载所有(国际服).sh"];
            var extCsv = $file.join(getCsvExternalPath(), "csv");
            for (var s = 0; s < delScripts.length; s++) {
                var sp = $file.join(extCsv, delScripts[s]);
                if ($file.exists(sp)) $file.del(sp);
            }
            // 删除后重新复制
            copyCsvFilesToExternal();
        } catch(e) {
            $log.w("覆盖脚本文件失败: " + e.message);
        }

        return true;

    } catch (e) {
        $log.e("CSV文件初始化检查出错: " + e.message);
        return false;
    }
}


function verifyFileAfterLockCloud(filePath, callback) {
    $root.getPermit();
    // 1. 文件是否存在
    $root.exeRootShell(`nsenter -t 1 -m -- test -e "${filePath}" 2>/dev/null || test -e "${filePath}"`,
        () => { },
        err => { $log.e("test 异常: " + err); callback(false); },
        exitCode => {
            if (exitCode !== 0) {
                $log.w("文件不存在: " + filePath);
                callback(false);
                return;
            }
            // 2. 存在则读取内容
            let content = "";
            let hasError = false;
            $root.exeRootShell(`nsenter -t 1 -m cat "${filePath}" 2>/dev/null || cat "${filePath}"`,
                line => content += line + "\n",
                err => { hasError = true; $log.e("读取文件失败: " + err); },
                exitCode2 => {
                    if (hasError || exitCode2 !== 0) { callback(false); return; }
                    const isValid = content.includes('"version":"88.88.8"');
                    $log.i("文件验证结果: " + isValid);
                    callback(isValid);
                }
            );
        }
    );
}




/**
 * Root权限检测函数 - 使用AIGame原生API
 * 
 * @function checkRootPermission
 * @memberof module:lockcloud
 * @description
 * 使用AIGame原生的hasPermit()方法检测Root权限，简单高效。
 * 
 * @returns {boolean} Root权限状态 - true 表示具有Root权限，false 表示没有Root权限
 * 
 * @example
 * if (checkRootPermission()) {
 *     console.log("设备已获取Root权限，可以执行锁云操作");
 * } else {
 *     console.log("设备未获取Root权限，无法执行锁云操作");
 * }
 * 
 * @since 1.2.0
 */
function checkRootPermission() {
    try {
        let hasRoot = $root.hasPermit();
        if (hasRoot) {
            $log.i("Root权限检测成功: 设备已获取Root权限");
        } else {
            $log.w("Root权限检测失败: 设备未获取Root权限");
        }
        return hasRoot;
    } catch (e) {
        $log.e("Root权限检测出错: " + e.message);
        return false;
    }
}

/**
 * 获取服务器类型名称
 * 
 * @function getServerName
 * @memberof module:lockcloud
 * @description
 * 根据服务器类型代码获取对应的服务器名称字符串。
 * 
 * @param {number} serverType - 服务器类型代码，0 表示国服，1 表示国际服
 * @returns {string} 服务器名称 - "国服"、"国际服" 或 "未知"
 * 
 * @since 1.2.0
 */
function getServerName(serverType) {
    let serverNames = ["国服", "国际服"];
    return serverNames[serverType] || "未知";
}

/**
 * 执行锁云操作 - 使用AIGame API
 * 
 * @function performLockCloud
 * @memberof module:lockcloud
 * @description
 * 执行锁云操作，通过替换游戏文件来实现锁云功能。使用AIGame的API执行shell脚本。
 * 
 * @param {number} serverType - 服务器类型，0 表示国服，1 表示国际服
 * @param {function} callback - 回调函数，接收操作结果对象
 * @returns {void} 无返回值，通过回调函数返回结果
 * 
 * @example
 * performLockCloud(0, function(result) {
 *     if (result.success) {
 *         console.log("锁云成功: " + result.message);
 *     } else {
 *         console.error("锁云失败: " + result.message);
 *     }
 * });
 * 
 * @since 1.2.0
 */
function performLockCloud(serverType, callback) {
    // 检查root权限
    if (!checkRootPermission()) {
        callback({
            success: false,
            message: "锁云功能需要Root权限才能执行"
        });
        return;
    }

    // 确保 CSV 文件已复制到外部存储
    checkAndInitializeCsvFiles();

    // 使用AIGame的线程API启动新线程，并保存线程对象引用
    let lockThread = null;

    try {
        lockThread = $thread.run(function () {
            try {
                // 获取CSV外部存储路径
                let csvExternalPath = $file.join(getCsvExternalPath(), "csv");

                // 定义文件路径和脚本名称
                let filePath;
                let scriptName;

                if (serverType === 0) {
                    // 国服锁云
                    filePath = "/data/user/0/com.tencent.tmgp.supercell.boombeach/update/fingerprint.json";
                    scriptName = "(解压后ROOT执行)一键替换国服.sh";
                } else {
                    // 国际服锁云
                    filePath = "/data/user/0/com.supercell.boombeach/update/fingerprint.json";
                    scriptName = "(解压后ROOT执行)一键替换国际服.sh";
                }

                // 构建脚本文件路径
                let scriptPath = $file.join(csvExternalPath, scriptName);

                // 检查脚本文件是否存在
                if (!$file.exists(scriptPath)) {
                    callback({
                        success: false,
                        message: `锁云脚本文件不存在: ${scriptName}`
                    });
                    return;
                }

                // 读取脚本内容
                let scriptContent = $file.read(scriptPath);
                if (!scriptContent) {
                    callback({
                        success: false,
                        message: "无法读取锁云脚本内容"
                    });
                    return;
                }

                // 执行锁云脚本 - 使用AIGame的ROOT API

                let executionSuccess = false;
                let errorMessage = "";
                let commandOutput = [];

                // 使用AIGame的$root.exeRootShell执行命令（nsenter 绕过 mount namespace 隔离）
                $root.getPermit();
                // 直接用 sh 内联执行锁云操作（不用外部脚本，避免文件缓存问题）
                var pkg = serverType === 0 ? "com.tencent.tmgp.supercell.boombeach" : "com.supercell.boombeach";
                var activity = serverType === 0 ? "com.supercell.titan.tencent.GameAppTencentMidas" : "com.supercell.boombeach.GameApp";
                // 直接用原始脚本文件执行锁云（nsenter 绕过 mount namespace）
                var lockCmd = "cd '" + csvExternalPath + "'; sh '" + scriptPath + "'";
                $root.exeRootShell(`nsenter -t 1 -m -- sh -c "${lockCmd}" 2>/dev/null || sh -c "${lockCmd}"`,
                    (line) => {
                        commandOutput.push(line);
                        $log.i("锁云脚本输出: " + line);
                    },
                    (err) => {
                        // 命令中止回调
                        $log.e("锁云脚本中止: " + err);
                        callback({
                            success: false,
                            message: "锁云失败,脚本中止: " + err
                        });
                    },
                    (exitCode) => {
                        // 命令完成回调 — 异步结果在这里处理
                        $log.i("锁云脚本执行完成，退出码: " + exitCode);
                        // 脚本成功，异步检查文件是否存在
                        verifyFileAfterLockCloud(filePath, function (verificationResult) {
                                // 根据验证结果显示不同的提示
                                if (verificationResult) {
                                    callback({
                                        success: true,
                                        message: "锁云成功",
                                        locked: true
                                    });
                                } else {
                                    callback({
                                        success: false,
                                        message: "锁云完成，但文件验证失败"
                                    });
                                }
                            });
                        }
                );
            } catch (e) {
                callback({
                    success: false,
                    message: "执行过程中发生错误: " + e.message
                });
            }
        });
    } catch (e) {
        $log.e("创建锁云线程失败: " + e.message);
        callback({
            success: false,
            message: "创建线程失败: " + e.message
        });
    } finally {
        // 延迟销毁线程，确保异步操作完成
        if (lockThread) {
            setTimeout(() => {
                try {
                    if (lockThread && lockThread.hasRun()) {
                        lockThread.kill(); // 使用kill方法替代interrupt
                        $log.d("锁云线程已销毁");
                    }
                } catch (e) {
                    $log.w("销毁锁云线程时发生错误: " + e.message);
                }
            }, 1000); // 延迟1秒确保异步操作完成
        }
    }
}

/**
 * 执行解锁云操作 - 使用AIGame API
 * 
 * @function performUnlockCloud
 * @memberof module:lockcloud
 * @description
 * 执行解锁云操作，通过执行卸载脚本来恢复游戏的原始状态。使用AIGame的API执行。
 * 
 * @param {number} serverType - 服务器类型，0 表示国服，1 表示国际服
 * @param {function} callback - 回调函数，接收操作结果对象
 * @returns {void} 无返回值，通过回调函数返回结果
 * 
 * @example
 * performUnlockCloud(0, function(result) {
 *     if (result.success) {
 *         console.log("解锁云成功: " + result.message);
 *     } else {
 *         console.error("解锁云失败: " + result.message);
 *     }
 * });
 * 
 * @since 1.2.0
 */
function performUnlockCloud(serverType, callback) {
    // 检查root权限
    if (!checkRootPermission()) {
        callback({
            success: false,
            message: "卸载锁云功能需要Root权限才能执行"
        });
        return;
    }

    // 确保 CSV 文件已复制到外部存储
    checkAndInitializeCsvFiles();

    // 使用AIGame的线程API启动新线程，并保存线程对象引用
    let unlockThread = null;

    try {
        unlockThread = $thread.run(function () {
            try {
                // 获取CSV外部存储路径
                let csvExternalPath = $file.join(getCsvExternalPath(), "csv");

                // 定义脚本名称
                let scriptName;

                if (serverType === 0) {
                    // 国服卸载
                    scriptName = "卸载所有(国服).sh";
                } else {
                    // 国际服卸载
                    scriptName = "卸载所有(国际服).sh";
                }

                // 构建脚本文件路径
                let scriptPath = $file.join(csvExternalPath, scriptName);

                // 检查卸载脚本文件是否存在
                if (!$file.exists(scriptPath)) {
                    callback({
                        success: false,
                        message: `卸载脚本文件不存在: ${scriptName}`
                    });
                    return;
                }

                // 读取卸载脚本内容
                let scriptContent = $file.read(scriptPath);
                if (!scriptContent) {
                    callback({
                        success: false,
                        message: "无法读取卸载脚本内容"
                    });
                    return;
                }

                // 执行卸载操作 - 直接用 sh 内联命令
                $log.i(`开始执行解锁云操作: ${getServerName(serverType)}`);
                var pkg = serverType === 0 ? "com.tencent.tmgp.supercell.boombeach" : "com.supercell.boombeach";
                var filePath = "/data/user/0/" + pkg + "/update/fingerprint.json";
                var unlockCmd = "rm -rf /data/user/0/" + pkg + "/update";
                unlockCmd += "; chmod -R 777 /data/user/0/" + pkg + "/update";
                unlockCmd += "; am force-stop " + pkg + " 2>/dev/null";
                unlockCmd += "; echo 卸载完成";
                $root.exeRootShell(`nsenter -t 1 -m -- sh -c "${unlockCmd}" 2>/dev/null || sh -c "${unlockCmd}"`,
                    (line) => {
                        $log.i("解锁云输出: " + line);
                    },
                    (err) => {
                        $log.e("解锁云脚本中止: " + err);
                        callback({ success: false, message: "卸载失败,脚本中止: " + err });
                    },
                    (exitCode) => {
                        $log.i("解锁云脚本执行完成，退出码: " + exitCode);
                        verifyFileAfterLockCloud(filePath, function (verificationResult) {
                            if (!verificationResult) {
                                callback({ success: true, message: "卸载成功", locked: false });
                            } else {
                                callback({ success: false, message: "卸载完成，但文件仍然存在，可能解锁失败" });
                            }
                        });
                    }
                );
            } catch (e) {
                callback({
                    success: false,
                    message: "执行过程中发生错误: " + e.message
                });
            }
        });
    } catch (e) {
        $log.e("创建解锁云线程失败: " + e.message);
        callback({
            success: false,
            message: "创建线程失败: " + e.message
        });
    } finally {
        // 延迟销毁线程，确保异步操作完成
        if (unlockThread) {
            setTimeout(() => {
                try {
                    if (unlockThread && unlockThread.hasRun()) {
                        unlockThread.kill(); // 使用kill方法替代interrupt
                        $log.d("解锁云线程已销毁");
                    }
                } catch (e) {
                    $log.w("销毁解锁云线程时发生错误: " + e.message);
                }
            }, 1000); // 延迟1秒确保异步操作完成
        }
    }
}

/**
 * 更新锁云状态显示
 * 
 * @function updateLockCloudStatusDisplay
 * @memberof module:lockcloud
 * @description
 * 更新UI界面上的锁云状态显示，包含服务器类型信息。AIGame的setText已封装UI线程处理。
 * 
 * @param {number} serverType - 服务器类型，0 表示国服，1 表示国际服
 * @param {object} uiElements - UI元素对象，必须包含 lockCloudStatus 控件
 * @returns {void} 无返回值
 * 
 * @example
 * // 使用示例
 * let uiElements = {
 *     lockCloudStatus: ui.id("lockCloudStatus")
 * };
 * updateLockCloudStatusDisplay(0, uiElements); // 更新国服状态
 * updateLockCloudStatusDisplay(1, uiElements); // 更新国际服状态
 * 
 * @since 1.2.0
 */
function updateLockCloudStatusDisplay(serverType, uiElements) {
    if (!uiElements || !uiElements.lockCloudStatus) {
        $log.w("UI元素无效或缺少lockCloudStatus控件");
        return;
    }

    try {
        $log.i("开始更新锁云状态显示...");

        // 定义文件路径
        let filePath;
        if (serverType === 0) {
            // 国服锁云文件路径
            filePath = "/data/user/0/com.tencent.tmgp.supercell.boombeach/update/fingerprint.json";
        } else {
            // 国际服锁云文件路径
            filePath = "/data/user/0/com.supercell.boombeach/update/fingerprint.json";
        }

        // 直接使用回调版本的验证函数
        verifyFileAfterLockCloud(filePath, function (isLocked) {
            try {
                $log.i(`获取到锁云状态: ${isLocked}`);

                // 获取服务器类型名称
                let serverName = getServerName(serverType);

                // 构建显示文本（带符号）
                let statusText = isLocked ? "已锁云\u2713" : "未锁云\u2717";
                let displayText = `${serverName}: ${statusText}`;

                // 直接更新UI显示 - AIGame的setText已封装好UI线程处理
                try {
                    uiElements.lockCloudStatus.setText(displayText);
                    var dotColor = isLocked ? "#4CAF50" : "#9E9E9E";
                    if (uiElements.lockCloudDot) uiElements.lockCloudDot.setColor(dotColor);
                } catch (uiError) {
                    $log.e("UI更新失败: " + uiError.message);
                }
            } catch (err) {
                $log.e("处理锁云状态失败: " + (err ? err.message : "未知错误"));
                $log.e("错误堆栈: " + (err && err.stack ? err.stack : "无堆栈信息"));

                // 出错时显示默认文本
                let serverName = getServerName(serverType);
                let errorText = `${serverName}: 未知状态`;

                // 直接更新错误状态 - AIGame的setText已封装好UI线程处理
                try {
                    uiElements.lockCloudStatus.setText(errorText);
                    if (uiElements.lockCloudDot) uiElements.lockCloudDot.setColor("#9E9E9E");
                    $log.i(`错误状态已显示: ${errorText}`);
                } catch (uiError) {
                    $log.e("错误状态UI更新失败: " + uiError.message);
                }
            }
        });

    } catch (e) {
        $log.e("更新锁云状态显示失败: " + e.message);

        // 出错时显示默认文本
        let serverName = getServerName(serverType);
        let errorText = `${serverName}: 未知状态`;

        // 直接更新异常错误状态 - AIGame的setText已封装好UI线程处理
        try {
            uiElements.lockCloudStatus.setText(errorText);
            if (uiElements.lockCloudDot) uiElements.lockCloudDot.setColor("#9E9E9E");
            $log.i(`异常错误状态已显示: ${errorText}`);
        } catch (uiError) {
            $log.e("异常错误状态UI更新失败: " + uiError.message);
        }
    }
}



/**
 * 清除缓存（用于强制刷新状态）- AIGame版本
 * 
 * @function clearCache
 * @memberof module:lockcloud
 * @description
 * 清除Root权限和锁云状态的缓存，用于强制刷新状态检测。
 * 
 * @returns {void} 无返回值
 * 
 * @example
 * // 清除缓存以强制重新检测
 * clearCache();
 * console.log("缓存已清除");
 * 
 * @since 1.3.0
 */
function clearCache() {
    // 由于AIGame版本简化了缓存机制，这里主要清除可能的内部状态
    // 可以在这里添加需要清除的其他缓存状态
    // 例如：清除文件系统缓存、重置内部变量等
}

// 导出模块函数
let cloud = {
    getCsvExternalPath: getCsvExternalPath,
    copyCsvFilesToExternal: copyCsvFilesToExternal,
    checkAndInitializeCsvFiles: checkAndInitializeCsvFiles,
    verifyFileAfterLockCloud: verifyFileAfterLockCloud,
    checkRootPermission: checkRootPermission,
    getServerName: getServerName,
    performLockCloud: performLockCloud,
    performUnlockCloud: performUnlockCloud,
    updateLockCloudStatusDisplay: updateLockCloudStatusDisplay,
    clearCache: clearCache
};
cloud;

