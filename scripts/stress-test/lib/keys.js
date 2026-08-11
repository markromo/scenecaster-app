const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

// macOS virtual key codes for the keys this harness needs. `keystroke "b"`
// would also work for a plain letter, but the F13-F15 debug shortcuts have no
// direct AppleScript keystroke form, so everything goes through `key code`
// for consistency.
const KEY_CODES = {
  B: 11,
  SPACE: 49,
  F13: 105,
  F14: 107,
  F15: 113,
}

// Confirmed via direct testing (2026-07-17): `key code` sends to whatever
// app is frontmost, NOT to SceneCaster specifically. Without explicitly
// activating it first, every keystroke silently went to whatever else had
// focus (e.g. the terminal/Claude desktop app) — the app never saw a single
// B press, and 30 "genuine change" calibration samples came back
// indistinguishable from normal-playback noise as a direct result. Always
// activate by name first, every call — cheap, and this is exactly the kind
// of thing to never assume still holds from one call to the next.
async function sendKey(name) {
  const code = KEY_CODES[name]
  if (code == null) throw new Error(`Unknown key: ${name}`)
  const script = `tell application "SceneCaster" to activate\ntell application "System Events" to key code ${code}`
  await execFileAsync('/usr/bin/osascript', ['-e', script])
}

// Confirmed via direct testing (2026-07-17): `activate` alone (by app name OR
// by targeting the specific window via System Events' "set focused of window")
// brings SceneCaster's PROCESS to the front, but does NOT give its operator
// window real keyboard focus — key events kept going nowhere even with the
// app confirmed frontmost. The app has a second window (the always-on-top LED
// output) that appears to retain key-window status by default. Only an actual
// synthetic mouse click breaks this — confirmed working via a click inside the
// video preview box, a safe target since it's an inert <video>/<img> display,
// not a button. Call this ONCE per app launch, before the first sendKey() —
// focus persists across subsequent keystrokes without needing to re-click.
async function establishFocus() {
  const script = `
tell application "SceneCaster" to activate
delay 0.3
tell application "System Events"
  tell process "SceneCaster"
    click at {700, 400}
  end tell
end tell
delay 1`
  await execFileAsync('/usr/bin/osascript', ['-e', script])
}

module.exports = { sendKey, establishFocus, KEY_CODES }
