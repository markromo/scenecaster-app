const path = require('path')
const os = require('os')

module.exports = {
  // Which physical display screencapture should target. MUST be confirmed
  // with calibrate.js's display-index sanity check before trusting this —
  // AppKit's ordering isn't guaranteed to match Electron's screen.getAllDisplays()
  // ordering. 2 is the common case (built-in laptop screen is usually 1).
  DISPLAY_INDEX: 2,

  // Real packaged app binary — NOT `npm start`/`electron .`. Dev mode skips
  // the real license flow (checkLicense()'s !app.isPackaged bypass) and never
  // auto-opens the LED window (main.js gates that whole path on app.isPackaged
  // too), so it can't exercise the real conditions this harness is testing.
  APP_BINARY: '/Applications/SceneCaster.app/Contents/MacOS/SceneCaster',

  // Which show's cues file to read for scene metadata (e.g. "_Cued" seamless-
  // cut detection, see lib/scenes.js). The harness only tests one show at a
  // time; update this if calibration/runs ever target a different show.
  SHOW_ID: 'matilda-jr',

  // Scenes with confirmed high idle-playback motion variance — excluded from
  // divergence-arming the same way "_Cued" scenes are (see lib/scenes.js),
  // but for a different reason: not a seamless-cut artifact, genuine ongoing
  // animation that never settles. "1-1" (Opening Title Scene) has an animated
  // fog/spotlight background that produced anomalously high idle-diff readings
  // across two separate calibration runs (22.62% on 2026-07-17, 13.14% on
  // 2026-07-18) — both times entirely from this one scene, dragging the
  // "normal playback" ceiling right up against the "genuine change" floor and
  // leaving a threshold margin too thin to trust for an unattended 45-60 min
  // run. This scene also recurs throughout a real run (revisited on every
  // F15 reset at wraparound), not just once at start.
  KNOWN_HIGH_VARIANCE_SCENE_IDS: ['1-1'],
  // Same scene(s) as KNOWN_HIGH_VARIANCE_SCENE_IDS, identified by video file
  // instead of scene id. harness.js (unlike calibrate.js) checks live scenes
  // by file, not static-list scene id, since a runtime-inserted duplicate
  // (F13) can sit in front of a flagged scene and invalidate an id-based
  // static-list lookup — confirmed live 2026-07-18 (see lib/scenes.js's
  // isCuedFile comment for the matching duplicate-splicing incident).
  KNOWN_HIGH_VARIANCE_VIDEO_FILES: ['Matilda_Jr_Title_Scene.mp4'],

  CONFIG_DIR: path.join(os.homedir(), '.scenecaster'),
  APP_SUPPORT_DIR: path.join(os.homedir(), 'Library', 'Application Support', 'scenecaster'),
  BACKUP_DIR: path.join(os.homedir(), '.scenecaster-stress-backup'),

  // Set the app's own dissolve slider to this value once at the start of each
  // run (manual setup step) — deadline math below assumes this exact constant,
  // it does not read the app's actual current dissolve setting dynamically.
  FIXED_DISSOLVE_MS: 1000,
  // Absorbs Electron/macOS scheduling jitter, video decode start latency, and
  // screencapture's own capture latency. Widen if calibration shows false
  // divergences on normal playback.
  BUFFER_MS: 3000,
  // How long after a suspected divergence to re-check before declaring it real.
  CONFIRM_DELAY_MS: 3000,

  SCREENSHOT_INTERVAL_MS: 2000,
  RING_BUFFER_MAX_AGE_MS: 2 * 60 * 1000,

  ACTION_INTERVAL_MS: 12000,
  ACTION_JITTER_MS: 3000,
  RAPID_BURST_EVERY_MS: 5 * 60 * 1000,
  RAPID_BURST_COUNT: 8,
  RAPID_BURST_GAP_MS: 200,

  RUN_DURATION_MS: 50 * 60 * 1000, // 50 min per run, inside the requested 45-60 min window
  DRY_RUN_DURATION_MS: 8 * 60 * 1000, // --once is a short verification pass, NOT a full run

  OUTPUT_DIR: path.join(__dirname, '..', 'run-output'),
  CALIBRATION_FILE: path.join(__dirname, '..', 'calibration.json'),
}
