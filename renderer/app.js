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
  hideSkipped: false, // display-only filter — never persisted, resets each launch
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
  stepCappedNotice: document.getElementById('step-capped-notice'),
  cappedExpiryDate: document.getElementById('capped-expiry-date'),
  btnCappedContinue: document.getElementById('btn-capped-continue'),
  topbarShow: document.getElementById('topbar-show'),
  daysBadge: document.getElementById('days-badge'),
  sceneList: document.getElementById('scene-list'), backdropScene: document.getElementById('backdrop-scene'),
  btnHideSkipped: document.getElementById('btn-hide-skipped'),
  backdropTrigger: document.getElementById('backdrop-trigger'),
  lightingCueList: document.getElementById('lighting-cue-list'),
  btnB: document.getElementById('btn-b'),
  btnL: document.getElementById('btn-l'), btnLBack: document.getElementById('btn-l-back'),
  btnBlack: document.getElementById('btn-black'),
  btnEditCue: document.getElementById('btn-edit-cue'), btnTriggerEdit: document.getElementById('btn-trigger-edit'),
  dissolveSlider: document.getElementById('dissolve-slider'),
  dissolveLabel: document.getElementById('dissolve-label'),
  btnColorToggle: document.getElementById('btn-color-toggle'),
  btnRearProjection: document.getElementById('btn-rear-projection'),
  btnEditModeLock: document.getElementById('btn-edit-mode-lock'),
  btnResetShow: document.getElementById('btn-reset-show'),
  btnInsertBlackout: document.getElementById('btn-insert-blackout'),
  btnUploadScene: document.getElementById('btn-upload-scene'),
  btnUploadStill: document.getElementById('btn-upload-still'),
  btnCueSheet: document.getElementById('btn-cue-sheet'),
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
const prevStill = document.getElementById('preview-still')
const previewMissingEl = document.getElementById('preview-missing')

function fileLabelFromSrc(src) {
  try { return decodeURIComponent(src).split('/').pop().split('?')[0] } catch { return 'this file' }
}
function showPreviewMissing(src) {
  previewMissingEl.textContent = `⚠ Video file not found: ${fileLabelFromSrc(src)}`
  previewMissingEl.classList.remove('hidden')
}
function hidePreviewMissing() { previewMissingEl.classList.add('hidden') }
let prevTop = prevA
let prevBot = prevB

// Preview still: fade the image in on top and fade the video layers out beneath it.
function previewStill(src, dissolve, colorSettings) {
  const d = dissolve <= 0.1 ? 0 : dissolve
  prevA.ontimeupdate = null; prevB.ontimeupdate = null
  prevStill.style.transition = `opacity ${d}s ease-in-out`
  prevStill.style.filter = colorSettings ? makeColorFilter(colorSettings) : 'none'
  prevStill.onerror = () => showPreviewMissing(src)
  prevStill.onload = () => hidePreviewMissing()
  prevStill.src = src
  requestAnimationFrame(() => {
    prevStill.style.opacity = '1'
    prevA.style.transition = `opacity ${d}s ease-in-out`; prevA.style.opacity = '0'
    prevB.style.transition = `opacity ${d}s ease-in-out`; prevB.style.opacity = '0'
  })
  document.getElementById('preview-container')?.classList.add('playing')
}
function previewHideStill(dissolve) {
  prevStill.style.transition = `opacity ${dissolve <= 0.1 ? 0 : dissolve}s ease-in-out`
  prevStill.style.opacity = '0'
}

