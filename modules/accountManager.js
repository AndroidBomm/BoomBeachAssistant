/**
 * 账号管理模块
 * 负责账号列表的管理、保存和加载
 */

/**
 * 获取游戏包名
 * 根据配置文件中的服务器类型返回对应的游戏包名
 * 
 * @returns {string} 游戏包名
 * 
 * @example
 * let packageName = getGamePackageName();
 * $log.i("当前游戏包名:", packageName);
 * 
 * @since 1.0.0
 */
function getGamePackageName() {
    try {
        // 直接从UI下拉框获取服务器类型（与 aigame版一致）
        let serverTypeText = ui.id("serverType").getCheckedText();

        // 增强的错误检查，如果没有获取到文本或为空，使用默认值
        if (!serverTypeText || serverTypeText.trim() === "") {
            serverTypeText = "国际服"; // 默认国际服
            $log.w("无法从下拉框获取服务器类型，使用默认值: " + serverTypeText);
        }

        // 标准化文本
        serverTypeText = serverTypeText.trim();

        // 根据服务器类型返回对应的包名
        if (serverTypeText.includes("国服") || serverTypeText === "国服") {
            return "com.tencent.tmgp.supercell.boombeach";
        } else if (serverTypeText.includes("国际服") || serverTypeText === "国际服") {
            return "com.supercell.boombeach";
        } else {
            // 未知服务器类型，默认返回国际服包名
            $log.w("未知服务器类型: " + serverTypeText + ", 默认使用国际服包名");
            return "com.supercell.boombeach";
        }
    } catch (e) {
        $log.e("获取游戏包名失败: " + e.message);
        // 出错时默认返回国际服包名
        return "com.supercell.boombeach";
    }
}

/**
 * 从游戏目录读取国际服账号名称（从 __hs_lite_sdk_store.xml 的 active_user JSON 中提取 userName）
 * @param {function} callback - 回调 (accountName) => void
 */
function getAccountNameFromGame(callback) {
    let packageName = "com.supercell.boombeach";
    let xmlPath = `/data/user/0/${packageName}/shared_prefs/__hs_lite_sdk_store.xml`;
    let fullXml = "";

    $root.getPermit();
    $root.exeRootShell(`nsenter -t 1 -m cat "${xmlPath}" 2>/dev/null || cat "${xmlPath}"`, (line) => {
        fullXml += line;
    }, (err) => {
        $log.e("读取国际服账号信息失败: " + err);
    }, (exitCode) => {
        let name = "";

        if (exitCode === 0 && fullXml) {
            let match = fullXml.match(/<string name="active_user">(.*?)<\/string>/);
            if (match) {
                let jsonStr = match[1]
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&apos;/g, "'");
                try {
                    let userData = JSON.parse(jsonStr);
                    name = userData.userName || "";
                } catch (e) {
                    $log.e("解析账号JSON失败: " + e.message);
                }
            }
        }

        // 没读到则用时间戳兜底
        if (!name) {
            let now = new Date();
            name = "存档_" + now.getFullYear() + "-" + (now.getMonth()+1) + "-" + now.getDate() + "_" + now.getHours() + now.getMinutes();
            $log.w("未读取到国际服账号名，使用时间戳: " + name);
        }

        if (callback) callback(name);
    });
}

/**
 * 从游戏设备读取存档XML内容（直接读内容，不复制文件）
 * 使用root权限 cat 读取 Android SharedPreferences XML 文件
 * 
 * @param {function} callback - (storageObj) => void
 *   storageObj = { "storage.xml": "内容", "storage_new.xml": "内容" }
 *   读取失败时 callback(null)
 */
