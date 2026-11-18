/**
 * dsh-safe-restart — Host 半部
 *
 * 干的事：把桌面端 lib/main.js 打上一个小补丁，给托盘菜单加「重启 DeepSeek Harness」。
 * 点它有任务在跑时先弹 Electron 原生确认框（标题与按钮都是「重启」），
 * 判断条件与官方托盘「退出 DeepSeek Harness」完全同源。
 *
 * 为什么非要改 main.js：DSH 插件跑在独立 Node 子进程里，拿不到 electron 的
 * Tray / dialog，托盘和原生框都只能由主进程提供入口。
 * 代价是客户端升级会把 main.js 换掉——所以本插件每次启动都检查并自动重打。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { MARK, apply as applyPatch, revert as revertPatch, status as patchStatus } from './patch.js'

const name = 'dsh-safe-restart'
const inject = ['webServer']

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0' }
  catch { return '0.0.0' }
})()

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
const DATA_DIR = process.env.DSH_SAFE_RESTART_DIR || path.join(LOCAL, 'dsh-safe-restart')
const LOG_FILE = path.join(DATA_DIR, 'safe-restart.log')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const ROUTE = '/safe-restart'
const BACKUP_SUFFIX = '.bak-dsh-safe-restart'

/** 本次进程里改过 main.js 就需要重启一次才生效（主进程代码已经在内存里了）。 */
const runtime = { changed: false, lastError: '', lastAction: '' }

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg + '\n'
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(LOG_FILE, line) } catch {}
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
  } catch {}
}

function logTail(lines) {
  try { return fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\r?\n/).slice(-(lines || 25)) } catch { return [] }
}

/** 目录里有没有 dsh-desktop 的 package.json */
function looksLikeApp(dir) {
  const pkg = path.join(dir, 'package.json')
  if (!fs.existsSync(pkg) || !fs.existsSync(path.join(dir, 'lib', 'main.js'))) return false
  const json = readJson(pkg)
  if (json === null) return false
  return typeof json.name === 'string' && json.name.indexOf('dsh-desktop') !== -1
}

/**
 * 找 <install>/resources/app：
 *  1. 环境变量 DSH_DESKTOP_APP_DIR（作者/高级用户可手动指定）
 *  2. 从 process.execPath 往上逐层找（宿主 node 就在 app/runtime/... 下面）
 *  3. 常见安装位置兜底
 */