function previewCrossfadeTo(src, dissolve, looping, colorSettings) {
  prevBot.ontimeupdate = null
  prevTop.ontimeupdate = null
  prevBot.onerror = () => showPreviewMissing(src)  // 0-byte/missing file — surface it, don't just freeze silently
  prevBot.src = src
  // Apply new scene's color to incoming video — prevTop keeps its own filter throughout
  prevBot.style.filter = colorSettings ? makeColorFilter(colorSettings) : 'none'
  prevBot.loop = false
  prevBot.style.transition = 'none'
  prevBot.style.opacity = '0'
  prevBot.style.zIndex = '2'
  prevTop.style.zIndex = '1'

  function startFade() {
    hidePreviewMissing()
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
      prevBot.onerror = null  // clearing src below is intentional cleanup, not a real load failure
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
  if (type === 'play') { previewHideStill(d); previewCrossfadeTo(src, d, loop || false, colorSettings) }
  if (type === 'still') previewStill(src, d, colorSettings)
  if (type === 'black') {
    previewHideStill(d); hidePreviewMissing()
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

let _pendingActivationPayload = null  // holds payload while the capped-date notice is shown

el.btnSetDate.addEventListener('click', async () => {
  const closingDate = el.inputClosingDate.value
  if (!closingDate) { showDateError('Please select your last show date.'); return }
  el.btnSetDate.textContent = 'Activating…'; el.btnSetDate.disabled = true
  const result = await window.showrunner.finalizeLicense({ token: _pendingToken, closingDate })
  el.btnSetDate.textContent = 'Confirm & Activate →'; el.btnSetDate.disabled = false
  if (!result.success) { showDateError(result.error || 'Activation failed. Please try again.'); return }
  _pendingToken = null
  if (result.capped) {
    _pendingActivationPayload = result.payload
    el.cappedExpiryDate.textContent = result.expiryDate
    el.stepDate.classList.add('hidden')
    el.stepCappedNotice.classList.remove('hidden')
    return
  }
  checkAndDownload(result.payload, null)
})

el.inputClosingDate.addEventListener('keydown', e => { if (e.key === 'Enter') el.btnSetDate.click() })
function showDateError(msg) { el.dateError.textContent = msg; el.dateError.classList.remove('hidden') }

el.btnCappedContinue.addEventListener('click', () => {
  const payload = _pendingActivationPayload
  _pendingActivationPayload = null
  checkAndDownload(payload, null)
})

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
    dissolveOverride: override?.dissolveOverride != null ? override.dissolveOverride : null,
    name: masterScene.backdrop?.label || masterScene.scene_label,
    video_file: masterScene.backdrop?.file,
    backdrop_trigger,
    mti_page: masterScene.mti_pages,
    lighting_cues,
  }
}

function flattenCustomScene(cs, skip) {
  return {
    kind: 'custom',
    sceneRef: { kind: 'custom', id: cs.id },
    instanceId: cs.id,
    actNum: null,
    originalPosition: null,
    originalCueNumber: null,
    skip: !!skip,
    renamable: true,
    origin: cs.origin,
    isStill: !!cs.still,
    dissolveOverride: cs.dissolveOverride != null ? cs.dissolveOverride : null,
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
    dissolveOverride: bo.dissolveOverride != null ? bo.dissolveOverride : null,
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
  state.payload = payload            // kept so the show can be re-mounted (e.g. after Reset)
  state.daysRemaining = daysRemaining
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

  // The natural owned order (master scenes only) — used to tell whether the list
  // is still in default order (show Act dividers) or has been customized (flat list).
  state.naturalOrderIds = []
  cues.acts.forEach(act => act.scenes.forEach(scene => { if (isOwned(scene)) state.naturalOrderIds.push(scene.id) }))

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
      if (cs) state.allScenes.push(flattenCustomScene(cs, entry.skip))
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


// ── Custom arrangement persistence (shared by skip / reorder / blackout / delete) ──
function emptyLayoutClient() {
  return { version: 1, showId: state.showId, order: [], overrides: {}, customScenes: {}, blackouts: {} }
}

// Write the CURRENT on-screen arrangement (order + skip flags) into the overlay,
// preserving overrides/customScenes/blackouts. Single primitive every structural
// edit calls after mutating state.allScenes.
function orderFromScenes() {
  return state.allScenes.map(s => {
    if (s.sceneRef.kind === 'master') {
      return s.skip ? { kind: 'master', sceneId: s.sceneRef.sceneId, skip: true }
                    : { kind: 'master', sceneId: s.sceneRef.sceneId }
    }
    if (s.sceneRef.kind === 'custom') {
      return s.skip ? { kind: 'custom', id: s.sceneRef.id, skip: true }
                    : { kind: 'custom', id: s.sceneRef.id }
    }
    return { kind: 'blackout', id: s.sceneRef.id }
  })
}

async function persistArrangement() {
  if (!state.showId) return
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
}

// ── Undo / Redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) ──────────────────────────────
// Snapshot the whole overlay before each structural edit; undo restores it and
// pushes the state you left onto the redo stack. Any new edit clears redo —
// standard undo/redo semantics.
const _undoStack = []
const _redoStack = []
async function currentLayoutSnapshot() {
  const cur = await window.showrunner.getCustomLayout({ showId: state.showId })
  return cur ? JSON.stringify(cur) : null   // null = "no overlay yet"
}
async function pushUndo() {
  if (!state.showId) return
  _undoStack.push(await currentLayoutSnapshot())
  if (_undoStack.length > 50) _undoStack.shift()
  _redoStack.length = 0   // a fresh edit invalidates redo history
}
async function restoreSnapshot(snap) {
  if (snap === null) {
    await window.showrunner.resetCustomLayout({ showId: state.showId, mode: 'full' })
  } else {
    await window.showrunner.saveCustomLayout({ showId: state.showId, layout: JSON.parse(snap) })
  }
  await mountShow(state.show, state.folderPath, state.payload, state.daysRemaining, state.showId)
}
async function sceneUndo() {
  if (isEditLocked() || !state.showId || !_undoStack.length) return
  _redoStack.push(await currentLayoutSnapshot())
  await restoreSnapshot(_undoStack.pop())
}
async function sceneRedo() {
  if (isEditLocked() || !state.showId || !_redoStack.length) return
  _undoStack.push(await currentLayoutSnapshot())
  await restoreSnapshot(_redoStack.pop())
}

// Insert a blackout cue right after the current scene (or at the end).
async function insertBlackout() {
  if (isEditLocked() || !state.showId) return
  await pushUndo()
  const id = 'bo-' + crypto.randomUUID()
  const bo = { id, label: 'Blackout', createdAt: new Date().toISOString() }
  const at = state.backdropIndex >= 0 ? state.backdropIndex + 1 : state.allScenes.length
  state.allScenes.splice(at, 0, flattenBlackout(bo))
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  layout.blackouts = layout.blackouts || {}
  layout.blackouts[id] = bo
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel()
  scrollSceneIntoView(at)
}

async function toggleSkip(flatIndex) {
  if (isEditLocked()) return
  const scene = state.allScenes[flatIndex]
  if (!scene || scene.sceneRef.kind === 'blackout') return  // any real scene can be skipped
  await pushUndo()
  scene.skip = !scene.skip
  await persistArrangement()
  renderSceneList(); updateNextPanel()
}

// Move a scene from one slot to another (drag-and-drop, cross-act allowed).
// Pointers follow their scenes by instanceId across the move.
async function moveSceneTo(from, to) {
  if (isEditLocked()) return
  const arr = state.allScenes
  if (from < 0 || from >= arr.length || from === to) return
  await pushUndo()
  const curId = state.backdropIndex >= 0 ? arr[state.backdropIndex]?.instanceId : null
  const ligId = state.lightingIndex >= 0 ? arr[state.lightingIndex]?.instanceId : null
  const [item] = arr.splice(from, 1)
  let dest = to > from ? to - 1 : to
  dest = Math.max(0, Math.min(dest, arr.length))
  arr.splice(dest, 0, item)
  state.backdropIndex = curId ? arr.findIndex(s => s.instanceId === curId) : -1
  state.lightingIndex = ligId ? arr.findIndex(s => s.instanceId === ligId) : state.backdropIndex
  await persistArrangement()
  renderSceneList(); updateCenterPanel(); updateNextPanel()
}

// ── Scene row drag + ⋯ options menu ──────────────────────────────────────────
let _dragFrom = null
function setDragOver(item) { clearDragOver(); item.classList.add('drag-over') }
function clearDragOver() { el.sceneList.querySelectorAll('.scene-item.drag-over').forEach(n => n.classList.remove('drag-over')) }

// Auto-scroll the scene list while dragging a row near its top/bottom edge.
const AUTOSCROLL_EDGE = 40 // px from the edge that starts scrolling
const AUTOSCROLL_MAX_SPEED = 12 // px per animation frame at the very edge
let _dragMouseY = null
let _autoScrollRAF = null
function autoScrollTick() {
  if (_dragMouseY != null) {
    const rect = el.sceneList.getBoundingClientRect()
    const distTop = _dragMouseY - rect.top
    const distBottom = rect.bottom - _dragMouseY
    if (distTop >= 0 && distTop < AUTOSCROLL_EDGE) {
      el.sceneList.scrollTop -= AUTOSCROLL_MAX_SPEED * (1 - distTop / AUTOSCROLL_EDGE)
    } else if (distBottom >= 0 && distBottom < AUTOSCROLL_EDGE) {
      el.sceneList.scrollTop += AUTOSCROLL_MAX_SPEED * (1 - distBottom / AUTOSCROLL_EDGE)
    }
  }
  _autoScrollRAF = requestAnimationFrame(autoScrollTick)
}
el.sceneList.addEventListener('dragstart', () => {
  _dragMouseY = null
  if (_autoScrollRAF == null) _autoScrollRAF = requestAnimationFrame(autoScrollTick)
})
// preventDefault here (not just on individual rows) is required — otherwise the
// browser silently refuses to drop on anything that isn't a row itself, which
// now includes the dissolve connectors and act dividers sitting between rows.
el.sceneList.addEventListener('dragover', e => { e.preventDefault(); _dragMouseY = e.clientY })
el.sceneList.addEventListener('dragend', () => {
  _dragMouseY = null
  if (_autoScrollRAF != null) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = null }
})
// Fallback for drops that land on a connector, divider, or empty space rather
// than directly on a row (rows handle — and stopPropagation — their own drops).
el.sceneList.addEventListener('drop', e => {
  e.preventDefault()
  const from = _dragFrom; _dragFrom = null; clearDragOver()
  if (from == null) return
  const rows = [...el.sceneList.querySelectorAll('.scene-item')]
  let target = state.allScenes.length
  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    if (e.clientY <= rect.top + rect.height / 2) { target = Number(row.dataset.flatIndex); break }
    if (e.clientY <= rect.bottom) { target = Number(row.dataset.flatIndex) + 1; break }
  }
  moveSceneTo(from, target)
})

let _sceneMenuEl = null
function closeSceneMenu() {
  if (_sceneMenuEl) { _sceneMenuEl.remove(); _sceneMenuEl = null; document.removeEventListener('click', closeSceneMenu) }
}
function openSceneMenu(flatIndex, anchor) {
  closeSceneMenu()
  const scene = state.allScenes[flatIndex]
  if (!scene) return
  const kind = scene.sceneRef.kind
  const items = []
  if (kind === 'master' || kind === 'custom') items.push([scene.skip ? 'Unskip' : 'Skip', () => toggleSkip(flatIndex)])
  if (kind === 'custom') items.push(['Rename', () => renameScene(flatIndex)])
  items.push(['Duplicate', () => duplicateScene(flatIndex)])
  // Our own scenes can only be skipped, never deleted — Delete is for content
  // the customer added themselves (uploads, duplicates, blackouts).
  if (kind !== 'master') items.push(['Delete', () => deleteScene(flatIndex)])

  const menu = document.createElement('div')
  menu.className = 'scene-menu'
  items.forEach(([label, fn]) => {
    const b = document.createElement('button')
    b.className = 'scene-menu-item' + (label === 'Delete' ? ' danger' : '')
    b.textContent = label
    b.addEventListener('click', e => { e.stopPropagation(); closeSceneMenu(); fn() })
    menu.appendChild(b)
  })
  document.body.appendChild(menu)
  const r = anchor.getBoundingClientRect()
  menu.style.top = `${Math.round(r.bottom + 4)}px`
  menu.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 160))}px`
  _sceneMenuEl = menu
  setTimeout(() => document.addEventListener('click', closeSceneMenu), 0)
}

// Upload the director's own video(s) as new independent scenes. Reuses the
// existing import-video picker (copies files into VIDEOS_DIR, which the media
// server already serves). Inserted after the current scene; videos always loop.
async function uploadScene() {
  if (isEditLocked() || !state.showId) return
  const files = await window.showrunner.importVideo()
  if (!files || !files.length) return
  await pushUndo()
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  layout.customScenes = layout.customScenes || {}
  let at = state.backdropIndex >= 0 ? state.backdropIndex + 1 : state.allScenes.length
  for (const f of files) {
    const id = 'cs-' + crypto.randomUUID()
    const name = f.name || 'Uploaded Scene'
    const cs = {
      id, origin: 'upload', sourceSceneId: null, createdAt: new Date().toISOString(),
      name, renamable: true,
      backdrop: { file: f.filename, label: name, repeat: false, trigger: '' },
      lighting: { cues: [] }, mti_pages: null, dissolveOverride: null,
    }
    layout.customScenes[id] = cs
    state.allScenes.splice(at, 0, flattenCustomScene(cs)); at++
  }
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel(); scrollSceneIntoView(at - 1)
}

// Upload the director's own still image(s) as new scenes. Stills always HOLD —
// they display until the operator hits B — and never loop.
async function uploadStill() {
  if (isEditLocked() || !state.showId) return
  const files = await window.showrunner.importStill()
  if (!files || !files.length) return
  await pushUndo()
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  layout.customScenes = layout.customScenes || {}
  let at = state.backdropIndex >= 0 ? state.backdropIndex + 1 : state.allScenes.length
  for (const f of files) {
    const id = 'cs-' + crypto.randomUUID()
    const name = f.name || 'Still'
    const cs = {
      id, origin: 'upload', still: true, sourceSceneId: null, createdAt: new Date().toISOString(),
      name, renamable: true,
      backdrop: { file: f.filename, label: name, repeat: false, trigger: '' },
      lighting: { cues: [] }, mti_pages: null, dissolveOverride: null,
    }
    layout.customScenes[id] = cs
    state.allScenes.splice(at, 0, flattenCustomScene(cs)); at++
  }
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel(); scrollSceneIntoView(at - 1)
}

// Rename an uploaded/duplicated scene (custom scenes only — our scene names are
// read-only). Persists the new name to the overlay.
async function renameScene(flatIndex) {
  if (isEditLocked() || !state.showId) return
  const s = state.allScenes[flatIndex]
  if (!s || s.sceneRef.kind !== 'custom') return
  const next = await showInputModal('Rename this scene', s.name || '')
  if (next == null) return
  await pushUndo()
  const name = next.trim() || s.name
  s.name = name
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  const cs = layout.customScenes?.[s.sceneRef.id]
  if (cs) { cs.name = name; if (cs.backdrop) cs.backdrop.label = name }
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel()
}

// Per-scene dissolve length: override the global dissolve for the transition into
// this scene. Persists to the overlay (master → overrides, custom → the scene).
// Shared by the dissolve connector's "pin"/"reset" actions below.
async function persistSceneDissolveOverride(scene, v) {
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  if (scene.sceneRef.kind === 'master') {
    if (v == null) {
      if (layout.overrides[scene.sceneRef.sceneId]) delete layout.overrides[scene.sceneRef.sceneId].dissolveOverride
    } else {
      layout.overrides[scene.sceneRef.sceneId] = layout.overrides[scene.sceneRef.sceneId] || {}
      layout.overrides[scene.sceneRef.sceneId].dissolveOverride = v
    }
  } else if (scene.sceneRef.kind === 'custom') {
    const cs = layout.customScenes?.[scene.sceneRef.id]; if (cs) cs.dissolveOverride = v
  } else if (scene.sceneRef.kind === 'blackout') {
    const bo = layout.blackouts?.[scene.sceneRef.id]; if (bo) bo.dissolveOverride = v
  }
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
}
// Live-set this scene's dissolve override as its own popover slider is dragged —
// same debounced-save convention as the Color Correction sliders (updates in
// memory immediately, persists to disk shortly after dragging stops).
let _dissolveSaveTimer = null
function setSceneDissolveLive(flatIndex, v) {
  const scene = state.allScenes[flatIndex]
  if (!scene) return
  scene.dissolveOverride = v
  if (_dissolveSaveTimer) clearTimeout(_dissolveSaveTimer)
  _dissolveSaveTimer = setTimeout(() => {
    persistSceneDissolveOverride(scene, v)
    _dissolveSaveTimer = null
  }, 500)
}
async function clearSceneDissolve(flatIndex) {
  if (isEditLocked() || !state.showId) return
  const scene = state.allScenes[flatIndex]
  if (!scene) return
  await pushUndo()
  scene.dissolveOverride = null
  await persistSceneDissolveOverride(scene, null)
  renderSceneList()
}

// Duplicate a scene as a fully independent copy (own id → own color/cues/trigger/
// position). Deep-copies presentation at creation; editing the original later
// never affects the copy and vice-versa.
// Build the next "<base> (Copy N)" name — base strips any existing "(Copy N)"
// suffix so copies-of-copies keep numbering off the original, and N is one past
// the highest existing copy of that base currently in the list.
function nextCopyName(sourceName) {
  const base = String(sourceName || 'Scene').replace(/\s*\(Copy(?:\s+\d+)?\)\s*$/i, '').trim() || 'Scene'
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(Copy\\s+(\\d+)\\)$', 'i')
  let max = 0
  state.allScenes.forEach(s => { const m = (s.name || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) })
  return `${base} (Copy ${max + 1})`
}

async function duplicateScene(flatIndex) {
  if (isEditLocked() || !state.showId) return
  const src = state.allScenes[flatIndex]
  if (!src) return
  // Copying a blackout just inserts another blackout right after it — same
  // action as the Blackout utility button, offered inline for convenience.
  if (src.sceneRef.kind === 'blackout') {
    await pushUndo()
    const id = 'bo-' + crypto.randomUUID()
    const bo = { id, label: 'Blackout', createdAt: new Date().toISOString() }
    state.allScenes.splice(flatIndex + 1, 0, flattenBlackout(bo))
    const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
    layout.blackouts = layout.blackouts || {}
    layout.blackouts[id] = bo
    layout.order = orderFromScenes()
    await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
    renderSceneList(); updateCenterPanel(); updateNextPanel(); scrollSceneIntoView(flatIndex + 1)
    return
  }
  await pushUndo()
  const id = 'cs-' + crypto.randomUUID()
  const copyName = nextCopyName(src.name)
  const cs = {
    id,
    origin: 'duplicate',
    sourceSceneId: src.sceneRef.kind === 'master' ? src.sceneRef.sceneId : (src.sourceSceneId || null),
    createdAt: new Date().toISOString(),
    name: copyName,
    renamable: true,
    backdrop: { file: src.video_file || null, label: copyName, repeat: false, trigger: src.backdrop_trigger || '' },
    lighting: { cues: (src.lighting_cues || []).map(c => ({ ...c })) },
    mti_pages: src.mti_page || null,
    dissolveOverride: null,
  }
  const at = flatIndex + 1
  state.allScenes.splice(at, 0, flattenCustomScene(cs))
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  layout.customScenes = layout.customScenes || {}
  layout.customScenes[id] = cs
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel()
  scrollSceneIntoView(at)
}

// Delete a scene from the running order. Our originals (master) are only removed
// from the order and come back via Reset; the customer's own added/duplicated
// scenes and blackouts are removed outright.
async function deleteScene(flatIndex) {
  if (isEditLocked() || !state.showId) return
  const s = state.allScenes[flatIndex]
  if (!s) return
  if (s.sceneRef.kind === 'master') return  // our own scenes can only be skipped, never deleted
  if (s.sceneRef.kind === 'custom') {
    if (!window.confirm(`Delete "${s.name}"?\n\nThis added/duplicated scene will be removed for good. (Your original show is unaffected — use Reset to Original to restore our scenes.)`)) return
  }
  await pushUndo()
  state.allScenes.splice(flatIndex, 1)
  const fix = i => i > flatIndex ? i - 1 : (i === flatIndex ? -1 : i)
  state.backdropIndex = fix(state.backdropIndex)
  state.lightingIndex = fix(state.lightingIndex)
  const layout = (await window.showrunner.getCustomLayout({ showId: state.showId })) || emptyLayoutClient()
  if (s.sceneRef.kind === 'custom' && layout.customScenes) delete layout.customScenes[s.sceneRef.id]
  if (s.sceneRef.kind === 'blackout' && layout.blackouts) delete layout.blackouts[s.sceneRef.id]
  layout.order = orderFromScenes()
  await window.showrunner.saveCustomLayout({ showId: state.showId, layout })
  renderSceneList(); updateCenterPanel(); updateNextPanel()
}

// ── Scene list ──────────────────────────────────────────────────────────────────
function renderSceneList() {
  if (!state.show) return
  closeSceneMenu()
  closeDissolveConnector()
  el.sceneList.innerHTML = ''
  let lastAct = null
  // Act dividers only make sense while the list is in its original order. Once the
  // director reorders / inserts / removes, we switch to a flat customized list.
  const nat = state.naturalOrderIds || []
  const isNatural = state.allScenes.length === nat.length &&
    state.allScenes.every((s, i) => s.sceneRef.kind === 'master' && s.instanceId === nat[i])
  state.allScenes.forEach((scene, flatIndex) => {
    // Only master scenes carry an act number; custom/blackout entries slot in
    // under the current act without spawning a spurious divider.
    if (isNatural && scene.actNum != null && scene.actNum !== lastAct) {
      const div = document.createElement('div')
      div.className = 'act-divider'
      div.textContent = `Act ${scene.actNum}`
      el.sceneList.appendChild(div)
      lastAct = scene.actNum
    }
    // A connector shows the dissolve length for the transition into `scene`.
    // Skipped scenes never play, so their connector is omitted entirely rather
    // than shown dimmed — the next connector down (above the next scene that
    // actually plays) is the one that matters, and this avoids a decoy control.
    if (!scene.skip) el.sceneList.appendChild(renderDissolveConnector(scene, flatIndex))
    if (state.hideSkipped && scene.skip) return  // row hidden — flatIndex bookkeeping is unaffected
    const item = document.createElement('div')
    item.className = `scene-item${flatIndex === state.backdropIndex ? ' active' : ''}${scene.skip ? ' skipped' : ''}`
    item.dataset.flatIndex = String(flatIndex)  // read by the list-level drop fallback below
    const triggerSnippet = scene.backdrop_trigger
      ? `<div class="scene-trigger">${scene.backdrop_trigger}</div>` : ''
    // mti_page already includes its own "p." (single page) or "pp." (range)
    // prefix from the source cue data — don't add another one on top of it.
    const pageSnippet = scene.mti_page && scene.mti_page !== 'N/A' ? `<div class="scene-page">${escHtml(scene.mti_page)}</div>` : ''
    item.innerHTML = `<div class="scene-name">${escHtml(scene.name)}</div>${triggerSnippet}${pageSnippet}`
    item.addEventListener('click', () => jumpToScene(flatIndex))
    // In Edit Mode: rows are draggable to reorder, and expose a single ⋯ menu.
    if (!isEditLocked()) {
      item.draggable = true
      item.addEventListener('dragstart', e => { _dragFrom = flatIndex; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' })
      item.addEventListener('dragend', () => { item.classList.remove('dragging'); clearDragOver() })
      item.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(item) })
      item.addEventListener('drop', e => {
        e.preventDefault()
        e.stopPropagation()  // handled here — don't let the list-level fallback also fire
        const from = _dragFrom; _dragFrom = null; clearDragOver()
        if (from == null) return
        // Dropping on a row's bottom half means "insert after this row" — without
        // this, there was no way to drop something as the new LAST item, since
        // dropping directly on a row always inserted before it, and no row exists
        // below the last one to drop onto instead.
        const rect = item.getBoundingClientRect()
        const dropAfter = e.clientY > rect.top + rect.height / 2
        moveSceneTo(from, dropAfter ? flatIndex + 1 : flatIndex)
      })

      const menuBtn = document.createElement('button')
      menuBtn.className = 'scene-menu-btn'
      menuBtn.textContent = '⋯'
      menuBtn.title = 'Scene options'
      menuBtn.draggable = false
      menuBtn.addEventListener('click', e => { e.stopPropagation(); openSceneMenu(flatIndex, menuBtn) })
      item.appendChild(menuBtn)
    }
    el.sceneList.appendChild(item)
  })
}

// Thin strip between scene rows showing the dissolve length for the transition
// into `scene`. Read-only in Show Mode; click to open the pin/reset popover
// when unlocked.
function renderDissolveConnector(scene, flatIndex) {
  const row = document.createElement('div')
  row.className = 'dissolve-connector'
  row.textContent = scene.dissolveOverride != null ? `${scene.dissolveOverride}s` : 'Global Dissolve'
  if (!isEditLocked()) {
    row.classList.add('editable')
    row.addEventListener('click', e => { e.stopPropagation(); openDissolveConnector(flatIndex, row) })
  }
  return row
}

let _dissolveConnectorEl = null
function closeDissolveConnector() {
  if (!_dissolveConnectorEl) return
  _dissolveConnectorEl.remove(); _dissolveConnectorEl = null
  document.removeEventListener('click', closeDissolveConnector)
}
// Each connector gets its own independent slider — the global slider at the
// bottom of the app is untouched by this and always shows only itself.
function openDissolveConnector(flatIndex, anchor) {
  closeSceneMenu()
  closeDissolveConnector()
  const scene = state.allScenes[flatIndex]
  if (!scene || isEditLocked()) return

  const effective = scene.dissolveOverride != null ? scene.dissolveOverride : state.dissolveTime

  const menu = document.createElement('div')
  menu.className = 'scene-menu dissolve-popover'

  const label = document.createElement('div')
  label.className = 'dissolve-popover-label'
  label.textContent = 'Scene Dissolve'
  menu.appendChild(label)

  const row = document.createElement('div')
  row.className = 'dissolve-popover-row'
  const slider = document.createElement('input')
  slider.type = 'range'; slider.min = '0.1'; slider.max = '3'; slider.step = '0.1'; slider.value = String(effective)
  const valueLabel = document.createElement('span')
  valueLabel.className = 'dissolve-popover-value'
  valueLabel.textContent = `${parseFloat(effective).toFixed(1)}s`
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value)
    valueLabel.textContent = `${v.toFixed(1)}s`
    anchor.textContent = `${v}s`
    setSceneDissolveLive(flatIndex, v)
    if (!resetBtn) addResetButton()
  })
  row.appendChild(slider); row.appendChild(valueLabel)
  menu.appendChild(row)

  let resetBtn = null
  function addResetButton() {
    resetBtn = document.createElement('button')
    resetBtn.className = 'scene-menu-item'
    resetBtn.textContent = 'Reset to global'
    resetBtn.addEventListener('click', e => { e.stopPropagation(); closeDissolveConnector(); clearSceneDissolve(flatIndex) })
    menu.appendChild(resetBtn)
  }
  if (scene.dissolveOverride != null) addResetButton()

  document.body.appendChild(menu)
  const r = anchor.getBoundingClientRect()
  menu.style.top = `${Math.round(r.bottom + 4)}px`
  menu.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 220))}px`
  _dissolveConnectorEl = menu
  setTimeout(() => document.addEventListener('click', closeDissolveConnector), 0)
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
  // Per-scene dissolve length overrides the global default for the transition
  // INTO this scene; falls back to the global slider when not set.
  const dissolve = scene.dissolveOverride != null ? scene.dissolveOverride : state.dissolveTime
  // Blackout entries have no video — advancing onto one goes to black.
  if (scene.kind === 'blackout') {
    const cmd = { type: 'black', dissolve }
    window.showrunner.sendToLed(cmd); previewCommand(cmd)
    return
  }
  loadColorForScene(state.backdropIndex)
  if (!scene.video_file) return
  const filePath = `${state.folderPath}/${scene.video_file}`
  const cc = getColorForScene(state.backdropIndex)
  // Customer-uploaded filenames can contain # or ? (unlike our own show videos,
  // which always get clean names) — those are URL-structural characters, so a
  // plain file://${filePath} string silently fails to load. toFileUrl() encodes
  // the path correctly.
  const ledSrc = window.showrunner.toFileUrl(filePath)
  const previewSrc = state.mediaPort
    ? `http://127.0.0.1:${state.mediaPort}/${encodeURIComponent(scene.video_file)}`
    : ledSrc
  if (scene.isStill) {
    // Stills hold (no loop) and display in an image layer.
    window.showrunner.sendToLed({ type: 'still', src: ledSrc, dissolve, ...cc })
    previewCommand({ type: 'still', src: previewSrc, dissolve, colorSettings: cc })
  } else {
    window.showrunner.sendToLed({ type: 'play', src: ledSrc, dissolve, loop: true, ...cc })
    previewCommand({ type: 'play', src: previewSrc, dissolve, loop: true, colorSettings: cc })
  }
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

