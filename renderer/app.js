// SceneCaster — operator interface logic

const CC_DEFAULTS = { brightness: 100, contrast: 100, hue: 0, saturation: 100 }

const state = {
  show: null,
  folderPath: null,
  showId: null,      // stable id for this show — keys the custom-layout overlay + color settings
  mediaPort: null,
  backdropIndex: -1,
  lightingIndex: -1,
  lightingSubIndex: 0,
  playedScenes: new Set(),
  dissolveTime: 1.0,
  allScenes: [],
  colorSettings: {}, // keyed by per-scene instanceId (legacy: video filename), holds color correction
}

// DOM
const screens = {
  lock:     document.getElementById('screen-lock'),
  activate: document.getElementById('screen-activate'),
  download: document.getElementById('screen-download'),
  player:   document.getElementById('screen-player')
}
const el = {
  lockTitle: document.getElementById('lock-title'), lockSub: document.getElementById('lock-sub'),
  lockDetail: document.getElementById('lock-detail'), btnRenew: document.getElementById('btn-renew'),
  linkEnterKey: document.getElementById('link-enter-key'), linkSupport: document.getElementById('link-support'),
  inputKey: document.getElementById('input-key'),
  btnActivate: document.getElementById('btn-activate'), activateError: document.getElementById('activate-error'),
  linkPurchase: document.getElementById('link-purchase'),
  stepKey: document.getElementById('step-key'), stepDate: document.getElementById('step-date'),
  inputClosingDate: document.getElementById('input-closing-date'),
  btnSetDate: document.getElementById('btn-set-date'), dateError: document.getElementById('date-error'),
  topbarShow: document.getElementById('topbar-show'),
  daysBadge: document.getElementById('days-badge'),
  sceneList: document.getElementById('scene-list'), backdropScene: document.getElementById('backdrop-scene'),
  backdropTrigger: document.getElementById('backdrop-trigger'),
  lightingCueList: document.getElementById('lighting-cue-list'),
  nextBackdrop: document.getElementById('next-backdrop'),
  nextBackdropTrigger: document.getElementById('next-backdrop-trigger'), nextLighting: document.getElementById('next-lighting'),
  btnB: document.getElementById('btn-b'),
  btnL: document.getElementById('btn-l'), btnLBack: document.getElementById('btn-l-back'),
  btnBlack: document.getElementById('btn-black'),
  btnEditCue: document.getElementById('btn-edit-cue'), btnTriggerEdit: document.getElementById('btn-trigger-edit'),
  dissolveSlider: document.getElementById('dissolve-slider'),
  dissolveLabel: document.getElementById('dissolve-label'),
  btnColorToggle: document.getElementById('btn-color-toggle'),
  btnRearProjection: document.getElementById('btn-rear-projection'),
  btnEditModeLock: document.getElementById('btn-edit-mode-lock'),
  colorPanel: document.getElementById('color-panel'),
  ccBrightness: document.getElementById('cc-brightness'),
  ccContrast: document.getElementById('cc-contrast'),
  ccHue: document.getElementById('cc-hue'),
  ccSaturation: document.getElementById('cc-saturation'),
  ccBrightnessVal: document.getElementById('cc-brightness-val'),
  ccContrastVal: document.getElementById('cc-contrast-val'),
  ccHueVal: document.getElementById('cc-hue-val'),
  ccSaturationVal: document.getElementById('cc-saturation-val'),
}

function showScreen(name) { Object.values(screens).forEach(s => s.classList.add('hidden')); screens[name].classList.remove('hidden') }

function updateDaysBadge(daysRemaining) {
  if (daysRemaining == null) return
  el.daysBadge.textContent = daysRemaining === 1 ? 'Last day' : `${daysRemaining} days left`
  el.daysBadge.classList.remove('hidden')
}

// ── Preview — mirrors LED window with same A/B crossfade engine ─────────────────
const prevA = document.getElementById('preview-a')
const prevB = document.getElementById('preview-b')
let prevTop = prevA
let prevBot = prevB

function previewCrossfadeTo(src, dissolve, looping, colorSettings) {
  prevBot.ontimeupdate = null
  prevTop.ontimeupdate = null
  prevBot.src = src
  // Apply new scene's color to incoming video — prevTop keeps its own filter throughout
  prevBot.style.filter = colorSettings ? makeColorFilter(colorSettings) : 'none'
  prevBot.loop = false
  prevBot.style.transition = 'none'
  prevBot.style.opacity = '0'
  prevBot.style.zIndex = '2'
  prevTop.style.zIndex = '1'

  function startFade() {
    prevBot.play().catch(() => {})
    if (dissolve <= 0) {
      prevBot.style.transition = 'none'
      prevBot.style.opacity = '1'
      prevTop.style.opacity = '0'
    } else {
      prevBot.style.transition = `opacity ${dissolve}s ease-in-out`
      prevBot.style.opacity = '1'
    }
    const newTop = prevBot; const newBot = prevTop
    prevTop = newTop; prevBot = newBot
    setTimeout(() => {
      prevBot.loop = false; prevBot.pause(); prevBot.src = ''
      prevBot.style.transition = 'none'; prevBot.style.opacity = '0'
      prevBot.ontimeupdate = null
    }, dissolve * 1000)
    if (looping) previewScheduleLoop(prevTop, src, dissolve)
    document.getElementById('preview-container')?.classList.add('playing')
  }

  if (prevTop.readyState === 0) {
    let botReady = false, topPlaying = false
    const tryStart = () => { if (botReady && topPlaying) startFade() }
    prevBot.onloadeddata = () => { botReady = true; tryStart() }
    const onTopPlaying = () => {
      prevTop.removeEventListener('playing', onTopPlaying)
      topPlaying = true; tryStart()
    }
    prevTop.addEventListener('playing', onTopPlaying)
    prevTop.src = src; prevTop.muted = true
    prevTop.play().catch(() => { topPlaying = true; tryStart() })
  } else {
    prevBot.onloadeddata = startFade
  }
}

