const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, powerSaveBlocker, Menu } = require('electron')

// Disable Chromium's background media suspend — must be set before app is ready
app.commandLine.appendSwitch('disable-background-media-suspend')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const { pathToFileURL } = require('url')
const http = require('http')
let mediaServer = null

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv']
const VIDEO_EXTENSIONS_RE = new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i')

function findInDir(dir, name) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === name) return full
      if (entry.isDirectory()) { const r = findInDir(full, name); if (r) return r }
    }
  } catch {}
  return null
}

function startMediaServer(folderPath) {
  if (mediaServer) mediaServer.close()
  return new Promise(resolve => {
    mediaServer = http.createServer((req, res) => {
      const filename = decodeURIComponent(req.url.slice(1))
      let filePath = path.join(folderPath, filename)
      if (!fs.existsSync(filePath)) {
        filePath = findInDir(folderPath, path.basename(filename)) || filePath
      }
      // Only send an error status if we haven't already started the response;
      // once headers are out, just tear the socket down — never throw.
      const fail = (code) => { if (!res.headersSent) { res.writeHead(code); res.end('Not available') } else { res.destroy() } }

      let stat
      try { stat = fs.statSync(filePath) } catch { return fail(404) }
      // Missing, non-file, or empty/truncated (e.g. a failed download) → 404, not a crash.
      if (!stat.isFile() || stat.size === 0) return fail(404)

      const ext = path.extname(filePath).slice(1).toLowerCase()
      const mime = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] || 'video/mp4'
      const range = req.headers.range

      let start = 0, end = stat.size - 1, status = 200
      let headers = { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' }
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        start = m && m[1] ? parseInt(m[1], 10) : 0
        end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return
        }
        end = Math.min(end, stat.size - 1)
        status = 206
        headers = { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime }
      }

      res.writeHead(status, headers)
      const stream = fs.createReadStream(filePath, { start, end })
      stream.on('error', () => res.destroy()) // read error mid-stream → tear down, don't crash
      stream.pipe(res)
    })
    mediaServer.listen(0, '127.0.0.1', () => resolve(mediaServer.address().port))
  })
}

// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const CONFIG_DIR = path.join(os.homedir(), '.scenecaster')
const LICENSE_FILE = path.join(CONFIG_DIR, 'license.enc')
const VIDEOS_DIR = path.join(CONFIG_DIR, 'videos')

function ensureDirs() {
  [CONFIG_DIR, VIDEOS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  })
}

