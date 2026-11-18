#!/usr/bin/env node
/**
 * 手工核验工具：确认 main.js 里的补丁接线完整、位置正确。
 *
 *   node scripts/verify-main.mjs [main.js 路径]
 *
 * 只读，不改任何文件。插件自己的 /safe-restart/state 已经能报 patched/clean，
 * 但「patched」只说明标记在，这个脚本额外核对三件事：
 *   1. 托盘菜单项真的建在 Menu 模板里，且排在「退出」之前
 *   2. DesktopTray 构造时真的把 restart 回调传进去了
 *   3. safeRestart 引用的 resolveDesktopQuitPrompt / quitting / backend / app.relaunch 都在
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function guessMainPath() {
  const fromEnv = process.env.DSH_DESKTOP_APP_DIR
  if (fromEnv) return path.join(fromEnv, 'lib', 'main.js')
  const roots = [
    process.env['ProgramFiles'],
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')
  ].filter(Boolean)
  const candidates = roots.map((root) => path.join(root, 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'))
  candidates.push(path.join('D:', 'Software', 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'))
  for (const file of candidates) {
    if (fs.existsSync(file)) return file
  }
  return ''
}

const target = process.argv[2] || guessMainPath()
if (target === '' || !fs.existsSync(target)) {
  console.error('找不到 main.js；用法：node scripts/verify-main.mjs <main.js 路径>')
  process.exit(2)
}

const source = fs.readFileSync(target, 'utf8')
const count = (re) => (source.match(re) || []).length
const at = (needle) => source.indexOf(needle)

const menuItem = /label: messages\.restartApplication \+ " " \+ messages\.aboutProduct,\s*\r?\n\s*click: \(\) => \{/g
const trayRestart = /restart: \(\) => \{\s*\r?\n?\s*void safeRestart\(\);/g

const safeAt = at('const safeRestart = async () =>')
const trayAt = at('tray = new DesktopTray({')
const restartCbAt = source.search(trayRestart)
const menuAt = source.search(menuItem)
const quitAt = source.indexOf('label: messages.quitApplication', menuAt >= 0 ? menuAt : 0)
const resolveAt = at('function resolveDesktopQuitPrompt(')
const quittingAt = at('let quitting = false')

const checks = [
  ['托盘菜单项存在（1 处）', count(menuItem) === 1, count(menuItem)],
  ['菜单项排在「退出」之前', menuAt >= 0 && quitAt > menuAt, `${menuAt} < ${quitAt}`],
  ['DesktopTray 收到 restart 回调（1 处）', count(trayRestart) === 1, count(trayRestart)],
  ['safeRestart 定义在 tray 构造之前', safeAt > 0 && trayAt > safeAt, `${safeAt} < ${trayAt}`],
  ['restart 回调落在 tray 构造实参内', restartCbAt >= 0 && restartCbAt > trayAt, `${trayAt} < ${restartCbAt}`],
  ['resolveDesktopQuitPrompt 定义在模块级且先于 safeRestart', resolveAt > 0 && safeAt > resolveAt, `${resolveAt} < ${safeAt}`],
  ['quitting 变量可用', quittingAt > 0, quittingAt],
  ['走官方 inspectQuit 判断', at('backend.host.inspectQuit()') > 0, ''],
  ['有 app.relaunch + quitWithoutConfirmation', at('app.relaunch();') > 0 && at('quitWithoutConfirmation();') > 0, ''],
  ['确认框文案用官方 messages', at('message: messages.restartApplication + " " + messages.aboutProduct') > 0, '']
]

let broken = 0
for (const [label, ok, extra] of checks) {
  if (!ok) broken += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : '  ' + extra}`)
}
console.log(broken === 0 ? 'ALL GOOD' : `BROKEN: ${broken}`)
console.log(`file: ${target} (${fs.statSync(target).size} bytes, ${os.platform()})`)
process.exit(broken === 0 ? 0 : 1)
