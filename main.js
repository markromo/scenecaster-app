const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, powerSaveBlocker, Menu } = require('electron')

// Disable Chromium's background media suspend — must be set before app is ready
app.commandLine.appendSwitch('disable-background-media-suspend')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
const { pathToFileURL } = require('url')
const http = require('http')
let mediaServer = null

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
      try {
        const stat = fs.statSync(filePath)
        const range = req.headers.range
        const ext = path.extname(filePath).slice(1).toLowerCase()
        const mime = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }[ext] || 'video/mp4'
        if (range) {
          const [s, e] = range.replace(/bytes=/, '').split('-')
          const start = parseInt(s, 10)
          const end = e ? parseInt(e, 10) : stat.size - 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': mime,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' })
          fs.createReadStream(filePath).pipe(res)
        }
      } catch { res.writeHead(404); res.end('Not found') }
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

const LICENSE_SECRET = '625e52515fb8f1ed9fcf73c801c9fa2c67c0c2f1fed30384dde29d378a96c4b3'

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
    const expectedSig = crypto
      .createHmac('sha256', LICENSE_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')
    if (expectedSig !== sigB64) return { valid: false, error: 'Invalid key — signature mismatch' }
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'))
    return { valid: true, payload }
  } catch (e) {
    return { valid: false, error: 'Key could not be parsed' }
  }
}

function showNameFromPackId(p) {
  const id = Array.isArray(p) ? p[0] : p
  if (id === 'shrek-jr') return 'Shrek the Musical Jr.'
  return 'Shrek the Musical'
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
    return { success: true, payload }
  } catch (e) {
    return { success: false, error: 'Could not reach activation server. Check your internet connection.' }
  }
}

function deleteShowFiles() {
  ensureDirs()
  let count = 0
  try {
    const files = fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|mov|webm|mkv)$/i.test(f))
    for (const f of files) {
      fs.unlinkSync(path.join(VIDEOS_DIR, f))
      count++
    }
  } catch (e) {
    console.error('Error deleting show files:', e)
  }
  return count
}

function getLocalVideos() {
  ensureDirs()
  return fs.readdirSync(VIDEOS_DIR)
    .filter(f => /\.(mp4|mov|webm|mkv)$/i.test(f))
    .map(f => ({ name: f.replace(/\.[^.]+$/, ''), filename: f, path: path.join(VIDEOS_DIR, f), size: fs.statSync(path.join(VIDEOS_DIR, f)).size }))
}

function loadShowFolder(folderPath) {
  const cuesPath = path.join(folderPath, 'cues.json')
  if (!fs.existsSync(cuesPath)) return { success: false, error: 'No cues.json found in folder' }
  const cues = JSON.parse(fs.readFileSync(cuesPath, 'utf8'))
  return { success: true, cues, folderPath }
}

function registerIPC() {
  ipcMain.handle('check-license', () => checkLicense())
  ipcMain.handle('activate-license', (_, token) => activateLicense(token))
  ipcMain.handle('finalize-license', (_, opts) => finalizeLicense(opts))
  ipcMain.handle('get-videos', () => getLocalVideos())
  ipcMain.handle('load-show-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled) return null
    return loadShowFolder(filePaths[0])
  })
  ipcMain.handle('import-video', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Video files', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
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
  ipcMain.handle('get-video-data-url', (_, videoPath) => {
    const ext = path.extname(videoPath).slice(1).toLowerCase()
    const mimeMap = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' }
    const mime = mimeMap[ext] || 'video/mp4'
    const data = fs.readFileSync(videoPath)
    return `data:${mime};base64,${data.toString('base64')}`
  })
  ipcMain.handle('save-backdrop-trigger', (_, { folderPath, actIndex, sceneIndex, trigger }) => {
    const cuesPath = path.join(folderPath, 'cues.json')
    const data = JSON.parse(fs.readFileSync(cuesPath, 'utf8'))
    if (!data.acts[actIndex].scenes[sceneIndex].backdrop) {
      data.acts[actIndex].scenes[sceneIndex].backdrop = {}
    }
    data.acts[actIndex].scenes[sceneIndex].backdrop.trigger = trigger
    fs.writeFileSync(cuesPath, JSON.stringify(data, null, 2))
    return { success: true }
  })

  ipcMain.handle('save-lighting-cue', (_, { folderPath, actIndex, sceneIndex, cues: newCues, cueCode, trigger }) => {
    const cuesPath = path.join(folderPath, 'cues.json')
    const data = JSON.parse(fs.readFileSync(cuesPath, 'utf8'))
    if (!data.acts[actIndex].scenes[sceneIndex].lighting) {
      data.acts[actIndex].scenes[sceneIndex].lighting = {}
    }
    const lighting = data.acts[actIndex].scenes[sceneIndex].lighting
    if (newCues !== undefined) {
      // Multi-cue format: write cues array, remove legacy flat fields
      lighting.cues = newCues
      delete lighting.cue_code
      delete lighting.trigger
    } else {
      // Legacy single-cue format
      lighting.cue_code = cueCode
      lighting.trigger = trigger
    }
    fs.writeFileSync(cuesPath, JSON.stringify(data, null, 2))
    return { success: true }
  })
  ipcMain.handle('start-media-server', (_, folderPath) => startMediaServer(folderPath))

  const COLOR_SETTINGS_FILE = path.join(CONFIG_DIR, 'color-settings.json')
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
      ? fs.readdirSync(VIDEOS_DIR).filter(f => /\.(mp4|mov|webm|mkv)$/i.test(f))
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

  ipcMain.handle('load-bundled-show', (_, packId) => {
    ensureDirs()
    const ids = Array.isArray(packId) ? packId : [packId]
    const isJr = ids.some(id => id === 'shrek-jr' || id.endsWith('.JR') || id.endsWith('_JR'))
    const showFolder  = isJr ? 'shrek-jr' : 'shrek'
    const bundledPath = path.join(__dirname, 'renderer', 'shows', showFolder, 'cues.json')
    const localPath   = path.join(VIDEOS_DIR, 'cues.json')
    const cuesPath    = fs.existsSync(localPath) ? localPath : bundledPath
    if (!fs.existsSync(cuesPath)) return { success: false, error: 'Show data not found' }
    try {
      const cues = JSON.parse(fs.readFileSync(cuesPath, 'utf8'))
      if (!fs.existsSync(localPath)) fs.copyFileSync(bundledPath, localPath)
      return { success: true, cues, folderPath: VIDEOS_DIR }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
}

let mainWindow
let ledWindow

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
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindows() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 900, minHeight: 600,
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, webSecurity: false, backgroundThrottling: false }
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  const displays = require('electron').screen.getAllDisplays()
  const externalDisplay = displays.find(d => d.bounds.x !== 0 || d.bounds.y !== 0)

  if (externalDisplay) {
    const { x, y, width, height } = externalDisplay.bounds

    ledWindow = new BrowserWindow({
      x, y, width, height,
      frame: false, alwaysOnTop: true, backgroundColor: '#000000', skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, webSecurity: false, backgroundThrottling: false }
    })
    ledWindow.loadFile(path.join(__dirname, 'renderer', 'led.html'))
    ledWindow.setAlwaysOnTop(true, 'screen-saver')
  }

  ipcMain.handle('send-to-led', (_, data) => {
    if (!ledWindow) return
    ledWindow.webContents.send('led-command', data)
  })

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

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