function readStorageContent(callback) {
    $root.getPermit();
    let packageName = getGamePackageName();
    let isInternational = (packageName === "com.supercell.boombeach");
    $log.i("读取存档内容, 包名: " + packageName);

    let sourcePath1 = `/data/user/0/${packageName}/shared_prefs/storage.xml`;
    let result = {};
    let completed = 0;
    let total = isInternational ? 2 : 1;
    let hasError = false;

    // 读取 storage.xml
    let xml1 = "";
    $root.exeRootShell(`nsenter -t 1 -m cat "${sourcePath1}" 2>/dev/null || cat "${sourcePath1}"`,
        (line) => { xml1 += line; },
        (err) => {
            $log.e("读取 storage.xml 失败: " + err);
            hasError = true;
        },
        (exitCode) => {
            if (exitCode === 0 && !hasError) {
                result["storage.xml"] = xml1;
                $log.i("storage.xml 读取成功 (" + xml1.length + " bytes)");
            } else {
                $log.e("storage.xml 读取失败, 退出码: " + exitCode);
                hasError = true;
            }
            completed++;
            if (completed >= total) {
                callback(hasError ? null : result);
            }
        }
    );

    // 国际服读取 storage_new.xml
    if (isInternational) {
        let sourcePath2 = `/data/user/0/${packageName}/shared_prefs/storage_new.xml`;
        let xml2 = "";
        $root.exeRootShell(`nsenter -t 1 -m cat "${sourcePath2}" 2>/dev/null || cat "${sourcePath2}"`,
            (line) => { xml2 += line; },
            (err) => {
                $log.e("读取 storage_new.xml 失败: " + err);
                hasError = true;
            },
            (exitCode) => {
                if (exitCode === 0 && !hasError) {
                    result["storage_new.xml"] = xml2;
                    $log.i("storage_new.xml 读取成功 (" + xml2.length + " bytes)");
                } else {
                    $log.e("storage_new.xml 读取失败, 退出码: " + exitCode);
                    hasError = true;
                }
                completed++;
                if (completed >= total) {
                    callback(hasError ? null : result);
                }
            }
        );
    }
}

/**
 * 写入存档内容到游戏设备
 * 先将内容写入临时文件，再用 root 权限 cp 到游戏目录
 * 
 * @param {object} storage - { "storage.xml": "内容", "storage_new.xml": "内容" }
 * @param {function} callback - (success) => void
 */
function writeStorageContent(storage, callback) {
    let packageName = getGamePackageName();
    let isInternational = (packageName === "com.supercell.boombeach");
    $log.i("写入存档内容, 包名: " + packageName);

    // 先写入临时文件（使用 Java File API）
    let extDir = context.getExternalFilesDir(null);
    if (!extDir) {
        $log.e("无法获取外部存储路径");
        callback(false);
        return;
    }
    let accountDir = extDir.getAbsolutePath();
    var tempDir = $file.join(accountDir, ".temp_import");
    try {
        var _td = new java.io.File(tempDir);
        if (!_td.exists()) _td.mkdirs();
    } catch (e) {
        $log.e("创建临时目录失败: " + e.message);
        callback(false);
        return;
    }

    // 写入 storage.xml
    var tempPath1 = $file.join(tempDir, "storage.xml");
    try {
        _javaWriteFile(tempPath1, storage["storage.xml"]);
    } catch (e) {
        $log.e("写入临时文件 storage.xml 失败: " + e.message);
        _javaDeleteDir(tempDir);
        callback(false);
        return;
    }

    var targetPath1 = `/data/user/0/${packageName}/shared_prefs/storage.xml`;
    var result = { xml1: false, xml2: !isInternational };
    var hasError = false;

    // 用 root cp 复制到游戏目录
    $root.getPermit();
    $root.exeRootShell(`nsenter -t 1 -m cp "${tempPath1}" "${targetPath1}" 2>/dev/null || cp "${tempPath1}" "${targetPath1}"`,
        (line) => { $log.d("cp storage.xml: " + line); },
        (err) => {
            $log.e("写入 storage.xml 失败: " + err);
            hasError = true;
        },
        (exitCode) => {
            if (exitCode === 0) {
                result.xml1 = true;
                $log.i("storage.xml 写入成功");
            } else {
                $log.e("storage.xml 写入失败, 退出码: " + exitCode);
                hasError = true;
            }
            tryFinish();
        }
    );

    // 国服或没有 storage_new.xml 时，视同 xml2 已完成
    if (!isInternational || !storage["storage_new.xml"]) {
        if (isInternational && !storage["storage_new.xml"]) {
            $log.d("无 storage_new.xml 数据，跳过");
        }
        result.xml2 = true;
    }

    // 国际服写入 storage_new.xml
    if (isInternational && storage["storage_new.xml"]) {
        var tempPath2 = $file.join(tempDir, "storage_new.xml");
        try {
            _javaWriteFile(tempPath2, storage["storage_new.xml"]);
        } catch (e) {
            $log.e("写入临时文件 storage_new.xml 失败: " + e.message);
            hasError = true;
            _javaDeleteDir(tempDir);
            callback(false);
            return;
        }

        var targetPath2 = `/data/user/0/${packageName}/shared_prefs/storage_new.xml`;
        $root.getPermit();
        $root.exeRootShell(`nsenter -t 1 -m cp "${tempPath2}" "${targetPath2}" 2>/dev/null || cp "${tempPath2}" "${targetPath2}"`,
            (line) => { $log.d("cp storage_new.xml: " + line); },
            (err) => {
                $log.e("写入 storage_new.xml 失败: " + err);
                hasError = true;
            },
            (exitCode) => {
                if (exitCode === 0) {
                    result.xml2 = true;
                    $log.i("storage_new.xml 写入成功");
                } else {
                    $log.e("storage_new.xml 写入失败, 退出码: " + exitCode);
                    hasError = true;
                }
                tryFinish();
            }
        );
    }

    // 判断是否全部完成
    function tryFinish() {
        var _tempDir = tempDir;
        var _ok = result.xml1 && result.xml2 && !hasError;
        if (result.xml1 && result.xml2 || hasError) {
            var _cb = callback;
            callback = null; // 防止重复调用
            _javaDeleteDir(_tempDir);
            $log.d("临时目录已清理: " + _tempDir);
            if (_cb) _cb(_ok);
        }
    }
}

