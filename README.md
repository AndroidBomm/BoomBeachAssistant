# 海岛小助手（AutoGOD）

海岛奇兵（Boom Beach）自动化助手，基于 **AutoGOD** 平台。

> 当前用途：**改造为「声呐潜艇」自动化项目前的安全回滚点**。

## 目录结构

```
├── main.js               UI 主逻辑（标签页、锁云、运行功能）
├── ui/main.xml           界面布局（41 个控件）
├── project.json          AutoGOD 项目配置
├── modules/
│   ├── OperHandler.js    ★ 图色插件 v4.9.4（第三方，见下方声明）
│   ├── imageFinder.js    找图找色封装（自动回收 Mat / 重试 / 区域搜索 / 配置化）
│   ├── configManager.js  配置管理
│   ├── floatyLog.js      悬浮窗日志
│   ├── lockcloud.js      锁云 / 存档
│   ├── accountManager.js 账号管理
│   ├── pauseManager.js   暂停控制
│   └── sonar/
│       ├── geometry.js       ★ 单应变换：棋盘 4 角 → n² 个格中心（自研）
│       └── geometry.test.js  离线单元测试（38 项，用 node 直接跑）
├── scripts/
│   ├── autoSonar.js      声呐四角检测原型（截图→HSV→颜色范围→开闭→四边形检测）
│   └── chaDiaoXiang.js
└── res/
    ├── csv/              海岛奇兵游戏数据
    ├── icon/
    ├── images/
    └── lib/              ★ 图色插件原生库（第三方，见下方声明）
```

## 界面标签页

| 标签 | 状态 |
|---|---|
| 首页 | 无障碍/Root 状态、锁云、运行功能（查雕像 / 自动声纳）、启动/关闭 |
| 账号信息 | 账号列表、存档生成/导出/读取/清空、邮箱登录 |
| 查雕设置 | 待补充 |
| **声纳设置** | **空占位（"功能开发中"）—— 本项目下一步要填的就是这里** |
| 更多 | 占位 |

## 运行环境

- AutoGOD 客户端（实测 v2.0.1）
- 雷电模拟器 9 / Android 9，**720×1280 竖屏配置**（横屏游戏启动后自动旋转，截图实际为 1280×720）
- 需 Root（iptables 用于声呐方案的弱网控制）

## 第三方内容声明

本仓库包含**冉遗鱼图色插件**的相关文件，**版权归原作者所有**：

- `modules/OperHandler.js`（源码，文件头署名「作者:冉遗鱼 QQ:244574798」）
- `res/lib/`（编译产物：`classes-yu.dex` + 4 个 `libnative-*.so`，共约 80 MB）

- 官方文档：http://www.ylancf.com/showdoc/web/#/645898090/179425265
- 本仓库**不主张任何版权**，仅为项目可运行而收录。**请勿单独再分发这些文件。**
- 如需最新版：作者 QQ 244574798

## 开发说明

`modules/sonar/geometry.test.js` 可用 node 离线运行（不需要模拟器）：

```bash
node modules/sonar/geometry.test.js
```

用真实标定的棋盘四角（来自 lwt15556/boom v1.1.0）当标准答案，验证单应变换的正确性。