function getMachineId() {
  const raw = `${os.hostname()}::${os.platform()}::${os.arch()}::${os.cpus()[0]?.model || 'cpu'}`
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

// ES256 (asymmetric): the only scheme used for licenses now — the old HS256
// shared-secret scheme (embedded in this file in plaintext, which is exactly
// why it was forgeable) is gone for good; no HS256-signed keys remain
// outstanding (confirmed 2026-07-10). This is the PUBLIC half of the key pair
// — safe to ship inside the app, since it can only verify signatures, never
// create them. The private half lives solely in Render's LICENSE_PRIVATE_KEY
// env var and never touches this codebase.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9twH5AR6nmEoMgS9NNbD0AVk52xJ
cxmI06svXfI296umOx2Qa2suCGLAkKiGwu0Z+zNSNQlQHQfxsurWHcZ3vQ==
-----END PUBLIC KEY-----`

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return Buffer.from(str, 'base64')
}

function verifyJWT(token) {
  try {
    const parts = token.trim().split('.')
    if (parts.length !== 3) return { valid: false, error: 'Malformed key' }
    const [headerB64, payloadB64, sigB64] = parts
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'))
    const signedInput = `${headerB64}.${payloadB64}`
    const sig = base64UrlDecode(sigB64)

    if (header.alg !== 'ES256') return { valid: false, error: 'Unrecognized key signing method' }
    const sigValid = crypto.verify('sha256', Buffer.from(signedInput), { key: LICENSE_PUBLIC_KEY, dsaEncoding: 'ieee-p1363' }, sig)
    if (!sigValid) return { valid: false, error: 'Invalid key — signature mismatch' }
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
    return { valid: true, payload }
  } catch (e) {
    return { valid: false, error: 'Key could not be parsed' }
  }
}

function showNameFromPackId(p) {
  const id = Array.isArray(p) ? p[0] : p
  if (!id) return 'this production'
  // Full show pack: "frozen-adult" → "Frozen (Adult)", "shrek-jr" → "Shrek (Jr.)"
  const match = id.match(/^(.+)-(adult|jr|full)$/i)
  if (match) {
    const show = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    if (match[2].toLowerCase() === 'jr') return `${show} Jr.`
    return show
  }
  // À la carte: use filename prefix as show name
  return id.split('_')[0].replace(/\b\w/g, c => c.toUpperCase())
}

function checkLicense() {
  // Dev bypass: skip license check when running unpackaged (npm start / electron .)
  if (!app.isPackaged) {
    return { status: 'active', payload: { p: 'shrek-adult' }, daysRemaining: 365 }
  }
  ensureDirs()
  if (!fs.existsSync(LICENSE_FILE)) return { status: 'none' }
  try {
    const stored = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'))
    const { valid, payload, error } = verifyJWT(stored.token)
    if (!valid) return { status: 'invalid', error }
    // Normalize old token field names → new short names
    if (!payload.p && payload.packId) payload.p = payload.packId
    if (!payload.e && payload.expiryDate) payload.e = payload.expiryDate
    const machineId = getMachineId()
    if (payload.mid && payload.mid !== machineId) {
      return { status: 'invalid', error: 'This license is registered to a different computer.' }
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const expiry = new Date(payload.e)
    expiry.setHours(0, 0, 0, 0)
    if (today > expiry) {
      const deletedCount = deleteShowFiles()
      return { status: 'expired', showName: showNameFromPackId(payload.p), expiryDate: payload.e, storeUrl: 'https://payhip.com/ellusionMEDIA', filesDeleted: deletedCount > 0 }
    }
    return { status: 'active', payload, daysRemaining: Math.ceil((expiry - today) / (1000 * 60 * 60 * 24)) }
  } catch {
    return { status: 'invalid', error: 'License file is corrupted.' }
  }
}

function activateLicense(token) {
  const { valid, payload, error } = verifyJWT(token)
  if (!valid) return { success: false, error }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const expiry = new Date(payload.e); expiry.setHours(0, 0, 0, 0)
  if (today > expiry) return { success: false, error: 'This license key has already expired.' }
  // Purchase tokens contain pd (purchase date) — needs closing date before storing
  if (payload.pd) {
    return { success: true, payload, needsDatePicker: true }
  }
  // Already-finalized token — store immediately
  const machineId = getMachineId()
  ensureDirs()
  fs.writeFileSync(LICENSE_FILE, JSON.stringify({ token, machineId, activatedAt: new Date().toISOString() }))
  return { success: true, payload }
}

const BACKEND_URL = 'https://showrunner-backend-zoen.onrender.com'

async function finalizeLicense({ token, closingDate }) {
  try {
    const resp = await fetch(`${BACKEND_URL}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, closingDate })
    })
    const data = await resp.json()
    if (!resp.ok) return { success: false, error: data.error || 'Activation failed' }
    // Verify the returned JWT before storing
    const { valid, payload, error } = verifyJWT(data.token)
    if (!valid) return { success: false, error: 'Server returned an invalid license.' }
    const machineId = getMachineId()
    ensureDirs()
    fs.writeFileSync(LICENSE_FILE, JSON.stringify({ token: data.token, machineId, activatedAt: new Date().toISOString() }))
    return { success: true, payload, capped: data.capped, expiryDate: data.expiryDate }
  } catch (e) {
    return { success: false, error: 'Could not reach activation server. Check your internet connection.' }
  }
}

function deleteShowFiles() {
  ensureDirs()
  let count = 0
  try {
    const files = fs.readdirSync(VIDEOS_DIR).filter(f => VIDEO_EXTENSIONS_RE.test(f))
    for (const f of files) {
      fs.unlinkSync(path.join(VIDEOS_DIR, f))
      count++
    }
  } catch (e) {
    console.error('Error deleting show files:', e)
  }
  return count
}

// ── Custom layout (Director's Custom Mode foundation) ────────────────────────
// A per-show overlay stored SEPARATELY from the master cues cache, so the master
// (cues-{showId}.json) is never mutated. Holds the scene order, sparse per-scene
// overrides, uploaded/duplicated scenes, blackouts, and skip flags.
function customLayoutPath(showId) {
  return path.join(CONFIG_DIR, `custom-layout-${showId}.json`)
}

function emptyLayout(showId) {
  return { version: 1, showId, order: [], overrides: {}, customScenes: {}, blackouts: {} }
}