// "Next Up" panel was removed (backdrop/lighting/scene lookahead is already
// visible in the scene queue) — kept as a no-op since many call sites still
// call it after state changes.
function updateNextPanel() {}

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
  // Defensive: on some systems a window's first click after regaining OS focus
  // doesn't hand keyboard focus to the clicked element even though .focus() is
  // called — forcing window-level focus first makes the element-level focus
  // below more reliable.
  window.focus()
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

// Color Correction now stays permanently visible in the right panel — clicking
// the "Color" button just scrolls it into view rather than toggling it.
el.btnColorToggle.addEventListener('click', () => {
  el.colorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

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
// ── Generic input modal (replaces window.prompt, which Electron's Chromium
// build throws on: "prompt() is and will not be supported") ─────────────────
const inputModal = document.getElementById('input-modal')
const inputModalTitle = document.getElementById('input-modal-title')
const inputModalField = document.getElementById('input-modal-field')
const inputModalCancel = document.getElementById('input-modal-cancel')
const inputModalSave = document.getElementById('input-modal-save')
let _inputModalResolve = null

function showInputModal(title, initialValue, opts = {}) {
  return new Promise(resolve => {
    _inputModalResolve = resolve
    inputModalTitle.textContent = title
    inputModalField.type = opts.type || 'text'
    if (opts.min != null) inputModalField.min = opts.min
    if (opts.max != null) inputModalField.max = opts.max
    if (opts.step != null) inputModalField.step = opts.step
    inputModalField.value = initialValue != null ? initialValue : ''
    inputModal.classList.remove('hidden')
    inputModalField.focus()
    inputModalField.select()
  })
}
function closeInputModal(result) {
  inputModal.classList.add('hidden')
  const resolve = _inputModalResolve
  _inputModalResolve = null
  if (resolve) resolve(result)
}
inputModalSave.addEventListener('click', () => closeInputModal(inputModalField.value))
inputModalCancel.addEventListener('click', () => closeInputModal(null))
inputModal.addEventListener('click', e => { if (e.target === inputModal) closeInputModal(null) })
inputModalField.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); closeInputModal(inputModalField.value) }
  if (e.key === 'Escape') { e.preventDefault(); closeInputModal(null) }
})

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
  // Label always names the CURRENT state (not the action a click performs), and
  // both states get their own color — a plain/neutral button reads as "off" by
  // convention, which made the unlocked state look inactive even though it's
  // the one that's actually live.
  el.btnEditModeLock.textContent = locked ? 'Locked' : 'Unlocked'
  if (locked) {
    el.btnEditModeLock.style.background = 'var(--orange)'
    el.btnEditModeLock.style.color = '#fff'
    el.btnEditModeLock.style.borderColor = 'transparent'
  } else {
    el.btnEditModeLock.style.background = 'var(--blue)'
    el.btnEditModeLock.style.color = '#fff'
    el.btnEditModeLock.style.borderColor = 'transparent'
  }
  // Structural actions are only available in Edit Mode (unlocked).
  syncEditModeGates()
}

