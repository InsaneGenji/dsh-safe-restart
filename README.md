# dsh-safe-restart

给 **DeepSeek Harness 桌面端**托盘点菜单加一项「**重启 DeepSeek Harness**」。

- 有正在运行的任务时 → 先弹一个 Electron 原生确认框，**标题和按钮都写「重启」**，并沿用官方那句「当前正在运行的任务将会中断」。
- 没有任务在跑 → 直接重启，不弹框。
- 判断条件与官方托盘的「退出 DeepSeek Harness」**完全同源**：`backend.host.inspectQuit()` + `resolveDesktopQuitPrompt()`，所以「什么算有任务」永远跟退出那套一致。

为什么要有它：桌面端自带的托盘只有「打开应用 / 退出」。改完插件、改完配置想让改动生效，只能整个退出再手动打开，很容易丢掉没保存的会话。有了这一项就是一次点击。

## 为什么它要改 `main.js`

DSH 插件跑在独立的 Node 子进程里（`lib/main.js` 里 `spawn(this.node, ...)`），`require('electron')` 拿不到 `Tray` / `dialog`。托盘菜单项和原生确认框只能由**主进程**提供入口，所以本插件对客户端的 `resources/app/lib/main.js` 做了两处精确注入：

1. `DesktopTray.relabel()` 的菜单模板里，在 separator 之后插入「重启」项；
2. `main()` 里构造 `new DesktopTray({...})` 时多传一个 `restart` 回调，回调内部先按官方逻辑判断要不要确认，再 `app.relaunch()` + `quitWithoutConfirmation()`。

注入只做字符串精确替换，**幂等**：已经打过就什么都不做；结构对不上（换了 DSH 大版本）就一个字节都不改，并在设置页报「main.js 结构与预期不符」。

## 安装

从插件市场装，或者：

```bash
dsh plugin --profile desktop add dsh-safe-restart
```

装完**重启一次 DSH**（托盘「退出」再打开，或者用别的办法重启）。补丁是在宿主插件启动时写进 `main.js` 的，主进程代码已经在内存里，所以这一次必须手动重启；之后再点托盘「重启」就能用了。

## 设置页

设置里会多一页「安全重启」，能看到：

- 补丁状态（已生效 / 未打 / 结构不符）
- 实际的 `main.js` 路径、文件大小、是否可写
- 备份文件位置（`main.js.bak-dsh-safe-restart`）
- 按钮：打补丁 / 撤销补丁 / 重新检测 / 刷新
- 最近日志（`%LOCALAPPDATA%\dsh-safe-restart\safe-restart.log`）

## 客户端升级会怎样

桌面端升级会把 `resources/app` 整个换掉，补丁随之消失。本插件**每次启动都会检查**：只要发现 `main.js` 是干净的官方结构，就自动重打一次，并在设置页标「要重启一次才生效」。

如果新版 `main.js` 结构变了（锚点对不上），插件会跳过、只记日志，不会把客户端改坏。

## 安全兜底

- 写盘前先把原文件备份成 `main.js.bak-dsh-safe-restart`；
- 新内容先写到 `main.js.dsh-safe-restart.tmp`，用当前 Node 跑一次 `--check`，语法过了才 `rename` 覆盖；
- 任何一步失败都会保持原文件不动。

## 平台

目前只支持 **Windows 桌面端**（托盘菜单在 `process.platform === "win32"` 分支里）。macOS / Linux 上插件能装，但不会打补丁，设置页会显示不支持。

## 打包态（app.asar）

如果 `resources/app.asar` 存在、`resources/app` 目录不存在，说明客户端是打包态，插件无法改 `main.js`，设置页会明说。需要先把 asar 解包成本目录（例如用 `dsh-purge` 那类工具），再让插件打补丁。

## 许可

MIT

## 核验补丁接线

```bash
node scripts/verify-main.mjs            # 自动在常见安装位置找 main.js
node scripts/verify-main.mjs <main.js>  # 或显式指定
```

只读脚本，核对三项容易「看着 patched 其实接错」的地方：托盘菜单项确实排在「退出」前面、`DesktopTray` 构造实参里确实传了 `restart`、`safeRestart` 引用的 `resolveDesktopQuitPrompt` / `quitting` / `backend` / `app.relaunch` 都在。
