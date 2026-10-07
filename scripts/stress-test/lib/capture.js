const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)
const { DISPLAY_INDEX } = require('./config')

// Captures the given display index to a PNG file. Uses the native macOS
// screencapture CLI directly rather than any GUI-automation tool — this
// needs to run unattended for 45-60 minutes without live tool round-trips.
async function captureDisplay(destPath, displayIndex = DISPLAY_INDEX) {
  await execFileAsync('/usr/sbin/screencapture', ['-x', `-D${displayIndex}`, destPath])
  return destPath
}

module.exports = { captureDisplay }