function previewScheduleLoop(vid, src, dissolve) {
  let fired = false
  vid.ontimeupdate = () => {
    if (fired || !vid.duration) return
    const remaining = vid.duration - vid.currentTime
    if (remaining <= dissolve && remaining > 0) { fired = true; previewCrossfadeTo(src, dissolve, true) }
  }
}

function previewCommand({ type, src, dissolve, loop, colorSettings }) {
  const d = dissolve || 1
  if (type === 'play') previewCrossfadeTo(src, d, loop || false, colorSettings)
  if (type === 'black') {
    prevA.ontimeupdate = null; prevB.ontimeupdate = null
    prevA.style.transition = `opacity ${d}s ease-in-out`
    prevB.style.transition = `opacity ${d}s ease-in-out`
    prevA.style.opacity = '0'; prevB.style.opacity = '0'
    document.getElementById('preview-container')?.classList.remove('playing')
  }
}

// ── License ────────────────────────────────────────────────────────────────────
async function initLicense() {
  const result = await window.showrunner.checkLicense()
  if (result.status === 'none') { showScreen('activate'); return }
  if (result.status === 'expired') {
    el.lockTitle.textContent = result.filesDeleted ? 'Your Run Is Complete' : 'License Expired'
    el.lockSub.textContent = result.filesDeleted
      ? `Your show files have been removed from this computer. Thank you for a great run! 🎭`
      : `Your license for "${result.showName || 'this production'}" has expired.`
    el.lockDetail.textContent = `License expired: ${new Date(result.expiryDate).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`
    el.btnRenew.onclick = () => window.showrunner.openUrl(result.storeUrl)
    el.linkSupport.onclick = () => window.showrunner.openUrl('mailto:support@e-llusionmedia.com')
    showScreen('lock'); return
  }
  if (result.status === 'invalid') {
    el.lockTitle.textContent = 'Invalid License'
    el.lockSub.textContent = result.error || 'This license key is not valid.'
    el.btnRenew.onclick = () => window.showrunner.openUrl('https://payhip.com/ellusionMEDIA')
    showScreen('lock'); return
  }
  if (result.status === 'active') checkAndDownload(result.payload, result.daysRemaining)
}

el.linkEnterKey?.addEventListener('click', () => showScreen('activate'))

let _pendingToken = null  // purchase token waiting for closing date confirmation

el.btnActivate.addEventListener('click', async () => {
  const token = el.inputKey.value.trim()
  if (!token) { showActivateError('Please enter your license key.'); return }
  el.btnActivate.textContent = 'Activating…'; el.btnActivate.disabled = true
  const result = await window.showrunner.activateLicense(token)
  el.btnActivate.textContent = 'Activate'; el.btnActivate.disabled = false
  if (!result.success) { showActivateError(result.error); return }
  if (result.needsDatePicker) {
    _pendingToken = token
    showDatePickerStep()
    return
  }
  checkAndDownload(result.payload, null)
})

el.inputKey.addEventListener('keydown', e => { if (e.key === 'Enter') el.btnActivate.click() })
el.linkPurchase?.addEventListener('click', () => window.showrunner.openUrl('https://payhip.com/ellusionMEDIA'))
function showActivateError(msg) { el.activateError.textContent = msg; el.activateError.classList.remove('hidden') }

function showDatePickerStep() {
  el.stepKey.classList.add('hidden')
  el.stepDate.classList.remove('hidden')
  // Set min date to today so they can't pick a date in the past
  el.inputClosingDate.min = new Date().toISOString().split('T')[0]
  el.inputClosingDate.focus()
}

el.btnSetDate.addEventListener('click', async () => {
  const closingDate = el.inputClosingDate.value
  if (!closingDate) { showDateError('Please select your last show date.'); return }
  el.btnSetDate.textContent = 'Activating…'; el.btnSetDate.disabled = true
  const result = await window.showrunner.finalizeLicense({ token: _pendingToken, closingDate })
  el.btnSetDate.textContent = 'Confirm & Activate →'; el.btnSetDate.disabled = false
  if (!result.success) { showDateError(result.error || 'Activation failed. Please try again.'); return }
  _pendingToken = null
  checkAndDownload(result.payload, null)
})

el.inputClosingDate.addEventListener('keydown', e => { if (e.key === 'Enter') el.btnSetDate.click() })
function showDateError(msg) { el.dateError.textContent = msg; el.dateError.classList.remove('hidden') }

// ── Player start (dev mode / fallback) ─────────────────────────────────────────
function startPlayer(payload, daysRemaining) {
  if (payload?.showName) el.topbarShow.textContent = payload.showName
  updateDaysBadge(daysRemaining)
  showScreen('player')
}

// ── Download / auto-load flow ───────────────────────────────────────────────────
let _dlManifest = null
let _dlPending  = []
let _dlPayload  = null
let _dlDays     = null