// ========== Java File API 辅助函数（绕过 AIGame 代理，可在后台线程安全使用） ==========

/**
 * 使用 Java File API 写入文件（不经过 AIGame $file 代理）
 * 可在后台线程安全调用
 */
function _javaWriteFile(path, content) {
    var file = new java.io.File(path);
    var parent = file.getParentFile();
    if (parent && !parent.exists()) parent.mkdirs();
    var fos = new java.io.FileOutputStream(file);
    fos.write(new java.lang.String(content).getBytes("UTF-8"));
    fos.close();
}

/**
 * 使用 Java File API 读取文件（不经过 AIGame $file 代理）
 * 可在后台线程安全调用
 */
function _javaReadFile(path) {
    var file = new java.io.File(path);
    if (!file.exists()) return null;
    var fis = new java.io.FileInputStream(file);
    var bytes = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, fis.available());
    fis.read(bytes);
    fis.close();
    return new java.lang.String(bytes, "UTF-8");
}

/**
 * 使用 Java File API 递归删除目录（不经过 AIGame $file 代理）
 * 可在后台线程安全调用
 */
function _javaDeleteDir(dirPath) {
    var file = new java.io.File(dirPath);
    if (!file.exists()) return;
    var files = file.listFiles();
    if (files) {
        for (var i = 0; i < files.length; i++) {
            files[i].delete();
        }
    }
    file.delete();
}

/**
 * 获取 accounts.json 的完整路径
 */
function _getAccountsJSONPath() {
    var dir = context.getExternalFilesDir(null);
    if (dir == null) return null;
    return dir.getAbsolutePath() + "/accounts.json";
}

/**
 * 从 accounts.json 加载完整数据（使用 Java File API，任何线程安全）
 * @returns {object} { version: 1, accounts: [] }
 */
function _loadData() {
    var jsonPath = _getAccountsJSONPath();
    if (!jsonPath) return { version: 1, accounts: [] };
    var content = _javaReadFile(jsonPath);
    if (content) {
        try {
            var data = JSON.parse(content);
            if (data && data.accounts && Array.isArray(data.accounts)) return data;
        } catch (e) {
            $log.w("解析 accounts.json 失败: " + e.message);
        }
    }
    return { version: 1, accounts: [] };
}

/**
 * 获取所有账号的元数据列表（不含 storage 内容）
 * 任何线程安全
 * @returns {Array}
 */
function listAccounts() {
    var data = _loadData();
    var result = [];
    for (var i = 0; i < data.accounts.length; i++) {
        var acc = data.accounts[i];
        result.push({
            id: acc.id,
            name: acc.name,
            serverType: acc.serverType,
            metadata: acc.metadata,
            skipAccount: acc.skipAccount === true
        });
    }
    return result;
}

/**
 * 根据名称查找账号（含 storage 内容）
 * 任何线程安全
 * @param {string} name
 * @returns {object|null}
 */
