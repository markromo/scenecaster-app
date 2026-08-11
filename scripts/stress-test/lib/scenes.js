const fs = require('fs')
const path = require('path')
const os = require('os')

// Reads the app's own locally-cached cues file (same one the app itself
// reads) and flattens acts->scenes into playback order, matching exactly how
// renderer/app.js builds state.allScenes.
function loadSceneList(showId) {
  const cuesPath = path.join(os.homedir(), '.scenecaster', `cues-${showId}.json`)
  const data = JSON.parse(fs.readFileSync(cuesPath, 'utf8'))
  const scenes = []
  for (const act of data.acts || []) {
    for (const sc of act.scenes || []) {
      scenes.push({ id: sc.id, file: (sc.backdrop && sc.backdrop.file) || null })
    }
  }
  return scenes
}

// "_Cued" is an established naming convention in this show library (confirmed
// here in Matilda Jr, and referenced for Frozen in CLAUDE.md) for a clip split
// into two cueable halves that are meant to cut together with zero visible
// seam — e.g. Matilda_Honey_Classroom_Guilty_Cued.mp4 (ends right after
// "Guilty" is written) -> Matilda_Honey_Classroom_Guilty.mp4 (starts already
// showing it written). Advancing OUT of a "_Cued" scene is expected to
// produce a near-zero pixel diff BY DESIGN, not because anything is stuck.
// Confirmed 2026-07-17: this exact pair produced 0.29% and 0.00% "genuine
// change" calibration readings, which overlapped the normal-playback
// distribution and blocked calibration until identified and excluded here.
function isCuedFile(file) {
  return !!file && /_Cued\.mp4$/i.test(file)
}

// Flags BOTH directions around a "_Cued" scene as low-signal for whole-frame
// diffing:
//   - leaving the "_Cued" scene itself (it ends right where its follow-up
//     clip begins, by design)
//   - leaving the scene BEFORE it, i.e. entering the "_Cued" scene (confirmed
//     2026-07-18: the cued clip's opening frames are themselves a deliberate
//     match-cut against what preceded it — its own visual payoff, e.g. chalk
//     being written, happens later in its runtime than our fixed post-B
//     sampling window, so entering it also reads as a near-zero diff; this
//     produced a 0.30% "genuine change" sample that alone re-triggered the
//     normal/change overlap even after the exit-only exclusion was added)
function buildSeamlessExitSceneIds(scenes) {
  const ids = new Set()
  scenes.forEach((s, i) => {
    if (!isCuedFile(s.file)) return
    ids.add(s.id)
    if (i > 0) ids.add(scenes[i - 1].id)
  })
  return ids
}

module.exports = { loadSceneList, isCuedFile, buildSeamlessExitSceneIds }