async function checkAndDownload(payload, daysRemaining) {
  // Dev mode has no packId — skip download, go straight to player
  if (!payload.p) { startPlayer(payload, daysRemaining); return }

  const packIds = Array.isArray(payload.p) ? payload.p : [payload.p]

  // Fetch manifest first — needed to know which files belong to this pack
  const manifest = await window.showrunner.fetchManifest()
  if (manifest.error) {
    // Offline — try loading what's already on disk
    await autoLoadShow(payload, daysRemaining)
    return
  }

  // Build the list of files needed for this license
  const neededMap = new Map()
  for (const id of packIds) {
    if (manifest.packs?.[id]) {
      manifest.packs[id].map(fileKey => manifest.files[fileKey]).filter(Boolean)
        .forEach(f => neededMap.set(f.filename, f))
    } else if (manifest.files?.[id]) {
      neededMap.set(manifest.files[id].filename, manifest.files[id])
    }
  }
  const needed = Array.from(neededMap.values())

  // Check what's already on disk
  const status0 = await window.showrunner.getDownloadStatus()
  const existing0 = new Set(status0.existing)
  const allPresent = needed.length > 0 && needed.every(f => existing0.has(f.filename))
  if (allPresent) {
    await autoLoadShow(payload, daysRemaining)
    return
  }

  _dlManifest = manifest
  const missing = needed.filter(f => !existing0.has(f.filename))

  // Show download screen
  _dlPending = missing
  _dlPayload = payload
  _dlDays    = daysRemaining

  const total = missing.length
  document.getElementById('dl-subtitle').textContent =
    `${total} scene file${total !== 1 ? 's' : ''} ready to download.`
  document.getElementById('dl-count').textContent = `0 of ${total}`
  document.getElementById('dl-bar-fill').style.width = '0%'
  document.getElementById('dl-current-file').textContent = 'Ready to download'
  document.getElementById('btn-start-download').disabled = false
  document.getElementById('btn-start-download').textContent = 'Download Now'
  document.getElementById('btn-start-download').classList.remove('hidden')
  document.getElementById('btn-launch-show').classList.add('hidden')
  document.getElementById('dl-error').classList.add('hidden')
  showScreen('download')
}

async function autoLoadShow(payload, daysRemaining) {
  const result = await window.showrunner.loadBundledShow(payload.p)
  if (!result.success) { startPlayer(payload, daysRemaining); return }
  await mountShow(result.cues, result.folderPath, payload, daysRemaining, result.showId)
}

// ── Download button ─────────────────────────────────────────────────────────────
document.getElementById('btn-start-download').addEventListener('click', async () => {
  const btn = document.getElementById('btn-start-download')
  btn.disabled = true; btn.textContent = 'Downloading…'

  const total = _dlPending.length
  let completed = 0

  window.showrunner.onDownloadProgress(({ filename, percent }) => {
    document.getElementById('dl-current-file').textContent = filename
    const overall = Math.round((completed + percent / 100) / total * 100)
    document.getElementById('dl-bar-fill').style.width = `${overall}%`
  })

  for (const file of _dlPending) {
    document.getElementById('dl-current-file').textContent = `Downloading: ${file.filename}`
    document.getElementById('dl-count').textContent = `${completed + 1} of ${total}`

    const result = await window.showrunner.downloadFile({ fileId: file.fileId, filename: file.filename })

    if (!result.success) {
      const errEl = document.getElementById('dl-error')
      errEl.textContent = `Failed: ${file.filename} — ${result.error}`
      errEl.classList.remove('hidden')
      btn.disabled = false; btn.textContent = 'Retry'
      return
    }

    completed++
    document.getElementById('dl-bar-fill').style.width = `${Math.round(completed / total * 100)}%`
    document.getElementById('dl-count').textContent = `${completed} of ${total}`
  }

  document.getElementById('dl-current-file').textContent = 'All files downloaded! ✓'
  document.getElementById('dl-count').textContent = `${total} of ${total}`
  btn.classList.add('hidden')
  document.getElementById('btn-launch-show').classList.remove('hidden')
})

document.getElementById('btn-launch-show').addEventListener('click', async () => {
  await autoLoadShow(_dlPayload, _dlDays)
})

// ── Custom-layout merge helpers ─────────────────────────────────────────────────
// Master cues are never mutated. state.allScenes is rebuilt each mount by walking
// the custom "order" overlay (or natural master order when none exists yet) and
// resolving each entry to a flattened scene the UI/playback already understands.
function normalizeLightingCues(lighting) {
  if (Array.isArray(lighting?.cues)) return lighting.cues
  if (lighting?.cue_code) return [{ cue_code: lighting.cue_code, trigger: lighting.trigger || '' }]
  return []
}

function flattenScene(masterScene, meta, override, skip) {
  // Sparse override wins per-field; every untouched field still flows from master,
  // so our upstream cues fixes keep reaching the operator.
  const backdrop_trigger = (override?.backdrop && 'trigger' in override.backdrop)
    ? override.backdrop.trigger
    : masterScene.backdrop?.trigger
  const lighting_cues = (override?.lighting && Array.isArray(override.lighting.cues))
    ? override.lighting.cues
    : normalizeLightingCues(masterScene.lighting)
  return {
    ...masterScene,
    kind: 'master',
    sceneRef: { kind: 'master', sceneId: masterScene.id },
    instanceId: masterScene.id,
    actNum: meta.actNum,
    originalPosition: meta.originalPosition,
    originalCueNumber: masterScene.id,
    skip: !!skip,
    name: masterScene.backdrop?.label || masterScene.scene_label,
    video_file: masterScene.backdrop?.file,
    backdrop_trigger,
    mti_page: masterScene.mti_pages,
    lighting_cues,
  }
}

