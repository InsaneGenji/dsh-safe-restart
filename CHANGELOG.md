# 变更记录

## 0.1.0 — 2026-11-18

首个版本。

- 桌面端托盘菜单新增「重启 DeepSeek Harness」。
- 有任务在跑时弹 Electron 原生确认框：标题 `重启 DeepSeek Harness?`、按钮 `重启 / 取消`、说明沿用官方的「当前正在运行的任务将会中断」。
- 判断条件复用官方 `backend.host.inspectQuit()` + `resolveDesktopQuitPrompt()`，与托盘「退出」同源。
- 启动时自动检测并重打补丁（应对客户端升级覆盖 `main.js`）。
- 写盘前备份 + `node --check` 语法校验，失败保持原文件不动。
- 设置页「安全重启」：状态、路径、备份、打补丁 / 撤销 / 重新检测、日志。
