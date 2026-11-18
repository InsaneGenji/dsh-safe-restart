/**
 * dsh-safe-restart — main.js 补丁（纯函数，可单独单测）
 *
 * 桌面端主进程 = <app>/lib/main.js（Electron 0.2.x 是解包目录 + ESM）。
 * DSH 插件跑在独立 Node 子进程里，拿不到 electron 的托盘与对话框，
 * 所以「托盘加一项 + 弹原生确认框」只能落在这个文件上。
 *
 * 本模块只做字符串级别的精确替换，幂等：
 *   status(source) -> 'patched' | 'clean' | 'unknown'
 *   apply(source)  -> { source, changed }
 *   revert(source) -> { source, changed }
 */

export const MARK = 'dsh-safe-restart patch v1'

/** 托盘菜单：官方只有「打开应用 / separator / 退出」，在 separator 之后插一项重启。 */
const MENU_OLD = [
  '\t\t\t{ type: "separator" },',
  '\t\t\t{',
  '\t\t\t\tlabel: messages.quitApplication,'
].join('\n')

const MENU_NEW = [
  '\t\t\t{ type: "separator" },',
  '\t\t\t{',
  '\t\t\t\tlabel: messages.restartApplication + " " + messages.aboutProduct,',
  '\t\t\t\tclick: () => {',
  '\t\t\t\t\tthis.options.restart?.();',
  '\t\t\t\t}',
  '\t\t\t},',
  '\t\t\t{',
  '\t\t\t\tlabel: messages.quitApplication,'
].join('\n')

/** 托盘构造：把一个 restart 回调塞进 options。 */
const CTOR_OLD = [
  '\tif (process.platform === "win32") try {',
  '\t\ttray = new DesktopTray({',
  '\t\t\ticonPath: trayIconPath,'
].join('\n')

const RESTART_OPTION = [
  '\t\t\trestart: () => {',
  '\t\t\t\tvoid safeRestart();',
  '\t\t\t},'
].join('\n')

/**
 * 注入到 main() 里的函数块。
 * 判断条件与官方「退出」完全同源：backend.host.inspectQuit() + resolveDesktopQuitPrompt()。
 * 唯一区别是文案——message 用「重启 DeepSeek Harness?」，按钮用「重启」。
 */
const BLOCK = [
  '\t// >>> ' + MARK + ' (begin)',
  '\tconst safeRestart = async () => {',
  '\t\tif (quitting) return;',
  '\t\tlet prompt;',
  '\t\ttry {',
  '\t\t\tconst inspection = backend.host === void 0 ? void 0 : backend.host.inspectQuit();',
  '\t\t\tprompt = inspection === void 0 ? void 0 : resolveDesktopQuitPrompt(await inspection);',
  '\t\t} catch {',
  '\t\t\tprompt = "quitActiveTasks";',
  '\t\t}',
  '\t\tif (prompt !== void 0) {',
  '\t\t\tconst messages = currentDesktopLocale().messages;',
  '\t\t\tconst zh = /[\\u4e00-\\u9fff]/.test(messages.quitTitle);',
  '\t\t\tconst result = await dialog.showMessageBox({',
  '\t\t\t\ttype: "none",',
  '\t\t\t\t...process.platform === "win32" ? { icon: nativeImage.createFromPath(trayIconPath) } : {},',
  '\t\t\t\ttitle: messages.aboutProduct,',
  '\t\t\t\tmessage: messages.restartApplication + " " + messages.aboutProduct + (zh ? "？" : "?"),',
  '\t\t\t\tdetail: messages[prompt],',
  '\t\t\t\tbuttons: [messages.restartApplication, messages.cancel],',
  '\t\t\t\tdefaultId: 0,',
  '\t\t\t\tcancelId: 1,',
  '\t\t\t\tnoLink: true',
  '\t\t\t});',
  '\t\t\tif (result.response !== 0) return;',
  '\t\t}',
  '\t\tapp.relaunch();',
  '\t\tquitWithoutConfirmation();',
  '\t};',
  '\t// <<< ' + MARK + ' (end)',
  ''
].join('\n')

const CTOR_NEW = BLOCK + CTOR_OLD + '\n' + RESTART_OPTION

function count(hay, needle) {
  if (!needle) return 0
  let n = 0
  let at = hay.indexOf(needle)
  while (at !== -1) {
    n += 1
    at = hay.indexOf(needle, at + needle.length)
  }
  return n
}

export function status(source) {
  if (typeof source !== 'string' || source === '') return 'unknown'
  const marked = source.includes(MARK)
  const menu = count(source, MENU_NEW) === 1
  const ctor = count(source, CTOR_NEW) === 1
  if (marked && menu && ctor) return 'patched'
  if (!marked && count(source, MENU_OLD) === 1 && count(source, CTOR_OLD) === 1) return 'clean'
  return 'unknown'
}

export function apply(source) {
  if (typeof source !== 'string') throw new Error('main.js 内容不是字符串')
  const state = status(source)
  if (state === 'patched') return { source, changed: false, state }
  if (state === 'unknown') throw new Error('main.js 结构与预期不符（可能是别的 DSH 版本或已被其它补丁改过），未做任何修改')

  let next = source
  if (count(next, MENU_OLD) !== 1) throw new Error('找不到托盘菜单锚点（quitApplication）')
  next = next.replace(MENU_OLD, MENU_NEW)
  if (count(next, CTOR_OLD) !== 1) throw new Error('找不到托盘构造锚点（new DesktopTray）')
  next = next.replace(CTOR_OLD, CTOR_NEW)
  return { source: next, changed: true, state: 'patched' }
}

export function revert(source) {
  if (typeof source !== 'string') throw new Error('main.js 内容不是字符串')
  const state = status(source)
  if (state === 'clean') return { source, changed: false, state }
  if (state === 'unknown') throw new Error('main.js 里找不到完整的补丁标记，未做任何修改')

  let next = source
  if (count(next, CTOR_NEW) !== 1) throw new Error('补丁不完整：找不到托盘构造补丁块')
  next = next.replace(CTOR_NEW, CTOR_OLD)
  if (count(next, MENU_NEW) !== 1) throw new Error('补丁不完整：找不到托盘菜单补丁块')
  next = next.replace(MENU_NEW, MENU_OLD)
  return { source: next, changed: true, state: 'clean' }
}

export const anchors = { MENU_OLD, MENU_NEW, CTOR_OLD, CTOR_NEW, RESTART_OPTION, BLOCK }