function flattenCustomScene(cs) {
  return {
    kind: 'custom',
    sceneRef: { kind: 'custom', id: cs.id },
    instanceId: cs.id,
    actNum: null,
    originalPosition: null,
    originalCueNumber: null,
    skip: false,
    renamable: true,
    origin: cs.origin,
    name: cs.name || cs.backdrop?.label || 'Custom Scene',
    video_file: cs.backdrop?.file || null,
    backdrop_trigger: cs.backdrop?.trigger || '',
    mti_page: cs.mti_pages || null,
    lighting_cues: normalizeLightingCues(cs.lighting),
  }
}

function flattenBlackout(bo) {
  return {
    kind: 'blackout',
    sceneRef: { kind: 'blackout', id: bo.id },
    instanceId: bo.id,
    actNum: null,
    originalPosition: null,
    originalCueNumber: null,
    skip: false,
    name: bo.label || 'Blackout',
    video_file: null,          // null → playback sends a black command instead of a video
    backdrop_trigger: '',
    mti_page: null,
    lighting_cues: [],
  }
}

// ── Mount show (shared by auto-load and manual load) ────────────────────────────
async function mountShow(cues, folderPath, payload, daysRemaining, showId) {
  state.show = cues
  state.folderPath = folderPath
  state.showId = showId || null
  state.mediaPort = await window.showrunner.startMediaServer(folderPath)
  state.backdropIndex = -1; state.lightingIndex = -1; state.lightingSubIndex = 0
  state.playedScenes = new Set(); state.allScenes = []

  // Ownership predicate — à la carte licenses only unlock purchased scenes.
  // Applied per-entry during the merge below (not as a pre-filter) so it composes
  // cleanly with a custom order.
  const ownedPackIds = Array.isArray(payload?.p) ? payload.p
                     : payload?.p ? [payload.p] : null
  const isFullShow = !ownedPackIds || ownedPackIds.some(id => ['-adult', '-jr', '-full'].some(s => id.endsWith(s)))
  function isOwned(masterScene) {
    if (isFullShow) return true
    const videoId = (masterScene.backdrop?.file || '').replace('.mp4', '')
    return !videoId || ownedPackIds.includes(videoId)
  }

  // Index master scenes by their stable id, retaining original position (for the
  // later cue sheet's "original cue number" vs. current display position).
  const masterById = new Map()
  let pos = 0
  cues.acts.forEach(act => {
    act.scenes.forEach(scene => {
      masterById.set(scene.id, { scene, actNum: act.act, originalPosition: pos++ })
    })
  })

  // Custom overlay (null when the operator hasn't customized this show yet).
  const layout = state.showId ? await window.showrunner.getCustomLayout({ showId: state.showId }) : null

  const orderEntries = (layout?.order && layout.order.length)
    ? layout.order
    : Array.from(masterById.values()).map(m => ({ kind: 'master', sceneId: m.scene.id }))

  orderEntries.forEach(entry => {
    if (entry.kind === 'master') {
      const m = masterById.get(entry.sceneId)
      if (!m) return                  // scene id no longer exists upstream — drop silently
      if (!isOwned(m.scene)) return    // à la carte filter, applied at resolution time
      state.allScenes.push(flattenScene(m.scene, m, layout?.overrides?.[entry.sceneId], entry.skip))
    } else if (entry.kind === 'custom') {
      const cs = layout?.customScenes?.[entry.id]
      if (cs) state.allScenes.push(flattenCustomScene(cs))
    } else if (entry.kind === 'blackout') {
      const bo = layout?.blackouts?.[entry.id]
      if (bo) state.allScenes.push(flattenBlackout(bo))
    }
  })

  el.topbarShow.textContent = cues.show?.title || cues.show
  if (payload?.p) {
    el.topbarShow.textContent = payload.showName || cues.show?.title || cues.show
  }
  updateDaysBadge(daysRemaining)
  // Load saved color settings from disk
  const savedColors = await window.showrunner.loadColorSettings()
  state.colorSettings = savedColors || {}

  renderSceneList(); updateCenterPanel(); updateNextPanel()
  showScreen('player')
}


// ── Scene list ──────────────────────────────────────────────────────────────────
function renderSceneList() {
  if (!state.show) return
  el.sceneList.innerHTML = ''
  let lastAct = null
  state.allScenes.forEach((scene, flatIndex) => {
    // Only master scenes carry an act number; custom/blackout entries slot in
    // under the current act without spawning a spurious divider.
    if (scene.actNum != null && scene.actNum !== lastAct) {
      const div = document.createElement('div')
      div.className = 'act-divider'
      div.textContent = `Act ${scene.actNum}`
      el.sceneList.appendChild(div)
      lastAct = scene.actNum
    }
    const item = document.createElement('div')
    item.className = `scene-item${flatIndex === state.backdropIndex ? ' active' : ''}${scene.skip ? ' skipped' : ''}`
    const triggerSnippet = scene.backdrop_trigger
      ? `<div class="scene-trigger">${scene.backdrop_trigger}</div>` : ''
    const pageSnippet = scene.mti_page ? `<div class="scene-page">p.${scene.mti_page}</div>` : ''
    item.innerHTML = `<div class="scene-name">${escHtml(scene.name)}</div>${triggerSnippet}${pageSnippet}`
    item.addEventListener('click', () => jumpToScene(flatIndex))
    el.sceneList.appendChild(item)
  })
}

function jumpToScene(flatIndex) {
  state.backdropIndex = flatIndex; state.lightingIndex = flatIndex; state.lightingSubIndex = 0
  playCurrentBackdrop(); updateCenterPanel(); updateNextPanel(); renderSceneList()
  scrollSceneIntoView(flatIndex)
}