function getCustomLayout(showId) {
  if (!showId) return null
  ensureDirs()
  const p = customLayoutPath(showId)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) }
  catch { return null } // a corrupted overlay must never crash the show
}

function saveCustomLayout(showId, layout) {
  ensureDirs()
  try {
    const data = layout || emptyLayout(showId)
    data.version = 1
    data.showId = showId
    fs.writeFileSync(customLayoutPath(showId), JSON.stringify(data, null, 2))
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

function resetCustomLayout(showId, mode) {
  // Only 'full' touches disk: delete the overlay entirely. The master cues cache
  // was never mutated, so deletion fully restores defaults AND removes any
  // customer-added/duplicated scenes. 'position' is a renderer-only concern.
  try {
    if (mode === 'full') {
      const p = customLayoutPath(showId)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    return { success: true }
  } catch (e) { return { success: false, error: e.message } }
}

function registerIPC() {
  // Sandboxed preload's polyfilled `require('url')` doesn't include
  // pathToFileURL, so this runs here instead, synchronously (renderer code
  // that needs it isn't async).
  ipcMain.on('to-file-url-sync', (event, filePath) => {
    event.returnValue = pathToFileURL(filePath).href
  })
  ipcMain.handle('check-license', () => checkLicense())
  ipcMain.handle('activate-license', (_, token) => activateLicense(token))
  ipcMain.handle('finalize-license', (_, opts) => finalizeLicense(opts))
  ipcMain.handle('send-to-led', (_, data) => {
    if (!ledWindow) return
    ledWindow.webContents.send('led-command', data)
  })
  ipcMain.handle('open-led-window', () => {
    // Always destroy and recreate so display detection runs fresh each time
    if (ledWindow && !ledWindow.isDestroyed()) {
      ledWindow.destroy()
    }
    createLedWindow()
    return { success: true }
  })
  ipcMain.handle('import-video', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Video files', extensions: VIDEO_EXTENSIONS }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled) return []
    return filePaths.map(p => {
      const filename = path.basename(p)
      const dest = path.join(VIDEOS_DIR, filename)
      fs.copyFileSync(p, dest)
      return { name: filename.replace(/\.[^.]+$/, ''), filename, path: dest }
    })
  })
  ipcMain.handle('import-still', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (canceled) return []
    return filePaths.map(p => {
      const filename = path.basename(p)
      const dest = path.join(VIDEOS_DIR, filename)
      fs.copyFileSync(p, dest)
      return { name: filename.replace(/\.[^.]+$/, ''), filename, path: dest }
    })
  })
  ipcMain.handle('open-url', (_, url) => shell.openExternal(url))
  ipcMain.handle('export-cue-sheet', async (_, html) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: 'SceneCaster-Cue-Sheet.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { success: false, canceled: true }
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
      fs.writeFileSync(filePath, pdf)
      win.destroy()
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  // Trigger/lighting edits now write into the custom-layout overlay keyed by the
  // scene's STABLE id (master scene.id, or a custom scene's own id) — never by
  // array position, and never mutating the master cues cache. This also fixes a
  // pre-existing bug where these wrote to folderPath's cues.json, which for real
  // bundled shows is ~/.scenecaster/videos (has no cues.json) → silent failure.
  ipcMain.handle('save-backdrop-trigger', (_, { showId, sceneRef, trigger }) => {
    if (!showId || !sceneRef) return { success: false, error: 'Missing showId or sceneRef' }
    const layout = getCustomLayout(showId) || emptyLayout(showId)
    if (sceneRef.kind === 'master') {
      layout.overrides[sceneRef.sceneId] = layout.overrides[sceneRef.sceneId] || {}
      layout.overrides[sceneRef.sceneId].backdrop = layout.overrides[sceneRef.sceneId].backdrop || {}
      layout.overrides[sceneRef.sceneId].backdrop.trigger = trigger
    } else if (sceneRef.kind === 'custom') {
      const cs = layout.customScenes[sceneRef.id]
      if (!cs) return { success: false, error: 'Custom scene not found' }
      cs.backdrop = cs.backdrop || {}
      cs.backdrop.trigger = trigger
    } else {
      return { success: false, error: 'Unsupported sceneRef kind' }
    }
    return saveCustomLayout(showId, layout)
  })

  ipcMain.handle('save-lighting-cue', (_, { showId, sceneRef, cues: newCues }) => {
    if (!showId || !sceneRef) return { success: false, error: 'Missing showId or sceneRef' }
    const layout = getCustomLayout(showId) || emptyLayout(showId)
    if (sceneRef.kind === 'master') {
      layout.overrides[sceneRef.sceneId] = layout.overrides[sceneRef.sceneId] || {}
      layout.overrides[sceneRef.sceneId].lighting = { cues: newCues || [] }
    } else if (sceneRef.kind === 'custom') {
      const cs = layout.customScenes[sceneRef.id]
      if (!cs) return { success: false, error: 'Custom scene not found' }
      cs.lighting = { cues: newCues || [] }
    } else {
      return { success: false, error: 'Unsupported sceneRef kind' }
    }
    return saveCustomLayout(showId, layout)
  })

  ipcMain.handle('get-custom-layout', (_, { showId }) => getCustomLayout(showId))
  ipcMain.handle('save-custom-layout', (_, { showId, layout }) => saveCustomLayout(showId, layout))
  ipcMain.handle('reset-custom-layout', (_, { showId, mode }) => resetCustomLayout(showId, mode))

  ipcMain.handle('start-media-server', (_, folderPath) => startMediaServer(folderPath))

  const COLOR_SETTINGS_FILE = path.join(CONFIG_DIR, 'color-settings.json')
  const APP_SETTINGS_FILE = path.join(CONFIG_DIR, 'app-settings.json')
  ipcMain.handle('get-app-settings', () => {
    ensureDirs()
    try {
      if (!fs.existsSync(APP_SETTINGS_FILE)) return {}
      return JSON.parse(fs.readFileSync(APP_SETTINGS_FILE, 'utf8'))
    } catch { return {} }
  })
  ipcMain.handle('save-app-settings', (_, data) => {
    ensureDirs()
    try { fs.writeFileSync(APP_SETTINGS_FILE, JSON.stringify(data, null, 2)); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('load-color-settings', () => {
    ensureDirs()
    try {
      if (!fs.existsSync(COLOR_SETTINGS_FILE)) return {}
      return JSON.parse(fs.readFileSync(COLOR_SETTINGS_FILE, 'utf8'))
    } catch { return {} }
  })
  ipcMain.handle('save-color-settings', (_, data) => {
    ensureDirs()
    try { fs.writeFileSync(COLOR_SETTINGS_FILE, JSON.stringify(data, null, 2)); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Download system ────────────────────────────────────────────────────────
  const MANIFEST_URL = 'https://showrunner-backend-zoen.onrender.com/manifest'

  ipcMain.handle('fetch-manifest', async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const resp = await fetch(MANIFEST_URL, { signal: controller.signal })
      clearTimeout(timer)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.json()
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('get-download-status', () => {
    ensureDirs()
    const existing = fs.existsSync(VIDEOS_DIR)
      ? fs.readdirSync(VIDEOS_DIR).filter(f => VIDEO_EXTENSIONS_RE.test(f))
      : []
    return { videosDir: VIDEOS_DIR, existing }
  })

  ipcMain.handle('download-file', async (event, { fileId, filename }) => {
    ensureDirs()
    const url = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`
    const destPath = path.join(VIDEOS_DIR, filename)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const total = parseInt(response.headers.get('content-length') || '0', 10)
      let downloaded = 0
      const writer = fs.createWriteStream(destPath)
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        writer.write(Buffer.from(value))
        downloaded += value.length
        if (total > 0) {
          event.sender.send('download-progress', {
            filename, percent: Math.round(downloaded / total * 100), downloaded, total
          })
        }
      }
      await new Promise(resolve => writer.end(resolve))
      return { success: true }
    } catch (e) {
      try { fs.unlinkSync(destPath) } catch {}
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('load-bundled-show', async (_, packId) => {
    ensureDirs()
    const ids = Array.isArray(packId) ? packId : [packId]

    // Derive showId from pack IDs — works for any show, not just Shrek
    let showId
    const fullPack = ids.find(id => id.endsWith('-adult') || id.endsWith('-jr') || id.endsWith('-full'))
    if (fullPack) {
      // Full show pack: use directly; normalize legacy 'shrek-full' → 'shrek-adult'
      showId = fullPack.endsWith('-full') ? 'shrek-adult' : fullPack
    } else {
      // À la carte scene filename (e.g. "Frozen_Ice_Palace", "Shrek_Open.JR",
      // "Birthday_Party"). Look up which show pack actually contains this
      // scene rather than guessing from the filename prefix — that guess
      // only works when the scene name starts with the show name (true for
      // Shrek, not true for most Frozen/Matilda scenes).
      const isJr = ids.some(id => id.endsWith('.JR') || id.endsWith('_JR'))
      try {
        const manifestResp = await fetch(MANIFEST_URL)
        if (manifestResp.ok) {
          const manifest = await manifestResp.json()
          const packs = Object.entries(manifest.packs || {})
          const matches = packs.filter(([, members]) => ids.some(sceneId => members.includes(sceneId)))
          // A scene id legitimately matches both the -adult and -jr pack of the
          // SAME show — that's normal. It should never match packs belonging to
          // two DIFFERENT shows; if it does, the manifest naming rule was
          // violated somewhere upstream. Don't silently guess which show the
          // customer actually bought — refuse and surface it instead.
          const distinctShows = new Set(matches.map(([id]) => id.replace(/-(adult|jr|full)$/i, '')))
          if (distinctShows.size > 1) {
            return { success: false, error: 'This license could not be resolved to a single show — please contact support.' }
          }
          const preferredSuffix = isJr ? '-jr' : '-adult'
          const match = matches.find(([id]) => id.endsWith(preferredSuffix)) || matches[0]
          if (match) showId = match[0]
        }
      } catch (e) {
        console.log('Could not resolve show from manifest, falling back to filename guess:', e.message)
      }
      if (!showId) {
        // Last-resort fallback if the manifest lookup failed (e.g. offline)
        const prefix = ids[0].split('_')[0].toLowerCase()
        showId = `${prefix}-${isJr ? 'jr' : 'adult'}`
      }
    }

    const cachePath = path.join(CONFIG_DIR, `cues-${showId}.json`)

    // Try to fetch fresh cues from server
    try {
      const res = await fetch(`https://showrunner-backend-zoen.onrender.com/cues/${showId}`)
      if (res.ok) {
        const text = await res.text()
        fs.writeFileSync(cachePath, text)
        return { success: true, cues: JSON.parse(text), folderPath: VIDEOS_DIR, showId }
      }
    } catch (e) {
      console.log('Could not fetch cues from server, falling back to cache:', e.message)
    }

    // Fall back to cached copy
    if (fs.existsSync(cachePath)) {
      try {
        const cues = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
        return { success: true, cues, folderPath: VIDEOS_DIR, showId }
      } catch (e) {
        return { success: false, error: 'Cached show data is corrupted.' }
      }
    }

    return { success: false, error: 'Show data not available. Please check your internet connection.' }
  })
}

let mainWindow
let ledWindow
let isQuitting = false

function buildMenu() {
  const template = [
    {
      label: 'SceneCaster',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Re-enter License Key…',
          click: () => {
            if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-activate')
            }
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-undo') } },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-redo') } },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createLedWindow() {
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const allDisplays = screen.getAllDisplays()
  const externalDisplay = allDisplays.find(d => d.id !== primaryDisplay.id)

  if (externalDisplay) {
    const { x, y, width, height } = externalDisplay.bounds
    ledWindow = new BrowserWindow({
      x, y, width, height,
      frame: false, alwaysOnTop: true, backgroundColor: '#000000', skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, webSecurity: false, backgroundThrottling: false }
    })
    ledWindow.loadFile(path.join(__dirname, 'renderer', 'led.html'))
    ledWindow.setAlwaysOnTop(true, 'screen-saver')
    ledWindow.webContents.once('did-finish-load', () => {
      // Delay gives macOS time to settle the window on the external display before
      // requesting fullscreen — improves reliability across different display setups
      setTimeout(() => {
        if (ledWindow && !ledWindow.isDestroyed()) ledWindow.setFullScreen(true)
      }, 500)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('led-window-ready')
      }
    })
  } else {
    // No external display — create a moveable window on primary with a notice
    ledWindow = new BrowserWindow({
      width: 854, height: 480,
      frame: true, backgroundColor: '#000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, webSecurity: false, backgroundThrottling: false }
    })
    ledWindow.loadFile(path.join(__dirname, 'renderer', 'led.html'))
    ledWindow.webContents.once('did-finish-load', () => {
      ledWindow.webContents.send('no-external-display')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('led-window-ready')
      }
    })
  }
}

function createWindows() {
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  // Open the operator window centered on the MAIN display, so it never lands on a
  // secondary or failing screen where you can't reach it.
  const wa = primaryDisplay.workArea
  const winW = Math.min(1600, wa.width), winH = Math.min(1000, wa.height)
  mainWindow = new BrowserWindow({
    x: wa.x + Math.round((wa.width - winW) / 2),
    y: wa.y + Math.round((wa.height - winH) / 2),
    width: winW, height: winH, minWidth: 900, minHeight: 600,
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, webSecurity: false, backgroundThrottling: false }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Auto-open the fullscreen LED output window ONLY in the packaged (customer)
  // app. In dev (npm start) skip it: a frameless, always-on-top, fullscreen
  // window on a secondary/misconfigured display can cover everything and trap
  // the mouse/keyboard. Use the "Open External Screen" button to open it manually
  // during dev when you actually want to test projector output.
  if (app.isPackaged) {
    // macOS doesn't always have display enumeration fully settled the instant
    // app.whenReady() fires — especially right after boot or waking from sleep
    // — so every trigger below waits a moment before trusting
    // screen.getAllDisplays() and recreating the LED window.
    //
    // Debounced through one shared timer rather than each trigger scheduling
    // its own independent setTimeout: startup, display-added, and
    // display-metrics-changed can all fire within milliseconds of each other
    // (e.g. a display settling right as the app launches), and without this,
    // two of them could each schedule their own createLedWindow() and end up
    // with two overlapping LED windows instead of one clean recreation.
    const DISPLAY_SETTLE_DELAY_MS = 500
    let ledWindowRefreshTimer = null
    function scheduleLedWindowRefresh(reason) {
      console.log(`[display] ${reason} — scheduling LED window refresh in ${DISPLAY_SETTLE_DELAY_MS}ms. Displays:`, screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds })))
      if (ledWindowRefreshTimer) clearTimeout(ledWindowRefreshTimer)
      ledWindowRefreshTimer = setTimeout(() => {
        ledWindowRefreshTimer = null
        if (ledWindow && !ledWindow.isDestroyed()) ledWindow.destroy()
        if (screen.getAllDisplays().find(d => d.id !== primaryDisplay.id)) {
          createLedWindow()
        }
      }, DISPLAY_SETTLE_DELAY_MS)
    }

    // Startup: don't trust getAllDisplays() synchronously — go through the
    // same settle-and-check path as every other trigger.
    scheduleLedWindowRefresh('startup')

    // A genuinely new display being plugged in.
    screen.on('display-added', (event, newDisplay) => {
      console.log('[display] display-added event:', { id: newDisplay.id, bounds: newDisplay.bounds })
      scheduleLedWindowRefresh('display-added')
    })

    // An already-connected display's arrangement/resolution/rotation changing
    // (e.g. someone touching System Settings → Displays) fires THIS, not
    // display-added — display-added is only for a new display being plugged
    // in. Without this listener, the LED window could end up on stale bounds
    // (or never get created at all if it missed the startup window) with no
    // way to recover short of a real unplug/replug.
    screen.on('display-metrics-changed', (event, display, changedMetrics) => {
      console.log('[display] display-metrics-changed event:', { id: display.id, bounds: display.bounds, changedMetrics })
      scheduleLedWindowRefresh('display-metrics-changed')
    })

    // Not a fix for this bug, but logging removal is cheap and closes a real
    // gap: previously nothing observed a display disconnecting at all.
    screen.on('display-removed', (event, oldDisplay) => {
      console.log('[display] display-removed event:', { id: oldDisplay.id, bounds: oldDisplay.bounds })
    })
  }

  // Heartbeat — keeps video alive when macOS suspends renderer processes
  setInterval(() => {
    if (ledWindow && !ledWindow.isDestroyed()) {
      ledWindow.webContents.send('keep-alive')
    }
  }, 10000)
}

app.whenReady().then(() => {
  powerSaveBlocker.start('prevent-app-suspension')
  powerSaveBlocker.start('prevent-display-sleep')
  buildMenu()
  // Serve local media files via media:// — uses pathToFileURL to handle spaces
  protocol.handle('media', (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname)
    return net.fetch(pathToFileURL(filePath).href)
  })
  registerIPC()
  createWindows()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
})

app.on('before-quit', (e) => {
  if (!isQuitting && ledWindow && !ledWindow.isDestroyed()) {
    e.preventDefault()
    isQuitting = true
    ledWindow.webContents.send('led-command', { type: 'black', dissolve: 0 })
    setTimeout(() => app.quit(), 200)
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
