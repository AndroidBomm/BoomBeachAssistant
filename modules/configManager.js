/**
 * AIGame配置管理模块
 * 负责保存和加载应用程序配置
 * 基于AIGame平台API开发
 * 配置保存位置与锁云模块统一使用外部存储
 */

// 配置文件缓存，避免重复加载
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TIMEOUT = 10000; // 10秒缓存

// 日志去重机制
let logCache = {};
const LOG_CACHE_TIMEOUT = 30000; // 30秒日志去重

/**
 * 智能日志函数，避免重复日志
 * @param {string} type - 日志类型 'd', 'i', 'w', 'e'
 * @param {string} message - 日志消息
 */
function smartLog(type, message) {
    let currentTime = Date.now();
    let logKey = type + '_' + message;

    // 检查是否在30秒内已经记录过相同日志
    if (logCache[logKey] && (currentTime - logCache[logKey]) < LOG_CACHE_TIMEOUT) {
        return; // 跳过重复日志
    }

    // 记录日志并更新时间戳
    logCache[logKey] = currentTime;

    // 根据类型调用相应的日志函数
    switch (type) {
        case 'd':
            $log.d(message);
            break;
        case 'i':
            $log.i(message);
            break;
        case 'w':
            $log.w(message);
            break;
        case 'e':
            $log.e(message);
            break;
        default:
            $log.d(message);
    }
}

// 获取配置文件路径
function getConfigPath() {
    // 使用AIGame内置的context对象获取外部文件目录，与锁云模块保持一致
    let externalFilesDir = context.getExternalFilesDir(null);

    if (externalFilesDir != null) {
        let basePath = externalFilesDir.getAbsolutePath();
        let configDir = $file.join(basePath, "config");

        // 确保config目录存在
        if (!$file.exists(configDir)) {
            $file.mkdir(configDir);
            $log.d("创建config目录: " + configDir);
        }

        let configPath = $file.join(configDir, "config.json");

        // 只在首次调用或10秒后记录路径，避免重复日志
        if (!getConfigPath._lastLogTime || Date.now() - getConfigPath._lastLogTime > 10000) {
            $log.d("配置文件路径: " + configPath);
            getConfigPath._lastLogTime = Date.now();
        }

        return configPath;
    } else {
        $log.e("无法获取外部文件目录");
        throw new Error("无法获取外部文件目录");
    }
}

/**
 * 保存配置到文件
 * @param {Object} config - 配置对象
 * @returns {boolean} - 是否保存成功
 */
function saveConfig(config) {
    try {
        // 使用中国时区，简洁专业
        config.lastUpdate = new Date().toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai'
        });

        let configPath = getConfigPath();
        let configStr = JSON.stringify(config, null, 2);
        $file.write(configStr, configPath);

        // 使用智能日志函数，避免重复日志
        smartLog('d', "配置保存成功: " + configPath + ", 时间: " + config.lastUpdate);

        // 保存成功后更新缓存
        configCache = config;
        configCacheTime = new Date().getTime();

        return true;
    } catch (e) {
        smartLog('e', "配置保存失败: " + e.message);
        return false;
    }
}

/**
 * 从文件加载配置
 * @returns {Object} - 配置对象，如果文件不存在或读取失败返回空对象
 */
function loadConfig() {
    try {
        // 检查缓存是否有效（10秒内）
        let currentTime = new Date().getTime();
        if (configCache !== null && (currentTime - configCacheTime) < CONFIG_CACHE_TIMEOUT) {
            return configCache;
        }

        let configPath = getConfigPath();

        // 检查配置文件是否存在
        if (!$file.exists(configPath)) {
            $log.d("配置文件不存在，返回默认配置");
            return {};
        }

        let configStr = $file.read(configPath);
        if (!configStr || configStr.trim() === "") {
            $log.d("配置文件为空，返回默认配置");
            return {};
        }

        let config = JSON.parse(configStr);
        // 只在首次加载时显示简洁成功信息，避免冗长的JSON内容
        if (!this._configLoaded) {
            smartLog('d', "配置加载成功，共" + Object.keys(config).length + "个配置项");
            this._configLoaded = true;
        }

        // 更新缓存
        configCache = config;
        configCacheTime = currentTime;

        return config;
    } catch (e) {
        smartLog('e', "配置加载失败: " + e.message);
        return {};
    }
}

/**
 * 获取默认配置
 * @returns {Object} - 默认配置对象
 */
function getDefaultConfig() {
    return {
        // 锁云功能
        serverType: "国际服", // 默认服务器类型
        lockCloudStatus: "国际服: 未锁云", // 锁云状态

        // NPC功能选择
        npcFunction: "清理NPC", // 默认NPC功能

        // 账号信息
        switchAccount: false, // 多号开关
        currentAccountMethod: "archive", // 上号方式: "archive" 或 "text"

        // 系统设置
        lastUpdate: new Date().toISOString()
    };
}

/**
 * 初始化配置（如果不存在则创建默认配置）
 * @returns {Object} - 配置对象
 */
function initConfig() {
    let config = loadConfig();

    // 如果配置为空，创建默认配置
    if (Object.keys(config).length === 0) {
        config = getDefaultConfig();
        saveConfig(config);
        $log.d("创建默认配置");
    }

    return config;
}

/**
 * 更新配置项
 * @param {string} key - 配置键
 * @param {*} value - 配置值
 * @returns {boolean} - 是否更新成功
 */
function updateConfig(key, value) {
    try {
        let config = loadConfig();
        config[key] = value;
        config.lastUpdate = new Date().toISOString();
        let result = saveConfig(config);

        // 如果保存成功，更新缓存
        if (result) {
            configCache = config;
            configCacheTime = new Date().getTime();
        }

        return result;
    } catch (e) {
        $log.e("配置更新失败: " + e.message);
        return false;
    }
}

/**
 * 获取配置项
 * @param {string} key - 配置键
 * @param {*} defaultValue - 默认值
 * @returns {*} - 配置值或默认值
 */
function getConfigItem(key, defaultValue = null) {
    try {
        // 如果缓存有效，直接使用缓存数据
        let currentTime = new Date().getTime();
        if (configCache !== null && (currentTime - configCacheTime) < CONFIG_CACHE_TIMEOUT) {
            return configCache.hasOwnProperty(key) ? configCache[key] : defaultValue;
        }

        // 缓存无效时加载配置并更新缓存
        let config = loadConfig();
        return config.hasOwnProperty(key) ? config[key] : defaultValue;
    } catch (e) {
        smartLog('e', "获取配置项失败: " + e.message);
        return defaultValue;
    }
}

/**
 * 清除配置缓存
 * 用于强制刷新配置数据
 */
function clearConfigCache() {
    configCache = null;
    configCacheTime = 0;
    smartLog('d', "配置缓存已清除");
}

// AIGame模块导出方式 - 使用对象导出
let configManager = {
    getConfigPath: getConfigPath,
    saveConfig: saveConfig,
    loadConfig: loadConfig,
    getDefaultConfig: getDefaultConfig,
    initConfig: initConfig,
    updateConfig: updateConfig,
    getConfigItem: getConfigItem,
    clearConfigCache: clearConfigCache
};

// 导出模块
configManager;