// Enable/disable every structural (Custom-Mode) control based on the lock.
function syncEditModeGates() {
  const locked = isEditLocked()
  ;[el.btnResetShow, el.btnInsertBlackout, el.btnUploadScene, el.btnUploadStill].forEach(btn => {
    if (!btn) return
    btn.disabled = locked
    btn.style.opacity = locked ? '0.4' : ''
    btn.style.pointerEvents = locked ? 'none' : ''
  })
  // Re-render the scene list so per-row edit controls (Skip, etc.) appear/hide.
  if (state.show) renderSceneList()
}

el.btnEditModeLock.addEventListener('click', () => {
  appSettings.editModeLocked = !appSettings.editModeLocked
  updateEditModeLockBtn(appSettings.editModeLocked)
  window.showrunner.saveAppSettings(appSettings)
})

el.btnInsertBlackout.addEventListener('click', insertBlackout)
el.btnUploadScene.addEventListener('click', uploadScene)
el.btnUploadStill.addEventListener('click', uploadStill)

// Display-only filter — not persisted, resets to "show everything" each launch.
el.btnHideSkipped.addEventListener('click', () => {
  state.hideSkipped = !state.hideSkipped
  el.btnHideSkipped.classList.toggle('active', state.hideSkipped)
  el.btnHideSkipped.textContent = state.hideSkipped ? 'Show Skipped' : 'Hide Skipped'
  renderSceneList()
})

