#!/usr/bin/env node
// Calibration pass — run once before real stress testing, with the app
// already running, showing a real show, LED window genuinely fullscreen on
// the external display, and left sitting untouched (no keys pressed) for the
// normal-playback sampling phase. See scripts/stress-test/README section in
// the project plan for the full walkthrough; this script prints prompts as
// it goes so it can be run interactively without a separate doc.
const fs = require('fs')
const readline = require('readline')
const { captureDisplay } = require('./lib/capture')
const { diffPercent, diffPercentImageMagick } = require('./lib/diff')
const { sendKey } = require('./lib/keys')
const { loadSceneList, buildSeamlessExitSceneIds } = require('./lib/scenes')
const cfg = require('./lib/config')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = q => new Promise(resolve => rl.question(q, resolve))
const sleep = ms => new Promise(r => setTimeout(r, ms))

const TMP_DIR = '/tmp/scenecaster-stress-calibrate'

function stats(nums) {
  const min = Math.min(...nums), max = Math.max(...nums)
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return { min, max, mean, stdev: Math.sqrt(variance) }
}

// Confirmed live 2026-07-18: calibration run against a long-lived app instance
// (already advanced partway through the show from earlier testing, carrying
// extra duplicate/blackout scenes from earlier F13/F14 testing) produced two
// compounding failures — Step 3's local index-tracking started from the wrong
// scene (not actually scene 0), AND a stale/heavily-exercised instance showed
// genuine intermittent failures sending F15 (confirmed via direct [stress-test]
// log comparison: F15 fired reliably twice in a row immediately after a fresh
// relaunch + click + B, but silently produced zero effect on the old instance).
// A fresh launch each time calibration runs avoids both classes of failure —
// cheap enough to just require it rather than try to detect/recover from either.
async function requireFreshLaunch() {
  console.log('\n=== Step 0: fresh app launch required ===')
  console.log('Calibration depends on knowing the show starts at scene 0 — a long-lived app')
  console.log('instance left over from earlier testing can silently throw this off (confirmed')
  console.log('2026-07-18: it also correlated with F15 intermittently failing to register).')
  console.log('\nQuit SceneCaster if it is running (Cmd+Q), relaunch it fresh, then click once into')
  console.log('the video preview area and press B once — same as the harness bootstrap step.')
  await ask('Press Enter once you have done this... ')
}

async function displaySanityCheck() {
  console.log('\n=== Step 1: display index sanity check ===')
  console.log('Confirm the LED window is genuinely fullscreen on the external display right now.')
  await ask('Press Enter when ready... ')
  fs.mkdirSync(TMP_DIR, { recursive: true })
  for (const idx of [1, 2]) {
    const p = `${TMP_DIR}/display-check-${idx}.png`
    await captureDisplay(p, idx)
    console.log(`Captured display ${idx} -> ${p}`)
  }
  console.log(`\nOpen both display-check-1.png and display-check-2.png in ${TMP_DIR} and confirm`)
  console.log('which one actually shows the TV/projector (the LED output), not the operator screen.')
  const answer = await ask('Which display index shows the external/LED output? (1 or 2): ')
  const idx = parseInt(answer.trim(), 10)
  if (idx !== 1 && idx !== 2) throw new Error('Expected 1 or 2')
  if (idx !== cfg.DISPLAY_INDEX) {
    console.log(`\n⚠️  lib/config.js has DISPLAY_INDEX=${cfg.DISPLAY_INDEX} but you confirmed it's actually ${idx}.`)
    console.log(`Update DISPLAY_INDEX in lib/config.js to ${idx} before continuing, then re-run calibrate.js.`)
    process.exit(1)
  }
  console.log(`✅ Confirmed — display ${idx} is the external/LED output, matches lib/config.js.`)
}

async function sampleNormalPlayback(n = 30, perScene = 5) {
  console.log(`\n=== Step 2: ${n} normal-playback pairs, across ${Math.ceil(n / perScene)} different scenes ===`)
  console.log(`Sampling ${perScene} pairs per scene, then advancing (B) to the next — different scenes can have`)
  console.log('very different natural motion levels (confirmed: one scene measured ~0.2%, another ~1.5-2.3%),')
  console.log("so a threshold calibrated against only one scene wouldn't generalize. No manual key presses needed.")

  // requireFreshLaunch() guarantees index 0 here. Skip past any scene flagged
  // KNOWN_HIGH_VARIANCE_SCENE_IDS (see lib/config.js) before sampling it —
  // otherwise this step just re-measures the exact scene (the animated Title
  // Scene) that's already known to blow out the normal-playback ceiling.
  const sceneList = loadSceneList(cfg.SHOW_ID)
  let index = 0
  async function skipPastHighVarianceScenes() {
    while (cfg.KNOWN_HIGH_VARIANCE_SCENE_IDS.includes(sceneList[index].id)) {
      console.log(`  [skip] scene ${sceneList[index].id} is known high-variance — advancing past it before sampling`)
      await sendKey('B')
      index++
      await sleep(cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS + 2000)
    }
  }
  await skipPastHighVarianceScenes()

  const diffs = []
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % perScene === 0) {
      await sendKey('B')
      index++
      // Generous settle margin, not just FIXED_DISSOLVE_MS+BUFFER_MS — confirmed
      // live that a shorter delay here let the tail end of the dissolve itself
      // leak into the first "normal" sample (one outlier read 12.93%, wildly
      // above every other normal-playback sample), which would have corrupted
      // the whole distribution this step exists to establish.
      await sleep(cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS + 2000)
      await skipPastHighVarianceScenes()
    }
    const a = `${TMP_DIR}/normal-${i}-a.png`
    const b = `${TMP_DIR}/normal-${i}-b.png`
    await captureDisplay(a)
    await sleep(2000)
    await captureDisplay(b)
    const pct = diffPercent(a, b)
    diffs.push(pct)
    process.stdout.write(`  [${i + 1}/${n}] ${pct.toFixed(2)}%\n`)
    await sleep(1500)
  }
  return { diffs, endIndex: index }
}

