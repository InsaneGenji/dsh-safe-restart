# 变更记录

## 0.1.2

- 与 0.1.1 内容一致，仅重发：0.1.1 当时的 tarball 在 registry 上一度 404（传播未完成），重发一个版本把 latest 顶到可下载的包

## 0.1.1

- 修：语法预检改用真正的 node（`process.execPath` 在宿主里指向 Electron 的 exe，`--check` 会失败，导致启动时自动重打直接放弃）。查找顺序：`DSH_SAFE_RESTART_NODE` / `DSH_NODE_BIN` → 自身是 node → 客户端自带 runtime → PATH；都没有就跳过预检并记一条 warn，备份与原子写入照旧。

## 0.1.0 — 2026-11-18

首个版本。

- 桌面端托盘菜单新增「重启 DeepSeek Harness」。
- 有任务在跑时弹 Electron 原生确认框：标题 `重启 DeepSeek Harness?`、按钮 `重启 / 取消`、说明沿用官方的「当前正在运行的任务将会中断」。
- 判断条件复用官方 `backend.host.inspectQuit()` + `resolveDesktopQuitPrompt()`，与托盘「退出」同源。
- 启动时自动检测并重打补丁（应对客户端升级覆盖 `main.js`）。
- 写盘前备份 + `node --check` 语法校验，失败保持原文件不动。
- 设置页「安全重启」：状态、路径、备份、打补丁 / 撤销 / 重新检测、日志。