// ── Printable PDF cue sheet ──────────────────────────────────────────────────
// Reflects the CUSTOMIZED running order: sequential numbers (skipped rows struck
// through and marked), blackouts, renamed/added scenes flagged, per-scene
// transition length, MTI pages, trigger/notes, and lighting cues.
function buildCueSheetHtml() {
  const showTitle = state.show?.show?.title || 'SceneCaster Show'
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  let seq = 0
  const rows = state.allScenes.map(s => {
    const isBlackout = s.sceneRef.kind === 'blackout'
    const isCustom = s.sceneRef.kind === 'custom'
    const skipped = !!s.skip
    if (!skipped) seq++
    const numCell = skipped ? '<span class="skip">SKIP</span>' : String(seq)
    const dissolve = s.dissolveOverride != null ? s.dissolveOverride : state.dissolveTime
    const transition = isBlackout ? `${dissolve}s → black` : `${dissolve}s`
    let nameCell
    if (isBlackout) nameCell = '<em>Blackout</em>'
    else if (isCustom) nameCell = `${escHtml(s.name)} <span class="tag">${s.isStill ? 'still' : 'added'}</span>`
    else nameCell = escHtml(s.name)
    const trigger = (s.backdrop_trigger || '').replace(/<br>/g, ' ')  // already sanitized to strong/em/br
    const lighting = (s.lighting_cues || []).map(c => escHtml(c.cue_code || '')).filter(Boolean).join(', ')
    return `<tr class="${skipped ? 'row-skip' : ''}">
      <td class="num">${numCell}</td>
      <td>${nameCell}</td>
      <td class="trig">${trigger}</td>
      <td class="pg">${s.mti_page ? escHtml(String(s.mti_page)) : ''}</td>
      <td class="pg">${transition}</td>
      <td class="lt">${lighting}</td>
    </tr>`
  }).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Arial,sans-serif;color:#111;margin:32px}
    h1{font-size:20px;margin:0 0 2px}
    .sub{color:#666;font-size:12px;margin:0 0 18px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}
    th{background:#f5f5f5;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666}
    td.num{width:34px;color:#888;font-variant-numeric:tabular-nums}
    td.pg{width:78px;white-space:nowrap}
    td.trig{font-style:italic;color:#333}
    .row-skip td{color:#bbb;text-decoration:line-through}
    .row-skip .skip{text-decoration:none;font-style:normal;color:#c0392b;font-weight:700;font-size:10px}
    .tag{display:inline-block;font-size:9px;background:#FF5A0D;color:#fff;border-radius:3px;padding:1px 5px;vertical-align:middle;text-decoration:none;font-style:normal}
    .foot{margin-top:20px;color:#999;font-size:10px;text-align:center}
    tr{page-break-inside:avoid}
  </style></head><body>
    <h1>${escHtml(showTitle)} — Cue Sheet</h1>
    <p class="sub">Generated ${dateStr} · e-llusion media SceneCaster</p>
    <table><thead><tr><th>#</th><th>Scene</th><th>Trigger / Notes</th><th>MTI Pg</th><th>Transition</th><th>Lighting</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="foot">Reflects your customized running order.</p>
  </body></html>`
}

el.btnCueSheet.addEventListener('click', async () => {
  if (!state.allScenes.length) return
  el.btnCueSheet.disabled = true
  const prev = el.btnCueSheet.textContent
  el.btnCueSheet.textContent = 'Saving…'
  const res = await window.showrunner.exportCueSheet(buildCueSheetHtml())
  el.btnCueSheet.textContent = res && res.success ? '✓ Saved' : prev
  setTimeout(() => { el.btnCueSheet.textContent = prev; el.btnCueSheet.disabled = false }, 1500)
})

// ── Reset to Original (full reset — the safety net) ──────────────────────────
el.btnResetShow.addEventListener('click', async () => {
  if (isEditLocked()) return
  if (!state.showId) return
  const ok = window.confirm(
    'Reset to Original?\n\nThis discards ALL customizations for this show — reordering, skipped scenes, blackouts, added or duplicated scenes, and edited triggers — and restores the original show exactly as e-llusion media provided it.\n\nThis cannot be undone.'
  )
  if (!ok) return
  await pushUndo()
  await window.showrunner.resetCustomLayout({ showId: state.showId, mode: 'full' })
  // Re-mount from the (now empty) overlay → back to natural master order.
  await mountShow(state.show, state.folderPath, state.payload, state.daysRemaining, state.showId)
})

// Cmd/Ctrl+Z routed from the app menu: native text undo in a field, else scene undo.
window.showrunner.onMenuUndo(() => {
  const a = document.activeElement
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) {
    document.execCommand('undo')
  } else {
    sceneUndo()
  }
})
// Cmd/Ctrl+Shift+Z routed from the app menu: native text redo in a field, else scene redo.
window.showrunner.onMenuRedo(() => {
  const a = document.activeElement
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) {
    document.execCommand('redo')
  } else {
    sceneRedo()
  }
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