function getAccountByName(name) {
    if (!name) return null;
    var data = _loadData();
    for (var i = 0; i < data.accounts.length; i++) {
        if (data.accounts[i].name === name) {
            return data.accounts[i];
        }
    }
    return null;
}

/**
 * 标记需要刷新列表（写标记文件，跨线程通信用）
 * 可在后台线程安全调用（仅 Java File API）
 */
function _markPendingRefresh() {
    try {
        var dir = context.getExternalFilesDir(null);
        if (dir != null) {
            var flag = new java.io.File(dir.getAbsolutePath(), ".pending_refresh");
            flag.createNewFile();
        }
    } catch (e) {
        $log.w("写刷新标记失败: " + e.message);
    }
}

/**
 * 在后台线程安全的 JSON 存档保存
 * 使用 Java File API 读写 accounts.json，完全不经过 AIGame $file 代理
 */
function _saveExportToJSON(name, storage, callback) {
    try {
        var packageName = getGamePackageName();
        var serverType = (packageName === "com.supercell.boombeach") ? "国际服" : "国服";
        var jsonPath = _getAccountsJSONPath();
        if (!jsonPath) {
            $log.e("无法获取 accounts.json 路径");
            if (callback) callback(false);
            return;
        }

        // 读取现有 JSON 数据
        var data = null;
        var content = _javaReadFile(jsonPath);
        if (content) {
            try {
                data = JSON.parse(content);
                if (!data || !data.accounts || !Array.isArray(data.accounts)) {
                    data = null;
                }
            } catch (e) {
                $log.w("解析 accounts.json 失败，将重新创建: " + e.message);
                data = null;
            }
        }

        // 创建空数据结构
        if (!data) {
            data = { version: 1, accounts: [] };
        }

        // 生成 ID 和时间戳
        var now = Date.now();
        var id = "acc_" + now + "_" + Math.random().toString(36).substr(2, 6);

        // 检查是否已存在同名账号，存在则更新
        var found = false;
        for (var i = 0; i < data.accounts.length; i++) {
            if (data.accounts[i].name === name) {
                data.accounts[i].serverType = serverType;
                data.accounts[i].storage = storage;
                data.accounts[i].metadata.updatedAt = now;
                found = true;
                $log.i("更新已有账号存档: " + name);
                break;
            }
        }

        // 不存在则新增
        if (!found) {
            data.accounts.push({
                id: id,
                name: name,
                serverType: serverType,
                storage: storage,
                metadata: {
                    createdAt: now,
                    updatedAt: now,
                    note: "从导出生成"
                },
                skipAccount: false
            });
            $log.i("新增账号存档: " + name + " (ID: " + id + ")");
        }

        // 写回文件
        _javaWriteFile(jsonPath, JSON.stringify(data, null, 2));
        $log.i("JSON存档导出成功: " + name);
        _markPendingRefresh();
        if (callback) callback(true);

    } catch (e) {
        $log.e("JSON存档导出失败: " + e.message);
        if (callback) callback(false);
    }
}

/**
 * JSON方式导出账号存档
 * 直接从游戏目录读取XML内容，存入 accounts.json
 * 取代旧的 copy_shell + 文件目录方式
 * 
 * @param {string} name - 账号名称
 * @param {function} callback - (success) => void
 */
function exportAccountArchiveJSON(name, callback) {
    if (!name || name.trim() === '') {
        $log.e("账号名称不能为空");
        if (callback) callback(false);
        return;
    }

    let accountName = name.trim();
    $log.i("开始JSON存档导出: " + accountName);

    // 读取XML内容（在后台线程安全执行）
    readStorageContent(function (storage) {
        if (!storage) {
            $log.e("读取存档内容失败");
            toast("读取存档内容失败，请检查Root权限");
            if (callback) callback(false);
            return;
        }

        // 使用 Java File API 保存（后台线程安全，不经过 AIGame 代理）
        _saveExportToJSON(accountName, storage, callback);
    });
}

/**
 * JSON方式导入账号存档
 * 从 accounts.json 读取内容并写回游戏目录
 * 取代旧的从目录 cp 方式
 * 
 * @param {string} name - 账号名称
 * @param {function} callback - (success) => void
 */