function scrollSceneIntoView(index) {
  const items = el.sceneList.querySelectorAll('.scene-item')
  if (items[index]) items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// ── B key — backdrop advance ────────────────────────────────────────────────────
function advanceBackdrop() {
  if (!state.allScenes.length) return
  // Skip past any scenes flagged skip — they stay in the list but never play.
  let next = state.backdropIndex + 1
  while (next < state.allScenes.length && state.allScenes[next]?.skip) next++
  if (next >= state.allScenes.length) return  // nothing playable ahead — stay put
  if (state.backdropIndex >= 0) state.playedScenes.add(state.backdropIndex)
  state.backdropIndex = next
  state.lightingIndex = state.backdropIndex; state.lightingSubIndex = 0
  playCurrentBackdrop(); updateCenterPanel(); updateNextPanel(); renderSceneList()
  scrollSceneIntoView(state.backdropIndex)
}

function playCurrentBackdrop() {
  if (state.backdropIndex < 0 || !state.allScenes.length) return
  const scene = state.allScenes[state.backdropIndex]
  if (!scene) return
  // Blackout entries have no video — advancing onto one goes to black.
  if (scene.kind === 'blackout') {
    const cmd = { type: 'black', dissolve: state.dissolveTime }
    window.showrunner.sendToLed(cmd); previewCommand(cmd)
    return
  }
  loadColorForScene(state.backdropIndex)
  if (!scene.video_file) return
  const videoPath = `${state.folderPath}/${scene.video_file}`
  const loop = true
  const cc = getColorForScene(state.backdropIndex)
  window.showrunner.sendToLed({ type: 'play', src: `file://${videoPath}`, dissolve: state.dissolveTime, loop, ...cc })
  const previewSrc = state.mediaPort
    ? `http://127.0.0.1:${state.mediaPort}/${encodeURIComponent(scene.video_file)}`
    : `file://${videoPath}`
  previewCommand({ type: 'play', src: previewSrc, dissolve: state.dissolveTime, loop, colorSettings: cc })
  // Update sliders to show new scene's color settings
  el.ccBrightness.value = cc.brightness
  el.ccContrast.value = cc.contrast
  el.ccHue.value = cc.hue
  el.ccSaturation.value = cc.saturation
  updateColorLabels(cc)
}

// ── L key — lighting advance ────────────────────────────────────────────────────
function advanceLighting() {
  if (!state.allScenes.length) return
  const scene = state.allScenes[state.lightingIndex]
  const cues = scene?.lighting_cues || []
  if (state.lightingSubIndex < cues.length - 1) state.lightingSubIndex++
  updateCenterPanel(); updateNextPanel()
}

function backLighting() {
  if (!state.allScenes.length) return
  if (state.lightingSubIndex > 0) {
    state.lightingSubIndex--
  } else if (state.lightingIndex > 0) {
    state.lightingIndex--
    const prevScene = state.allScenes[state.lightingIndex]
    const prevCues = prevScene?.lighting_cues || []
    state.lightingSubIndex = Math.max(0, prevCues.length - 1)
  }
  updateCenterPanel(); updateNextPanel()
}

// ── Center panel update ─────────────────────────────────────────────────────────
function updateCenterPanel() {
  const bs = state.allScenes[state.backdropIndex]
  const ls = state.allScenes[state.lightingIndex]
  el.backdropScene.textContent = bs ? bs.name : '—'
  if (el.backdropTrigger.contentEditable !== 'true') {
    el.backdropTrigger.innerHTML = bs?.backdrop_trigger || 'Click → when the scene changes'
  }

  const cues = ls?.lighting_cues || []
  el.lightingCueList.innerHTML = ''
  if (cues.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'cue-item-empty'
    empty.textContent = ls ? '(no cue set)' : '—'
    el.lightingCueList.appendChild(empty)
  } else {
    cues.forEach((c, i) => {
      const item = document.createElement('div')
      item.className = `cue-item ${i === state.lightingSubIndex ? 'active' : 'inactive'}`
      item.innerHTML = `<div class="cue-item-code">${escHtml(c.cue_code || '(no code)')}</div><div class="cue-item-trigger">${escHtml(c.trigger || '')}</div>`
      el.lightingCueList.appendChild(item)
      if (i === state.lightingSubIndex) setTimeout(() => item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
    })
  }

  const counter = document.getElementById('lighting-counter')
  if (counter) {
    if (cues.length > 1) { counter.textContent = `${state.lightingSubIndex + 1} of ${cues.length}`; counter.classList.remove('hidden') }
    else { counter.textContent = ''; counter.classList.add('hidden') }
  }

  const atLastCue = cues.length === 0 || state.lightingSubIndex >= cues.length - 1
  el.btnL.disabled = atLastCue
  el.btnLBack.disabled = state.lightingSubIndex <= 0
}

function updateNextPanel() {
  const nextB = state.allScenes[state.backdropIndex + 1]
  el.nextBackdrop.textContent = nextB ? nextB.name : 'End of show'
  el.nextBackdropTrigger.innerHTML = nextB?.backdrop_trigger || ''

  const ls = state.allScenes[state.lightingIndex]
  const cues = ls?.lighting_cues || []
  if (state.lightingSubIndex < cues.length - 1) {
    const nextCue = cues[state.lightingSubIndex + 1]
    el.nextLighting.textContent = nextCue?.cue_code || '(no cue)'
  } else {
    const nextScene = state.allScenes[state.lightingIndex + 1]
    const nextCues = nextScene?.lighting_cues || []
    el.nextLighting.textContent = nextCues[0]?.cue_code || (nextScene ? '(no cue)' : 'End of show')
  }
}

// ── Controls ────────────────────────────────────────────────────────────────────

el.btnB.addEventListener('click', advanceBackdrop)
el.btnL.addEventListener('click', advanceLighting)
el.btnLBack.addEventListener('click', backLighting)
el.btnBlack.addEventListener('click', () => {
  const cmd = { type: 'black', dissolve: state.dissolveTime }
  window.showrunner.sendToLed(cmd); previewCommand(cmd)
})

// ── Edit Cue Modal ──────────────────────────────────────────────────────────────
const modal = document.getElementById('edit-cue-modal')
const modalSceneName = document.getElementById('modal-scene-name')
const modalCueRows = document.getElementById('modal-cue-rows')

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renumberCueRows() {
  modalCueRows.querySelectorAll('.cue-row').forEach((row, i) => {
    const num = row.querySelector('.cue-row-num')
    if (num) num.textContent = i + 1
  })
}

function addCueRow(cueCode, trigger) {
  const rows = modalCueRows.querySelectorAll('.cue-row')
  const rowNum = rows.length + 1
  const row = document.createElement('div')
  row.className = 'cue-row'
  row.innerHTML = `<span class="cue-row-num">${rowNum}</span><input type="text" class="cue-row-code" placeholder="e.g. LQ 42" value="${escHtml(cueCode)}"/><input type="text" class="cue-row-trigger" placeholder="Trigger line…" value="${escHtml(trigger)}"/><button class="cue-row-remove" title="Remove">×</button>`
  row.querySelector('.cue-row-remove').addEventListener('click', () => { row.remove(); renumberCueRows() })
  modalCueRows.appendChild(row)
}

function buildCueRows(cues) {
  modalCueRows.innerHTML = ''
  const hdr = document.createElement('div')
  hdr.className = 'modal-cue-header'
  hdr.innerHTML = '<span></span><span>Cue Code</span><span>Trigger Line</span><span></span>'
  modalCueRows.appendChild(hdr)
  if (cues.length === 0) { addCueRow('', ''); return }
  cues.forEach(c => addCueRow(c.cue_code || '', c.trigger || ''))
}

el.btnEditCue.addEventListener('click', () => {
  if (state.lightingIndex < 0) return
  const scene = state.allScenes[state.lightingIndex]
  modalSceneName.textContent = scene.name
  buildCueRows(scene.lighting_cues || [])
  modal.classList.remove('hidden')
  const first = modalCueRows.querySelector('.cue-row-code')
  if (first) first.focus()
})

document.getElementById('modal-add-row').addEventListener('click', () => addCueRow('', ''))
document.getElementById('modal-cancel').addEventListener('click', () => modal.classList.add('hidden'))

document.getElementById('modal-save').addEventListener('click', () => {
  if (state.lightingIndex < 0) return
  const scene = state.allScenes[state.lightingIndex]
  const newCues = []
  modalCueRows.querySelectorAll('.cue-row').forEach(row => {
    const code = row.querySelector('.cue-row-code')?.value.trim() || ''
    const trigger = row.querySelector('.cue-row-trigger')?.value.trim() || ''
    if (code || trigger) newCues.push({ cue_code: code, trigger })
  })
  scene.lighting_cues = newCues
  state.lightingSubIndex = Math.min(state.lightingSubIndex, Math.max(0, newCues.length - 1))
  window.showrunner.saveLightingCue({ showId: state.showId, sceneRef: scene.sceneRef, cues: newCues })
  modal.classList.add('hidden'); updateCenterPanel(); updateNextPanel()
})

modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden') })

el.dissolveSlider.addEventListener('input', () => {
  state.dissolveTime = parseFloat(el.dissolveSlider.value)
  el.dissolveLabel.textContent = `${state.dissolveTime.toFixed(1)}s`
})

// ── Editable backdrop trigger (rich text) ──────────────────────────────────────

const triggerToolbar = document.getElementById('trigger-toolbar')
const triggerBoldBtn = document.getElementById('trigger-bold')
const triggerItalicBtn = document.getElementById('trigger-italic')

// Sanitize contenteditable HTML — keep only <strong>, <em>, <br>
function sanitizeTriggerHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  function walk(node) {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1) return ''
    const tag = node.tagName.toLowerCase()
    const inner = Array.from(node.childNodes).map(walk).join('')
    if (tag === 'strong' || tag === 'b') return inner ? `<strong>${inner}</strong>` : ''
    if (tag === 'em'     || tag === 'i') return inner ? `<em>${inner}</em>` : ''
    if (tag === 'br') return '<br>'
    if (tag === 'div' || tag === 'p')   return inner + (inner ? '<br>' : '')
    return inner
  }
  return Array.from(tmp.childNodes).map(walk).join('').replace(/<br>$/, '').trim()
}