async function sampleGenuineChanges(startIndex, n = 30) {
  console.log(`\n=== Step 3: ${n} genuine-change pairs (B-key transitions) ===`)
  console.log(`Firing B every few seconds and measuring the diff at firedAt + ${cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS}ms.`)
  console.log('Make sure the show has at least 30 advanceable scenes, or this will hit wraparound — watch the operator window.')
  await ask('Press Enter when ready... ')

  // "_Cued" scenes (see lib/scenes.js) are deliberate seamless cuts — advancing
  // out of one is expected to read near-0% by design, which would otherwise
  // get sampled here as a "genuine change" and corrupt the distribution.
  // Confirmed 2026-07-17: this exact gap produced a 0.29%/0.00% overlap with
  // normal-playback and blocked calibration until excluded here.
  const sceneList = loadSceneList(cfg.SHOW_ID)
  // Union of "_Cued" seamless-cut scenes and scenes with confirmed high idle
  // variance (see lib/config.js's KNOWN_HIGH_VARIANCE_SCENE_IDS) — both are
  // known low-signal-to-noise transitions, excluded from the sampled/counted
  // distribution the same way.
  const seamlessExitIds = new Set([...buildSeamlessExitSceneIds(sceneList), ...cfg.KNOWN_HIGH_VARIANCE_SCENE_IDS])

  // Seeded from Step 2's actual ending position, not a hardcoded guess — Step 2
  // can now fire extra B presses of its own to skip past high-variance scenes,
  // so the position after it varies and can't be assumed to be a fixed index.
  let index = startIndex

  const diffs = []
  let skipped = 0
  while (diffs.length < n) {
    if (index >= sceneList.length - 1) {
      console.log('  [reset] reached end of show — firing F15 to loop back to scene 0')
      await sendKey('F15')
      await sleep(cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS + 1000)
      index = 0
    }
    const leavingId = sceneList[index].id
    const seamlessExit = seamlessExitIds.has(leavingId)

    const pre = `${TMP_DIR}/change-${diffs.length}-pre.png`
    const post = `${TMP_DIR}/change-${diffs.length}-post.png`
    await captureDisplay(pre)
    await sendKey('B')
    index++
    await sleep(cfg.FIXED_DISSOLVE_MS + cfg.BUFFER_MS)
    await captureDisplay(post)

    if (seamlessExit) {
      skipped++
      console.log(`  [skip] leaving known "_Cued" seamless-cut scene ${leavingId} — not counted (near-zero diff expected by design)`)
      await sleep(1000)
      continue
    }

    const pct = diffPercent(pre, post)
    diffs.push(pct)
    process.stdout.write(`  [${diffs.length}/${n}] ${pct.toFixed(2)}%\n`)
    await sleep(1000)
  }
  console.log(`(${skipped} known seamless-cut transition(s) skipped, not counted)`)
  return diffs
}

async function main() {
  await requireFreshLaunch()
  await displaySanityCheck()
  const { diffs: normal, endIndex } = await sampleNormalPlayback()
  const change = await sampleGenuineChanges(endIndex)
  rl.close()

  const normalStats = stats(normal)
  const changeStats = stats(change)

  console.log('\n=== Results ===')
  console.log('Normal playback (no action):', normalStats)
  console.log('Genuine change (B press):  ', changeStats)

  if (normalStats.max >= changeStats.min) {
    console.log('\n⚠️  DISTRIBUTIONS OVERLAP — do not pick a threshold and proceed anyway.')
    console.log('Whole-frame percentage-diff may not discriminate well enough for this footage.')
    console.log('Consider: cropping to a region of interest, a perceptual-hash metric, or more confirmation samples.')
    console.log('calibration.json was NOT written. Fix this before running the real harness.')
    process.exit(1)
  }

  const margin = (changeStats.min - normalStats.max) * 0.3
  const threshold = normalStats.max + margin

  const calibration = {
    generatedAt: new Date().toISOString(),
    displayIndex: cfg.DISPLAY_INDEX,
    normalStats,
    changeStats,
    thresholdPercent: threshold,
  }
  fs.writeFileSync(cfg.CALIBRATION_FILE, JSON.stringify(calibration, null, 2))
  console.log(`\n✅ Distributions don't overlap. Threshold set to ${threshold.toFixed(2)}%.`)
  console.log(`Wrote ${cfg.CALIBRATION_FILE}`)
}

main().catch(e => { console.error('Calibration failed:', e); process.exit(1) })