function importAccountArchiveJSON(name, callback) {
    if (!name || name.trim() === '') {
        $log.e("账号名称不能为空");
        if (callback) callback(false);
        return;
    }

    let accountName = name.trim();
    $log.i("开始JSON存档导入: " + accountName);

    try {
        // 从JSON获取存档（使用内部 Java File API，任何线程安全）
        let account = getAccountByName(accountName);
        if (!account) {
            $log.e("JSON中未找到存档: " + accountName);
            toast("存档不存在: " + accountName);
            if (callback) callback(false);
            return;
        }

        let storage = account.storage;
        if (!storage || !storage["storage.xml"]) {
            $log.e("存档数据不完整，缺少storage.xml: " + accountName);
            toast("存档数据不完整");
            if (callback) callback(false);
            return;
        }

        // 写入游戏目录
        writeStorageContent(storage, function (success) {
            if (success) {
                $log.i("JSON存档导入成功: " + accountName);
                toast("存档切换成功: " + accountName);
            } else {
                $log.e("JSON存档导入失败: " + accountName);
                toast("存档切换失败，请检查Root权限");
            }
            if (callback) callback(success);
        });

    } catch (e) {
        $log.e("JSON存档导入失败: " + e.message);
        toast("存档切换失败: " + e.message);
        if (callback) callback(false);
    }
}

/**
 * 删除指定名称的账号存档
 * 使用 Java File API，任何线程安全
 * @param {string} name - 账号名称
 * @returns {boolean} 是否删除成功
 */
function removeAccount(name) {
    if (!name) return false;
    try {
        var data = _loadData();
        var found = false;
        for (var i = 0; i < data.accounts.length; i++) {
            if (data.accounts[i].name === name) {
                data.accounts.splice(i, 1);
                found = true;
                break;
            }
        }
        if (!found) return false;
        var jsonPath = _getAccountsJSONPath();
        if (!jsonPath) return false;
        _javaWriteFile(jsonPath, JSON.stringify(data, null, 2));
        $log.i("已删除账号: " + name);
        _markPendingRefresh();
        return true;
    } catch (e) {
        $log.e("删除账号失败: " + e.message);
        return false;
    }
}

/**
 * 导出所有账号到用户可访问的本地文件（.ls 专用格式）
 * 路径: /sdcard/存档.ls
 * 任何线程安全
 */
function exportToLocalFile() {
    try {
        var data = _loadData();
        if (!data || !data.accounts || data.accounts.length === 0) {
            return { success: false, msg: "没有可导出的账号" };
        }
        // 转换为单机.txt 格式
        var exportList = [];
        for (var i = 0; i < data.accounts.length; i++) {
            var acc = data.accounts[i];
            var xml1 = acc.storage && acc.storage["storage.xml"] ? acc.storage["storage.xml"] : "";
            var xml2 = acc.storage && acc.storage["storage_new.xml"] ? acc.storage["storage_new.xml"] : "";
            // 合并两个 XML，用 /mx/ 分隔
            var dateXml = xml1;
            if (xml2) dateXml += "/mx/" + xml2;
            exportList.push({
                length: i + 1,
                name: acc.name,
                mess: "",
                date: dateXml,
                skipAccount: acc.skipAccount === true
            });
        }
        var jsonStr = JSON.stringify(exportList, null, 2);
        // 写入 sdcard 根目录，使用专用 .ls 后缀
        var filePath = "/sdcard/存档.ls";
        _javaWriteFile(filePath, jsonStr);
        $log.i("存档已导出: " + filePath + " (" + exportList.length + " 个账号)");
        return { success: true, path: filePath, count: exportList.length };
    } catch (e) {
        $log.e("导出存档失败: " + e.message);
        return { success: false, msg: e.message };
    }
}

/**
 * 从本地文件导入存档
 * @param {string} filePath - 文件路径
 * @returns {object} { success, count, msg }
 */