let _triggerSaveFn = null  // set while editing so button click saves

function startTriggerEdit() {
  const scene = state.allScenes[state.backdropIndex]
  if (!scene || !state.folderPath) return
  if (el.backdropTrigger.contentEditable === 'true') return

  const currentHtml = scene.backdrop_trigger || ''
  el.backdropTrigger.innerHTML = currentHtml || ''
  el.backdropTrigger.contentEditable = 'true'
  el.backdropTrigger.focus()
  el.btnTriggerEdit.textContent = '✓ Save'

  // Cursor to end
  const r = document.createRange()
  r.selectNodeContents(el.backdropTrigger)
  r.collapse(false)
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)

  triggerToolbar.classList.remove('hidden')

  function save() {
    if (el.backdropTrigger.contentEditable !== 'true') return
    const newHtml = sanitizeTriggerHtml(el.backdropTrigger.innerHTML)
    scene.backdrop_trigger = newHtml
    el.backdropTrigger.contentEditable = 'false'
    el.backdropTrigger.innerHTML = newHtml || 'Click → when the scene changes'
    triggerToolbar.classList.add('hidden')
    _triggerSaveFn = null
    el.btnTriggerEdit.textContent = '✏️ Edit'
    updateNextPanel()
    window.showrunner.saveBackdropTrigger({
      showId: state.showId,
      sceneRef: scene.sceneRef,
      trigger: newHtml
    })
  }

  function cancel() {
    el.backdropTrigger.contentEditable = 'false'
    el.backdropTrigger.innerHTML = currentHtml || 'Click → when the scene changes'
    triggerToolbar.classList.add('hidden')
    _triggerSaveFn = null
    el.btnTriggerEdit.textContent = '✏️ Edit'
  }

  _triggerSaveFn = save

  el.backdropTrigger.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault(); cancel()
      el.backdropTrigger.removeEventListener('keydown', onKey)
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); save()
      el.backdropTrigger.removeEventListener('keydown', onKey)
    }
    if (e.key === 'Enter' && e.shiftKey) {
      // Insert single <br> — avoid double-newline from insertLineBreak
      e.preventDefault()
      const sel = window.getSelection()
      if (!sel.rangeCount) return
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const br = document.createElement('br')
      range.insertNode(br)
      range.setStartAfter(br)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })

  el.backdropTrigger.addEventListener('blur', function onBlur() {
    setTimeout(() => {
      save()
      el.backdropTrigger.removeEventListener('blur', onBlur)
    }, 200)
  })
}

