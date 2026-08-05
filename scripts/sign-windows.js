const { execFileSync } = require('child_process')
const fs = require('fs')

// SSL.com eSigner cloud code signing (order co-211l741ge6d, issued 2026-08-04).
// Same underlying reason as the Apple API-key approach in notarize.js: this
// machine is Apple Silicon macOS with no Windows VM/Wine, so a USB hardware
// token (which would need a Windows VM just to sign) is off the table.
// CodeSignTool.sh is SSL.com's cross-platform Java CLI — signs via API call.
//
// CodeSignTool itself lives outside this repo: ~/Tools/CodeSignTool/. It has
// to be invoked from inside its own directory (relative jar path), hence the
// cwd option below rather than an absolute path to the .sh file.
//
// Credentials are intentionally NOT read from a file here — pulled from
// environment variables only, same "never hardcode, never commit" treatment
// as APPLE_API_KEY_PATH/LICENSE_PRIVATE_KEY. Mark sets these in his own shell
// (e.g. sourcing a local, gitignored env file) before running `npm run
// build:win`:
//   CODESIGNTOOL_USERNAME, CODESIGNTOOL_PASSWORD,
//   CODESIGNTOOL_CREDENTIAL_ID, CODESIGNTOOL_TOTP_SECRET
const CODESIGNTOOL_DIR = process.env.CODESIGNTOOL_DIR || `${process.env.HOME}/Tools/CodeSignTool`
// Absolute path, not a bare 'java' + PATH override — keg-only brew install
// (not symlinked system-wide on purpose, see setup notes), and relying on
// execFileSync resolving a custom env.PATH for the executable itself is an
// avoidable ambiguity when the exact binary location is already known.
const JAVA_BIN = '/opt/homebrew/opt/openjdk/bin/java'

// electron-builder calls this once per file that needs a Windows signature —
// confirmed by reading app-builder-lib's winPackager.js directly rather than
// assuming: for this project's single x64 NSIS target with no signDlls/
// signExts configured, that's realistically ~2 calls per build (the packaged
// app .exe, then the final NSIS installer .exe), not the dozens that would
// justify the added complexity of queuing files for CodeSignTool's batch_sign
// command instead. Simple per-file `sign` matches electron-builder's actual
// per-call model with no extra moving parts.
exports.sign = async function(configuration) {
  const filePath = configuration.path
  console.log(`\n🔏 Signing (SSL.com eSigner): ${filePath}`)

  const required = ['CODESIGNTOOL_USERNAME', 'CODESIGNTOOL_PASSWORD', 'CODESIGNTOOL_CREDENTIAL_ID', 'CODESIGNTOOL_TOTP_SECRET']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    throw new Error(`Windows code signing failed: missing env var(s) ${missing.join(', ')} — set them before running npm run build:win.`)
  }

  if (!fs.existsSync(`${CODESIGNTOOL_DIR}/CodeSignTool.sh`)) {
    throw new Error(`Windows code signing failed: CodeSignTool.sh not found at ${CODESIGNTOOL_DIR} — see the Windows code signing setup notes.`)
  }

  const outputDir = `${filePath}.signed-tmp`
  fs.mkdirSync(outputDir, { recursive: true })

  let output
  try {
    // Deliberately NOT going through CodeSignTool.sh: that wrapper does
    // `java -jar ... $@` with $@ UNQUOTED (confirmed by reading the script),
    // so any argument containing a space — like this project's own file
    // paths, since the account's home directory is literally "Mark Romo" —
    // gets word-split into multiple broken arguments. Calling the jar
    // directly via execFileSync's argv array sidesteps that bug entirely:
    // no shell is invoked, so nothing re-splits the arguments.
    output = execFileSync(
      JAVA_BIN,
      [
        '-jar', `${CODESIGNTOOL_DIR}/jar/code_sign_tool-1.3.2.jar`,
        'sign',
        `-username=${process.env.CODESIGNTOOL_USERNAME}`,
        `-password=${process.env.CODESIGNTOOL_PASSWORD}`,
        `-credential_id=${process.env.CODESIGNTOOL_CREDENTIAL_ID}`,
        `-totp_secret=${process.env.CODESIGNTOOL_TOTP_SECRET}`,
        `-input_file_path=${filePath}`,
        `-output_dir_path=${outputDir}`,
      ],
      {
        cwd: CODESIGNTOOL_DIR,
        encoding: 'utf8',
      }
    )
  } catch (err) {
    // execFileSync throws on non-zero exit, but CodeSignTool has a real quirk
    // (confirmed during setup): it returns exit code 0 even on an auth
    // failure, so a caught exception here still isn't the only failure path —
    // see the success check below, which is what actually matters.
    fs.rmSync(outputDir, { recursive: true, force: true })
    throw new Error(`Windows code signing failed (CodeSignTool exited non-zero): ${err.message}`)
  }

  console.log(output)

  const signedFile = `${outputDir}/${require('path').basename(filePath)}`
  if (!output.includes('Code signed successfully') || !fs.existsSync(signedFile)) {
    fs.rmSync(outputDir, { recursive: true, force: true })
    throw new Error(`Windows code signing failed — CodeSignTool did not report success for ${filePath}. Output above.`)
  }

  fs.copyFileSync(signedFile, filePath)
  fs.rmSync(outputDir, { recursive: true, force: true })
  console.log(`✅ Signed: ${filePath}`)
}