function importFromLocalFile(filePath) {
    try {
        var content = _javaReadFile(filePath);
        if (!content) return { success: false, msg: "文件不存在或为空" };
        var list = JSON.parse(content);
        if (!list || !Array.isArray(list) || list.length === 0) {
            return { success: false, msg: "文件格式错误，没有找到有效账号" };
        }
        var data = _loadData();
        var added = 0;
        var updated = 0;
        var now = Date.now();
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!item.name || !item.date) continue;
            // 解析 date: 以 /mx/ 分隔两个 XML
            var storage = {};
            var dateStr = item.date;
            var mxIdx = dateStr.indexOf("/mx/");
            if (mxIdx >= 0) {
                storage["storage.xml"] = dateStr.substring(0, mxIdx);
                storage["storage_new.xml"] = dateStr.substring(mxIdx + 4);
            } else {
                storage["storage.xml"] = dateStr;
            }
            // 判断服务器类型
            var sv = "国际服";
            // 检查是否已存在同名账号
            var found = false;
            for (var j = 0; j < data.accounts.length; j++) {
                if (data.accounts[j].name === item.name) {
                    data.accounts[j].storage = storage;
                    data.accounts[j].metadata.updatedAt = now;
                    if (item.skipAccount !== undefined) data.accounts[j].skipAccount = item.skipAccount;
                    found = true;
                    updated++;
                    break;
                }
            }
            if (!found) {
                data.accounts.push({
                    id: "acc_" + now + "_" + Math.random().toString(36).substr(2, 6),
                    name: item.name,
                    serverType: sv,
                    storage: storage,
                    metadata: {
                        createdAt: now,
                        updatedAt: now,
                        note: "从本地文件导入"
                    },
                    skipAccount: item.skipAccount === true
                });
                added++;
            }
        }
        if (added > 0 || updated > 0) {
            var jp = _getAccountsJSONPath();
            if (jp) _javaWriteFile(jp, JSON.stringify(data, null, 2));
        }
        $log.i("导入完成: 新增 " + added + ", 更新 " + updated);
        _markPendingRefresh();
        return { success: true, added: added, updated: updated };
    } catch (e) {
        $log.e("导入存档失败: " + e.message);
        return { success: false, msg: e.message };
    }
}

/**
 * 扫描 /sdcard/ 目录下的 .ls 存档文件
 * @returns {Array} 文件路径数组
 */
function scanLSFiles() {
    try {
        var dir = new java.io.File("/sdcard/");
        if (!dir.exists() || !dir.isDirectory()) return [];
        var files = dir.listFiles(new java.io.FileFilter({
            accept: function(f) {
                return f.isFile() && f.getName().endsWith(".ls");
            }
        }));
        if (!files || files.length === 0) return [];
        var result = [];
        for (var i = 0; i < files.length; i++) {
            result.push(files[i].getAbsolutePath());
        }
        result.sort();
        return result;
    } catch (e) {
        $log.e("扫描存档文件失败: " + e.message);
        return [];
    }
}

/**
 * 从 .ls 文件导入存档（自动扫描 sdcard 并导入第一个找到的）
 * @returns {object} { success, added, updated, msg, path }
 */
function autoImportFromSdcard() {
    try {
        var files = scanLSFiles();
        if (files.length === 0) {
            return { success: false, msg: "未在 /sdcard/ 下找到 .ls 存档文件" };
        }
        // 导入第一个找到的 .ls 文件
        var filePath = files[0];
        var result = importFromLocalFile(filePath);
        if (result.success) {
            result.path = filePath;
        }
        return result;
    } catch (e) {
        $log.e("自动导入存档失败: " + e.message);
        return { success: false, msg: e.message };
    }
}

// 导出模块函数
let account = {
    getGamePackageName: getGamePackageName,
    getAccountNameFromGame: getAccountNameFromGame,
    // JSON 方式新函数
    readStorageContent: readStorageContent,
    writeStorageContent: writeStorageContent,
    exportAccountArchiveJSON: exportAccountArchiveJSON,
    importAccountArchiveJSON: importAccountArchiveJSON,
    // 统一数据存取（替代 accountStorage.js）
    listAccounts: listAccounts,
    getAccountByName: getAccountByName,
    removeAccount: removeAccount,
    // 导入导出
    exportToLocalFile: exportToLocalFile,
    importFromLocalFile: importFromLocalFile,
    scanLSFiles: scanLSFiles,
    autoImportFromSdcard: autoImportFromSdcard,
    // 内部工具（供外部拖拽排序等场景使用）
    _getAccountsJSONPath: _getAccountsJSONPath,
    _javaWriteFile: _javaWriteFile,
    _loadData: _loadData
};
account;