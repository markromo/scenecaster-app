const fs = require('fs')
const { PNG } = require('pngjs')
const pixelmatch = require('pixelmatch')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execFileAsync = promisify(execFile)

// screencapture produces PNGs directly; pngjs reads them as-is. If dimensions
// ever mismatch between two captures (e.g. display mode changed mid-run),
// treat that as a hard error rather than silently comparing garbage.
function readPng(filePath) {
  return PNG.sync.read(fs.readFileSync(filePath))
}

// Returns a 0-100 percentage of differing pixels between two PNG files.
function diffPercent(pathA, pathB) {
  const a = readPng(pathA)
  const b = readPng(pathB)
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Frame size mismatch: ${pathA} is ${a.width}x${a.height}, ${pathB} is ${b.width}x${b.height}`)
  }
  const diffPixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 })
  return (diffPixels / (a.width * a.height)) * 100
}

// ImageMagick cross-check, used only during calibration (not in the per-action
// hot path — spawning a subprocess per diff adds latency/jitter we don't want
// in timing-sensitive deadline checks). Returns AE (absolute error pixel count)
// normalized to a percentage, for comparison against the pixelmatch number.
async function diffPercentImageMagick(pathA, pathB) {
  try {
    await execFileAsync('/opt/ImageMagick/bin/compare', ['-metric', 'AE', pathA, pathB, '/dev/null'])
    return 0 // identical — compare exits 0 with AE=0 printed to stderr
  } catch (e) {
    // compare exits non-zero when images differ, printing the AE pixel count to stderr
    const match = /^(\d+)/.exec((e.stderr || '').trim())
    if (!match) throw new Error(`Could not parse ImageMagick compare output: ${e.stderr}`)
    const a = readPng(pathA)
    return (parseInt(match[1], 10) / (a.width * a.height)) * 100
  }
}

module.exports = { diffPercent, diffPercentImageMagick }