export function findAppDir() {
  const fromEnv = process.env.DSH_DESKTOP_APP_DIR
  if (fromEnv && looksLikeApp(fromEnv)) return fromEnv

  let dir = path.dirname(process.execPath)
  for (let i = 0; i < 8; i += 1) {
    if (looksLikeApp(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const candidates = []
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
  for (const root of roots) {
    if (!root) continue
    candidates.push(path.join(root, 'DeepSeek Harness', 'resources', 'app'))
  }
  candidates.push('D:\\Software\\DeepSeek Harness\\resources\\app')
  for (const dir2 of candidates) {
    if (looksLikeApp(dir2)) return dir2
  }
  return ''
}

function mainPathOf(appDir) {
  return appDir ? path.join(appDir, 'lib', 'main.js') : ''
}

function asarPathOf(appDir) {
  if (!appDir) return ''
  const resources = path.dirname(appDir)
  return path.join(resources, 'app.asar')
}

function readSource(mainPath) {
  return fs.readFileSync(mainPath, 'utf8')
}

/** 写完 main.js 立刻用 node --check 验一遍语法，坏掉就还原，绝不留下坏文件。 */
function writeSource(mainPath, source) {
  // 语法预检必须用 .mjs 后缀：node --check 对未知扩展名直接报 ERR_UNKNOWN_FILE_EXTENSION
  const checkFile = path.join(os.tmpdir(), 'dsh-safe-restart-check-' + process.pid + '-' + Date.now() + '.mjs')
  fs.writeFileSync(checkFile, source, 'utf8')
  try {
    execFileSync(process.execPath, ['--check', checkFile], { stdio: 'ignore', timeout: 30000 })
  } catch (err) {
    throw new Error('生成的 main.js 语法检查失败，已放弃写入：' + String((err && err.message) || err))
  } finally {
    try { fs.rmSync(checkFile, { force: true }) } catch {}
  }
  const tmp = mainPath + '.dsh-safe-restart.tmp'
  fs.writeFileSync(tmp, source, 'utf8')
  fs.renameSync(tmp, mainPath)
}

function backupPathOf(mainPath) {
  return mainPath + BACKUP_SUFFIX
}

function ensureBackup(mainPath, source) {
  const bak = backupPathOf(mainPath)
  if (!fs.existsSync(bak)) {
    fs.writeFileSync(bak, source, 'utf8')
    log('backup: ' + bak)
  }
  return bak
}

function snapshot() {
  const appDir = findAppDir()
  const mainPath = mainPathOf(appDir)
  const asar = asarPathOf(appDir)
  let state = 'unknown'
  let exists = false
  let size = 0
  let writable = false
  if (mainPath && fs.existsSync(mainPath)) {
    exists = true
    try {
      const src = readSource(mainPath)
      size = Buffer.byteLength(src, 'utf8')
      state = patchStatus(src)
    } catch (err) {
      log('read failed: ' + String((err && err.message) || err))
    }
    try { fs.accessSync(mainPath, fs.constants.W_OK); writable = true } catch { writable = false }
  }
  return {
    ok: true,
    version: VERSION,
    platform: process.platform,
    appDir,
    mainPath,
    exists,
    size,
    state,
    patched: state === 'patched',
    writable,
    asar: asar && fs.existsSync(asar) ? asar : '',
    needsRestart: runtime.changed,
    lastAction: runtime.lastAction,
    lastError: runtime.lastError,
    backup: mainPath ? backupPathOf(mainPath) : '',
    backupExists: mainPath ? fs.existsSync(backupPathOf(mainPath)) : false,
    dataDir: DATA_DIR,
    mark: MARK,
    log: logTail(25)
  }
}

function doApply() {
  const appDir = findAppDir()
  if (!appDir) throw new Error('找不到 DeepSeek Harness 的 resources/app 目录；可以在插件里设置 DSH_DESKTOP_APP_DIR 环境变量指定')
  const mainPath = mainPathOf(appDir)
  if (!fs.existsSync(mainPath)) {
    const asar = asarPathOf(appDir)
    if (asar && fs.existsSync(asar)) throw new Error('当前客户端是 app.asar 打包态（' + asar + '），需要先解包才能打补丁')
    throw new Error('找不到 lib/main.js：' + mainPath)
  }
  if (process.platform !== 'win32') throw new Error('目前只支持 Windows 桌面端（托盘菜单）')
  const src = readSource(mainPath)
  const result = applyPatch(src)
  if (!result.changed) {
    runtime.lastAction = 'apply-noop'
    log('apply: already patched')
    return snapshot()
  }
  ensureBackup(mainPath, src)
  writeSource(mainPath, result.source)
  runtime.changed = true
  runtime.lastAction = 'applied'
  runtime.lastError = ''
  log('apply: patched ' + mainPath)
  return snapshot()
}

function doRevert() {
  const appDir = findAppDir()
  const mainPath = mainPathOf(appDir)
  if (!mainPath || !fs.existsSync(mainPath)) throw new Error('找不到 lib/main.js')
  const src = readSource(mainPath)
  const result = revertPatch(src)
  if (!result.changed) {
    runtime.lastAction = 'revert-noop'
    log('revert: already clean')
    return snapshot()
  }
  writeSource(mainPath, result.source)
  runtime.changed = true
  runtime.lastAction = 'reverted'
  runtime.lastError = ''
  log('revert: clean ' + mainPath)
  return snapshot()
}

function sendJson(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length)
  })
  res.end(body)
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { req.destroy(); resolve(''); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

/** 启动时自愈：补丁丢了（客户端升级）就自动重打。失败只记日志，不影响 DSH 启动。 */
function ensurePatchedOnBoot() {
  try {
    const appDir = findAppDir()
    const mainPath = mainPathOf(appDir)
    if (!mainPath || !fs.existsSync(mainPath)) {
      const asar = asarPathOf(appDir)
      log('boot: main.js not found' + (asar && fs.existsSync(asar) ? '（asar 打包态）' : ''))
      return
    }
    const state = patchStatus(readSource(mainPath))
    if (state === 'patched') { log('boot: already patched'); return }
    if (state !== 'clean') { log('boot: unknown main.js layout, skip'); return }
    doApply()
    log('boot: re-applied after client update — 重启一次 DSH 生效')
  } catch (err) {
    runtime.lastError = String((err && err.message) || err)
    log('boot failed: ' + runtime.lastError)
  }
}

function apply(ctx) {
  ensurePatchedOnBoot()
  writeJson(STATE_FILE, { version: VERSION, lastBoot: new Date().toISOString(), appDir: findAppDir() })

  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('dsh-safe-restart: webServer unavailable, settings page disabled')
    return
  }

  const disposers = []
  const route = (p, handler) => {
    try { disposers.push(webServer.register({ kind: 'exact', path: p, handler })) } catch (err) { log('route failed: ' + err.message) }
  }

  route(ROUTE + '/state', (req, res) => {
    if ((req.method || 'GET').toUpperCase() !== 'GET') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
    try { sendJson(res, 200, snapshot()) } catch (err) { sendJson(res, 500, { ok: false, error: String((err && err.message) || err) }) }
  })

  route(ROUTE + '/action', async (req, res) => {
    if ((req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
    const text = await readBody(req)
    let payload = {}
    try { payload = text ? JSON.parse(text) : {} } catch { sendJson(res, 400, { ok: false, error: 'invalid json' }); return }
    const action = payload && payload.action
    try {
      if (action === 'apply') { sendJson(res, 200, doApply()); return }
      if (action === 'revert') { sendJson(res, 200, doRevert()); return }
      if (action === 'recheck') {
        runtime.lastAction = 'recheck'
        if (runtime.changed) runtime.changed = false
        sendJson(res, 200, snapshot()); return
      }
      sendJson(res, 400, { ok: false, error: 'unknown action' }); return
    } catch (err) {
      runtime.lastError = String((err && err.message) || err)
      log('action ' + String(action) + ' failed: ' + runtime.lastError)
      sendJson(res, 500, Object.assign({ ok: false, error: runtime.lastError }, snapshot()))
    }
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const d of disposers.splice(0)) { try { if (typeof d === 'function') d() } catch {} }
    })
  }
}

export { name, inject, apply }