// Toolbar: preventDefault stops blur, execCommand toggles bold/italic cleanly
// (CSS sets font-style:normal while editing so italic toggle is unambiguous)
triggerBoldBtn.addEventListener('mousedown', e => {
  e.preventDefault()
  document.execCommand('bold')
})
triggerItalicBtn.addEventListener('mousedown', e => {
  e.preventDefault()
  document.execCommand('italic')
})

// Strip pasted HTML — plain text only, formatting comes from B/I buttons
el.backdropTrigger.addEventListener('paste', e => {
  e.preventDefault()
  const text = e.clipboardData.getData('text/plain')
  document.execCommand('insertText', false, text)
})

el.btnTriggerEdit.addEventListener('click', () => {
  if (_triggerSaveFn) _triggerSaveFn()
  else startTriggerEdit()
})

// ── Color correction ────────────────────────────────────────────────────────────

function colorKey(index) {
  // New writes key by per-scene instanceId so two scenes sharing a video file
  // (e.g. a duplicated scene) get independent color correction.
  return state.allScenes[index]?.instanceId || null
}

function getColorForScene(index) {
  const scene = state.allScenes[index]
  if (!scene) return { ...CC_DEFAULTS }
  if (scene.instanceId && state.colorSettings[scene.instanceId]) return state.colorSettings[scene.instanceId]
  // Backward-compat: installs from before the instanceId migration keyed by filename.
  if (scene.video_file && state.colorSettings[scene.video_file]) return state.colorSettings[scene.video_file]
  return { ...CC_DEFAULTS }
}

function makeColorFilter(s) {
  return `brightness(${s.brightness}%) contrast(${s.contrast}%) hue-rotate(${s.hue}deg) saturate(${s.saturation}%)`
}

function sendColorToLed(s) {
  window.showrunner.sendToLed({ type: 'color', brightness: s.brightness, contrast: s.contrast, hue: s.hue, saturation: s.saturation })
  // Mirror to preview — apply to currently active preview video
  prevTop.style.filter = makeColorFilter(s)
}

function updateColorLabels(s) {
  el.ccBrightnessVal.textContent = s.brightness
  el.ccContrastVal.textContent = s.contrast
  el.ccHueVal.textContent = `${s.hue}°`
  el.ccSaturationVal.textContent = s.saturation
}

function isColorModified(s) {
  return s.brightness !== CC_DEFAULTS.brightness ||
         s.contrast   !== CC_DEFAULTS.contrast   ||
         s.hue        !== CC_DEFAULTS.hue        ||
         s.saturation !== CC_DEFAULTS.saturation
}

function updateColorIndicator() {
  const s = getColorForScene(state.backdropIndex)
  el.btnColorToggle.classList.toggle('has-color', isColorModified(s))
}

function loadColorForScene(index) {
  const s = getColorForScene(index)
  el.ccBrightness.value = s.brightness
  el.ccContrast.value = s.contrast
  el.ccHue.value = s.hue
  el.ccSaturation.value = s.saturation
  updateColorLabels(s)
  updateColorIndicator()
  sendColorToLed(s)
}

let colorSaveTimer = null
function saveColorSettingsToDisk() {
  if (colorSaveTimer) clearTimeout(colorSaveTimer)
  colorSaveTimer = setTimeout(() => {
    window.showrunner.saveColorSettings(state.colorSettings)
    colorSaveTimer = null
  }, 500)
}

function onColorSliderChange() {
  const s = {
    brightness: parseInt(el.ccBrightness.value),
    contrast:   parseInt(el.ccContrast.value),
    hue:        parseInt(el.ccHue.value),
    saturation: parseInt(el.ccSaturation.value),
  }
  const key = colorKey(state.backdropIndex)
  if (key) state.colorSettings[key] = s
  updateColorLabels(s)
  updateColorIndicator()
  sendColorToLed(s)
  saveColorSettingsToDisk()
}

