#!/usr/bin/env node
// Main stress-test orchestrator. See the project plan
// (SceneCaster Code/showrunner-build/scripts/stress-test — built 2026-07-17)
// for full design rationale. Usage:
//   node harness.js --run-all [runCount]     # full multi-run session (what run-all.sh calls)
//   node harness.js --once                   # single run, no wipe/restore cycling (for the manual dry run)
const fs = require('fs')
const path = require('path')
const os = require('os')
const readline = require('readline')
const { spawn, execSync } = require('child_process')
const { captureDisplay } = require('./lib/capture')
const { diffPercent } = require('./lib/diff')
const { sendKey, establishFocus } = require('./lib/keys')
const { isCuedFile } = require('./lib/scenes')
const cfg = require('./lib/config')

// Low-signal-by-video-file check — deliberately NOT scene-id/static-list
// based (see ShowState.parseLine's videoFile comment for why: a runtime F13
// duplicate spliced in front of a flagged scene invalidates any id-based
// lookup keyed to the static master-cues order, confirmed live 2026-07-18).
function isLowSignalVideoFile(file) {
  return isCuedFile(file) || cfg.KNOWN_HIGH_VARIANCE_VIDEO_FILES.includes(file)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = q => new Promise(resolve => rl.question(q, resolve))
const sleep = ms => new Promise(r => setTimeout(r, ms))

function loadCalibration() {
  if (!fs.existsSync(cfg.CALIBRATION_FILE)) {
    console.error(`\n❌ ${cfg.CALIBRATION_FILE} not found. Run calibrate.js first — the harness refuses to guess a threshold.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(cfg.CALIBRATION_FILE, 'utf8'))
}

// ── Parses [stress-test] log lines to know exactly where playback is ─────────
class ShowState {
  constructor() { this.index = null; this.total = null; this.atLast = false; this.kind = 'scene'; this.sceneId = null; this.videoFile = null }
  parseLine(line) {
    // Separate, unconditional line (renderer/app.js's playCurrentBackdrop,
    // fired for every scene including duplicates/blackouts) — read directly
    // via regex rather than the generic key=value split below, since its
    // name="..." field can contain spaces and would otherwise corrupt token
    // splitting. This is what makes the low-signal-scene check below robust
    // to runtime scene-graph mutation (F13 duplicates spliced into the
    // queue): it identifies scenes by their actual video file, not by
    // position in the static master-cues list, which a spliced-in duplicate
    // would silently invalidate. Confirmed live 2026-07-18: a duplicate
    // landed directly in front of a "_Cued" scene, and the old sceneId/
    // static-list-based check couldn't see it coming.
    const vfMatch = line.match(/\[scene-change\] requested:.*video_file=(\S+)/)
    if (vfMatch) this.videoFile = vfMatch[1]

    const marker = '[stress-test]'
    const at = line.indexOf(marker)
    if (at === -1) return false
    const rest = line.slice(at + marker.length).trim()
    const kv = {}
    for (const token of rest.split(/\s+/)) {
      const eq = token.indexOf('=')
      if (eq > -1) kv[token.slice(0, eq)] = token.slice(eq + 1)
    }
    if (kv.index != null) {
      this.index = parseInt(kv.index, 10)
      this.total = parseInt(kv.total, 10)
      // Derived from index/total (always present) rather than trusting the
      // optional atLast field in the log line — the blackout/no-video log
      // variants don't include atLast at all, and trusting an absent field
      // would silently reset this to false even while still at the last scene.
      this.atLast = this.index >= this.total - 1
      this.kind = kv.kind || 'scene'
      // Only present on the main scene-change log line, not the blackout/
      // no-video variants — don't overwrite a known sceneId with undefined.
      if (kv.sceneId != null) this.sceneId = kv.sceneId
    }
    return true
  }
}

// ── Rolling screenshot buffer — "just before X" reference frames on demand ──
class RingBuffer {
  constructor(maxAgeMs) { this.maxAgeMs = maxAgeMs; this.frames = [] }
  add(filePath, ts) {
    this.frames.push({ filePath, ts })
    const cutoff = ts - this.maxAgeMs
    while (this.frames.length > 1 && this.frames[0].ts < cutoff) {
      const old = this.frames.shift()
      try { fs.unlinkSync(old.filePath) } catch {}
    }
  }
  latest() { return this.frames[this.frames.length - 1] || null }
}

// ── Rolling in-memory log tail, for evidence context only (never the trigger) ─
class LogTail {
  constructor(max = 200) { this.max = max; this.lines = [] }
  push(line) { this.lines.push(line); if (this.lines.length > this.max) this.lines.shift() }
  last(n = 50) { return this.lines.slice(-n) }
}

function wipeAppState() {
  fs.rmSync(cfg.CONFIG_DIR, { recursive: true, force: true })
  fs.rmSync(cfg.APP_SUPPORT_DIR, { recursive: true, force: true })
}

function restoreLicenseAndVideos() {
  fs.mkdirSync(cfg.CONFIG_DIR, { recursive: true })
  fs.cpSync(path.join(cfg.BACKUP_DIR, 'license.enc'), path.join(cfg.CONFIG_DIR, 'license.enc'))
  fs.cpSync(path.join(cfg.BACKUP_DIR, 'videos'), path.join(cfg.CONFIG_DIR, 'videos'), { recursive: true })
}

async function ensureBackupExists() {
  const licBackup = path.join(cfg.BACKUP_DIR, 'license.enc')
  const vidBackup = path.join(cfg.BACKUP_DIR, 'videos')
  if (fs.existsSync(licBackup) && fs.existsSync(vidBackup)) {
    console.log(`✅ Found existing backup at ${cfg.BACKUP_DIR} — reusing it (skipping fresh activation/download).`)
    return
  }
  console.log('\n=== One-time bootstrap: need a real license activation + full download ===')
  console.log(`No backup found at ${cfg.BACKUP_DIR}.`)
  console.log('Launch SceneCaster normally now, activate a real license, and let the full show download.')
  console.log('Also: leave the app in Edit Mode (not Show Mode) before continuing.')
  await ask('Press Enter once the app is fully downloaded and idle at the player screen... ')

  const lic = path.join(cfg.CONFIG_DIR, 'license.enc')
  const vids = path.join(cfg.CONFIG_DIR, 'videos')
  if (!fs.existsSync(lic) || !fs.existsSync(vids)) {
    throw new Error(`Expected ${lic} and ${vids} to exist after activation — one or both missing. Check the app actually activated/downloaded.`)
  }
  fs.mkdirSync(cfg.BACKUP_DIR, { recursive: true })
  fs.cpSync(lic, licBackup)
  fs.cpSync(vids, vidBackup, { recursive: true })
  console.log(`✅ Backed up license + videos to ${cfg.BACKUP_DIR}.`)

  console.log('\nQuit SceneCaster now (Cmd+Q) so the harness can relaunch it cleanly for the wipe cycle.')
  await ask('Press Enter once it has fully quit... ')
}

function spawnApp(logStream, showState, logTail) {
  const child = spawn(cfg.APP_BINARY, [], {
    env: { ...process.env, SCENECASTER_STRESS_TEST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const onData = buf => {
    const text = buf.toString()
    logStream.write(text)
    for (const line of text.split('\n')) {
      if (!line) continue
      logTail.push(line)
      showState.parseLine(line)
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  return child
}

// The app never autoplays — it deliberately sits at "position -1, waiting for
// the operator to press B" after mounting (confirmed live: a fresh launch
// just shows the ready screen indefinitely). No [stress-test] log line is
// ever emitted until something actually calls playCurrentBackdrop(), so
// passively waiting for one hangs forever regardless of timeout — the harness
// has to be the one to fire that first B, the same way a real operator would.
//
// Retries the whole focus+B sequence rather than trusting one fixed delay:
// confirmed live (2026-07-17) that Electron startup time (license check +
// local video-cache scan + window creation) varies enough that a single
// fixed wait before the first attempt was unreliable — one run mounted fine,
// the next timed out with identical code. Each attempt re-establishes focus
// (cheap, and re-clicking never hurts) rather than assuming the first click
// is still good several seconds later.
// Confirmed via extensive live testing (2026-07-17): synthetic AppleScript
// clicks reliably establish real keyboard focus on the operator window
// SOMETIMES, but not reproducibly — tried activate-by-name, activate-by-PID,
// window-level focus, a synthetic click, longer settle delays, and genuinely
// separate process invocations matching the one pattern that had worked
// before, and still hit silent failures with no clear pattern. Given this
// only matters ONCE per run (the very first B press — every subsequent
// action during the actual run is sent by this same harness and works
// reliably once real focus is established, confirmed throughout calibration),
// it's not worth more engineering time chasing full automation of this one
// moment. A human clicking once is a five-second ask, not a burden.
async function bootstrapShow(showState, timeoutMs = 120000) {
  console.log('\n>>> Click into the video preview area of the SceneCaster window, then press B once. <<<')
  await ask('Press Enter here once you have clicked and pressed B... ')

  const start = Date.now()
  while (showState.index === null) {
    if (Date.now() - start > timeoutMs) throw new Error('Show still hasn\'t responded — was B actually pressed after clicking into the window?')
    await sleep(500)
  }
}

function saveEvidence(runDir, action, referencePath, failingPath, showState, logTail, diffPct, threshold) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(runDir, 'evidence', ts)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(referencePath, path.join(dir, 'reference.png'))
  fs.copyFileSync(failingPath, path.join(dir, 'failing.png'))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    timestamp: ts,
    action,
    sceneIndex: showState.index,
    sceneTotal: showState.total,
    diffPercent: diffPct,
    thresholdPercent: threshold,
    recentLog: logTail.last(50),
  }, null, 2))
  console.log(`\n🚨 DIVERGENCE CONFIRMED — evidence saved to ${dir}`)
  return dir
}

// ── One run's main loop ───────────────────────────────────────────────────────
async function runOneSession(runDir, calibration, durationMs) {
  fs.mkdirSync(runDir, { recursive: true })
  const shotsDir = path.join(runDir, 'shots')
  fs.mkdirSync(shotsDir, { recursive: true })
  const logStream = fs.createWriteStream(path.join(runDir, 'console.log'))

  const showState = new ShowState()
  const logTail = new LogTail()
  const ring = new RingBuffer(cfg.RING_BUFFER_MAX_AGE_MS)

  console.log(`Spawning ${cfg.APP_BINARY} ...`)
  const child = spawnApp(logStream, showState, logTail)
  let screenshotTimer = null

  // Everything below is wrapped in try/finally so the spawned app is always
  // killed on the way out — including on a thrown error. Confirmed live
  // (2026-07-17) why this matters: an earlier version only killed the child
  // in the success path, so a thrown error left it running orphaned with its
  // stdout pipe now pointing nowhere; the app's own console-forwarding code
  // (main.js's attachConsoleForwarding) then hit an uncaught EPIPE writing to
  // that dead pipe and crashed for real, a genuine app-level crash caused
  // entirely by this harness's own cleanup bug, not a bug in SceneCaster.
  try {
    // Startup delay for Electron launch + license check + local-cache mount
    // to settle. Deliberately generous — see bootstrapShow's own retry loop
    // for why a single fixed wait isn't trusted to be enough on its own.
    console.log('Waiting for app startup...')
    await sleep(10000)
    await bootstrapShow(showState)
    console.log(`✅ Show mounted — index=${showState.index} total=${showState.total}`)

    let isBlack = false
    let stopped = false
    let evidenceDir = null
    let shotCounter = 0

    // Baseline screenshot timer — independent of action state
    screenshotTimer = setInterval(async () => {
    if (stopped) return
    try {
      const p = path.join(shotsDir, `shot-${shotCounter++}.png`)
      await captureDisplay(p)
      ring.add(p, Date.now())
    } catch (e) {
      console.error('[stress-test-harness] screenshot failed:', e.message)
    }
  }, cfg.SCREENSHOT_INTERVAL_MS)

  async function fireActionAndCheck(actionName, keyName) {
    // "post-burst-check" is special: the ring buffer's most recent screenshot
    // (up to RING_BUFFER's own ~2s-old entry) can be stale relative to the
    // burst's own tight 200ms-paced, unchecked B/F13/F14 presses that just
    // ran — confirmed live 2026-07-18: this produced a genuine low diff
    // (2.59%) that turned out to span TWO different duplicate scenes of the
    // same underlying video (a legitimate "same file" case, per the check
    // below) plus an intervening blackout the ring-buffer-based "pre" frame
    // never actually captured, because it predated several burst actions.
    // Capture a fresh screenshot here instead of trusting the ring buffer, so
    // "pre" reflects what's actually on screen right now, after the burst
    // settles — the correct semantic for validating this ONE final checked
    // B press specifically, not everything the burst did before it.
    let pre
    if (actionName === 'post-burst-check') {
      const freshPrePath = path.join(shotsDir, `pre-${actionName}-${Date.now()}.png`)
      await captureDisplay(freshPrePath)
      pre = { filePath: freshPrePath, ts: Date.now() }
    } else {
      pre = ring.latest()
    }
    // Captured before sendKey — reflects the scene/kind we're about to leave.
    // Read into locals, not re-read later: showState keeps advancing as the
    // app's own log lines stream in, so reading it again after the fact
    // would reflect the WRONG (post-transition) scene in these checks.
    const preKind = showState.kind
    const preVideoFile = showState.videoFile
    // The harness's OWN manual/button-triggered blackout (SPACE) has no
    // corresponding [stress-test] log line in app.js — confirmed live
    // 2026-07-18: unlike a queue-inserted blackout, it never touches
    // state.backdropIndex, so showState.kind/videoFile stay stale at
    // whatever the last REAL scene was, even though the LED is genuinely
    // black right now. Using the harness's own isBlack flag (ground truth —
    // this function only reaches a resume-from-blackout call while it's
    // still true) instead of trying to parse another ad-hoc log line.
    const preManualBlack = isBlack
    await sendKey(keyName)
    const firedAt = Date.now()
    await sleep(cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS)
    const postPath = path.join(shotsDir, `check-${actionName}-${firedAt}.png`)
    await captureDisplay(postPath)

    if (!pre) { console.warn('[stress-test-harness] no reference frame available yet, skipping check'); return }

    // Low-signal-by-video-file, checked on BOTH ends (leaving OR arriving) —
    // a "_Cued" seamless-cut or a KNOWN_HIGH_VARIANCE_VIDEO_FILES entry (see
    // lib/scenes.js / lib/config.js) is expected to produce a near-zero pixel
    // diff by design, so arming a check here would misfire against
    // legitimate content, not a freeze. Checking the file directly (not
    // scene id / static-list position) is what makes this robust to a
    // runtime-inserted F13 duplicate sitting in front of a flagged scene —
    // confirmed live 2026-07-18: a duplicate landed directly in front of a
    // "_Cued" scene and a static-list-based check missed it entirely.
    if (keyName === 'B' && (isLowSignalVideoFile(preVideoFile) || isLowSignalVideoFile(showState.videoFile))) {
      console.log(`[stress-test-harness] low-signal video file on one end (pre="${preVideoFile}" post="${showState.videoFile}") — skipping divergence check`)
      return
    }
    // Same underlying video file on both ends — not restricted to
    // "post-duplicate-advance-1"/F13's immediate follow-up: confirmed live
    // 2026-07-18 that an ORDINARY "advance" action can also walk straight
    // from an original scene into its own earlier-created duplicate (or vice
    // versa), any time later in the run — duplicated scenes persist in the
    // custom-layout queue for the rest of the session by design, so this can
    // recur on a random future wraparound loop, not just right after F13
    // fires. Keying the exclusion off actual content (same file) rather than
    // a specific action name catches every case, not just the first one.
    if (keyName === 'B' && preVideoFile != null && preVideoFile === showState.videoFile) {
      console.log(`[stress-test-harness] same video file on both ends ("${preVideoFile}") — skipping divergence check, identical content by design`)
      return
    }
    // Black on BOTH ends of an action is visually identical by design, solid
    // black to solid black — not a freeze. "Black" on the pre side means
    // EITHER a queue blackout-kind scene OR the harness's own manual/button
    // blackout (preManualBlack) — confirmed live 2026-07-18 three times: a B
    // press landing on consecutive F14-inserted blackout entries, the
    // deliberate SPACE/blackout action firing while already on a
    // blackout-kind scene, and (this one) a resume-from-blackout B press
    // landing on a queue blackout entry right after a manual SPACE blackout
    // (whose absence of any [stress-test] log line was what made preKind
    // read stale as non-blackout in the first place). Not restricted to
    // keyName === 'B' for the queue-to-queue case. Deliberately checks BOTH
    // ends — black -> a REAL scene must stay armed regardless of key, since
    // a stuck blackout (LED failing to un-black) is exactly the kind of real
    // bug this harness exists to catch.
    if ((preKind === 'blackout' || preManualBlack) && showState.kind === 'blackout') {
      console.log('[stress-test-harness] black on both ends (queue blackout and/or manual blackout) — skipping divergence check, visually identical by design')
      return
    }

    let pct = diffPercent(pre.filePath, postPath)
    if (pct >= calibration.thresholdPercent) return // genuine change seen, all good

    // Below threshold — confirm before declaring a divergence (guards against
    // a slow dissolve or a one-off capture glitch, not a real freeze).
    await sleep(cfg.CONFIRM_DELAY_MS)
    const confirmPath = path.join(shotsDir, `confirm-${actionName}-${firedAt}.png`)
    await captureDisplay(confirmPath)
    pct = diffPercent(pre.filePath, confirmPath)
    if (pct >= calibration.thresholdPercent) return // caught up — false alarm

    evidenceDir = saveEvidence(runDir, actionName, pre.filePath, confirmPath, showState, logTail, pct, calibration.thresholdPercent)
    stopped = true
  }

  async function actionTick() {
    if (stopped) return

    // Wraparound: known no-op by design, not a freeze. Reset instead of checking.
    if (showState.atLast) {
      console.log('[stress-test-harness] at last scene — firing reset (F15), not arming a check')
      await sendKey('F15')
      isBlack = false
      return
    }

    if (isBlack) {
      // Must resume via B (or the reset shortcut), never a second Space press.
      console.log('[stress-test-harness] resuming from blackout via B')
      await fireActionAndCheck('resume-from-blackout', 'B')
      isBlack = false
      return
    }

    const roll = Math.random()
    if (roll < 0.55) {
      await fireActionAndCheck('advance', 'B')
    } else if (roll < 0.70) {
      console.log('[stress-test-harness] blackout')
      await fireActionAndCheck('blackout', 'SPACE')
      isBlack = true
    } else if (roll < 0.85) {
      console.log('[stress-test-harness] duplicate-scene, then 2 follow-up B presses')
      await sendKey('F13') // no LED command sent at insert time — nothing to check here
      await sleep(500)
      await fireActionAndCheck('post-duplicate-advance-1', 'B')
      if (!stopped) await fireActionAndCheck('post-duplicate-advance-2', 'B')
    } else {
      console.log('[stress-test-harness] insert-blackout-to-queue, then 2 follow-up B presses')
      await sendKey('F14')
      await sleep(500)
      await fireActionAndCheck('post-insert-blackout-advance-1', 'B')
      if (!stopped) await fireActionAndCheck('post-insert-blackout-advance-2', 'B')
    }
  }

  const sessionStart = Date.now()
  let lastBurstAt = sessionStart

  while (!stopped && Date.now() - sessionStart < durationMs) {
    const jitter = (Math.random() * 2 - 1) * cfg.ACTION_JITTER_MS
    await sleep(Math.max(1000, cfg.ACTION_INTERVAL_MS + jitter))
    if (stopped) break

    if (Date.now() - lastBurstAt >= cfg.RAPID_BURST_EVERY_MS) {
      console.log(`[stress-test-harness] rapid-fire burst (${cfg.RAPID_BURST_COUNT} actions, ${cfg.RAPID_BURST_GAP_MS}ms apart, no dissolve wait)`)
      lastBurstAt = Date.now()
      for (let i = 0; i < cfg.RAPID_BURST_COUNT && !stopped; i++) {
        if (showState.atLast) { await sendKey('F15'); isBlack = false; continue }
        const pick = Math.random()
        if (pick < 0.34) await sendKey('B')
        else if (pick < 0.67) await sendKey('F13')
        else await sendKey('F14')
        await sleep(cfg.RAPID_BURST_GAP_MS)
      }
      // One normal, checked action right after the burst to see if anything broke.
      if (!stopped) await fireActionAndCheck('post-burst-check', 'B')
      continue
    }

      await actionTick()
    }

    return { divergence: stopped, evidenceDir }
  } finally {
    if (screenshotTimer) clearInterval(screenshotTimer)
    child.kill()
    logStream.end()
  }
}

async function runAll(runCount, startFrom = 1) {
  await ensureBackupExists()
  fs.mkdirSync(cfg.OUTPUT_DIR, { recursive: true })
  const calibration = loadCalibration()

  for (let i = startFrom; i <= runCount; i++) {
    console.log(`\n\n========== RUN ${i}/${runCount} ==========`)
    wipeAppState()
    restoreLicenseAndVideos()
    console.log('State wiped and license/videos restored. Confirm the app will start in Edit Mode (not Show Mode) —')
    console.log('app-settings.json was just wiped, so any lock preference reset to default.')
    await ask('Press Enter to launch and start this run... ')

    const runDir = path.join(cfg.OUTPUT_DIR, `run${i}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    const result = await runOneSession(runDir, calibration, cfg.RUN_DURATION_MS)

    if (result.divergence) {
      console.log(`\n🚨 Run ${i} halted on a confirmed divergence. Evidence: ${result.evidenceDir}`)
      console.log('Per plan, the session stops here for review rather than continuing to the next run.')
      rl.close()
      return
    }
    console.log(`✅ Run ${i} completed the full ${cfg.RUN_DURATION_MS / 60000} min with no confirmed divergence.`)
  }
  console.log(`\n✅ All ${runCount} runs completed with no confirmed divergence.`)
  rl.close()
}

async function runOnce() {
  const calibration = loadCalibration()
  fs.mkdirSync(cfg.OUTPUT_DIR, { recursive: true })
  const runDir = path.join(cfg.OUTPUT_DIR, `manual-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  console.log('Manual single run — assumes the app is already installed with a valid license/videos in place.')
  console.log('Confirm the app is NOT currently running (harness will spawn its own instance).')
  await ask('Press Enter to launch and start... ')
  console.log(`This is a short verification pass (${cfg.DRY_RUN_DURATION_MS / 60000} min), not a full run.`)
  const result = await runOneSession(runDir, calibration, cfg.DRY_RUN_DURATION_MS)
  console.log(result.divergence ? `Divergence found: ${result.evidenceDir}` : 'No divergence found.')
  rl.close()
}

const args = process.argv.slice(2)
if (args.includes('--run-all')) {
  const idx = args.indexOf('--run-all')
  const n = parseInt(args[idx + 1], 10)
  // --from lets a session resume from a specific run number instead of
  // always restarting at 1 — added 2026-07-18 after several full-session
  // restarts to re-verify already-passed runs against a one-line fix in a
  // later run cost more real time than the re-verification was worth. Only
  // use this once earlier runs have already passed clean under the current
  // code; it does not re-check them.
  const fromIdx = args.indexOf('--from')
  const from = fromIdx > -1 ? parseInt(args[fromIdx + 1], 10) : 1
  runAll(Number.isFinite(n) ? n : 4, Number.isFinite(from) ? from : 1).catch(e => { console.error(e); process.exit(1) })
} else if (args.includes('--once')) {
  runOnce().catch(e => { console.error(e); process.exit(1) })
} else {
  console.log('Usage: node harness.js --run-all [runCount] | --once')
  process.exit(1)
}