function closeColorPanel() {
  el.colorPanel.classList.add('hidden')
  el.btnColorToggle.classList.remove('active')
}

el.btnColorToggle.addEventListener('click', () => {
  const open = el.colorPanel.classList.toggle('hidden') === false
  el.btnColorToggle.classList.toggle('active', open)
})

document.getElementById('cc-close').addEventListener('click', closeColorPanel)

el.ccBrightness.addEventListener('input', onColorSliderChange)
el.ccContrast.addEventListener('input', onColorSliderChange)
el.ccHue.addEventListener('input', onColorSliderChange)
el.ccSaturation.addEventListener('input', onColorSliderChange)

document.getElementById('cc-reset').addEventListener('click', () => {
  const scene = state.allScenes[state.backdropIndex]
  if (scene) {
    if (scene.instanceId) delete state.colorSettings[scene.instanceId]
    if (scene.video_file) delete state.colorSettings[scene.video_file] // clear any legacy filename-keyed entry too
  }
  loadColorForScene(state.backdropIndex)
  updateColorIndicator()
  saveColorSettingsToDisk()
})

// ── Keyboard shortcuts + help overlay ───────────────────────────────────────────
const helpOverlay = document.getElementById('help-overlay')
function toggleHelp() { helpOverlay.classList.toggle('hidden') }
function closeHelp() { helpOverlay.classList.add('hidden') }
document.getElementById('help-close').addEventListener('click', closeHelp)
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp() })

document.addEventListener('keydown', e => {
  if (screens.player.classList.contains('hidden')) return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return
  if (e.key === '?' || e.code === 'KeyH') { e.preventDefault(); toggleHelp(); return }
  if (e.code === 'Escape') { if (!helpOverlay.classList.contains('hidden')) { e.preventDefault(); closeHelp() } return }
  if (!helpOverlay.classList.contains('hidden')) return  // don't drive the show while help is open
  switch (e.code) {
    case 'KeyB': e.preventDefault(); advanceBackdrop(); break
    case 'KeyL': e.preventDefault(); advanceLighting(); break
    case 'Space': e.preventDefault(); el.btnBlack.click(); break
  }
})

// ── Re-enter license (from menu bar) ────────────────────────────────────────────
window.showrunner.onShowActivate(() => {
  el.inputKey.value = ''
  el.activateError.classList.add('hidden')
  el.stepKey.classList.remove('hidden')
  el.stepDate.classList.add('hidden')
  _pendingToken = null
  showScreen('activate')
})

// ── Rear Projection Mode ────────────────────────────────────────────────────────
let appSettings = {}

function updateRearProjectionBtn(on) {
  if (on) {
    el.btnRearProjection.style.background = 'var(--orange)'
    el.btnRearProjection.style.color = '#fff'
    el.btnRearProjection.style.borderColor = 'transparent'
  } else {
    el.btnRearProjection.style.background = ''
    el.btnRearProjection.style.color = ''
    el.btnRearProjection.style.borderColor = ''
  }
}

async function initAppSettings() {
  appSettings = await window.showrunner.getAppSettings()
  updateRearProjectionBtn(!!appSettings.rearProjection)
  if (appSettings.rearProjection) window.showrunner.sendToLed({ type: 'rear-projection', enabled: true })
  updateEditModeLockBtn(!!appSettings.editModeLocked)
}

el.btnRearProjection.addEventListener('click', () => {
  appSettings.rearProjection = !appSettings.rearProjection
  const on = appSettings.rearProjection
  updateRearProjectionBtn(on)
  window.showrunner.sendToLed({ type: 'rear-projection', enabled: on })
  window.showrunner.saveAppSettings(appSettings)
})

// ── Edit / Show mode lock ────────────────────────────────────────────────────
// Show Mode locks the (upcoming) structural Custom-Mode actions — reorder, skip,
// delete, upload, duplicate, rename — so nothing can be disturbed mid-performance.
// It deliberately does NOT gate the existing trigger / lighting-cue text editors,
// which stay usable live for quick fixes. isEditLocked() is the single source of
// truth later phases check before any structural action.
function isEditLocked() {
  return !!appSettings.editModeLocked
}

function updateEditModeLockBtn(locked) {
  el.btnEditModeLock.textContent = locked ? '🔒 Show Mode' : '🔓 Edit Mode'
  if (locked) {
    el.btnEditModeLock.style.background = 'var(--orange)'
    el.btnEditModeLock.style.color = '#fff'
    el.btnEditModeLock.style.borderColor = 'transparent'
  } else {
    el.btnEditModeLock.style.background = ''
    el.btnEditModeLock.style.color = ''
    el.btnEditModeLock.style.borderColor = ''
  }
}

el.btnEditModeLock.addEventListener('click', () => {
  appSettings.editModeLocked = !appSettings.editModeLocked
  updateEditModeLockBtn(appSettings.editModeLocked)
  window.showrunner.saveAppSettings(appSettings)
})

// When LED window (re)opens, re-apply state so operator never has to click twice
window.showrunner.onLedWindowReady(() => {
  if (appSettings.rearProjection) {
    window.showrunner.sendToLed({ type: 'rear-projection', enabled: true })
  }
  if (state.backdropIndex >= 0) {
    playCurrentBackdrop()
  }
})

// ── Boot ────────────────────────────────────────────────────────────────────────
// Ping backend immediately so Render wakes up before we need the manifest
window.showrunner.fetchManifest().catch(() => {})
initAppSettings()
initLicense()
