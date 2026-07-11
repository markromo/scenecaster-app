const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// App Store Connect API key — replaces the old Apple-ID keychain-profile auth
// (`--keychain-profile "SceneCaster-Notarize"`). That approach depended on a
// stored keychain item that went missing at least once on this machine for
// unclear reasons (possibly related to its degrading hardware); API-key auth
// reads straight from this file + two IDs instead, with nothing for a flaky
// keychain to silently drop. Key generated at App Store Connect → Users and
// Access → Integrations → Keys (Developer role). The .p8 file lives outside
// this repo — never commit it.
const APPLE_API_KEY_PATH = '/Users/Mark Romo/Documents/SceneCaster Code/AuthKey_MDMV994F72.p8'
const APPLE_API_KEY_ID = 'MDMV994F72'
const APPLE_API_ISSUER_ID = 'ef62f8bd-f373-45d7-8491-754696b06194'

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`)
}

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  const zipPath = path.join(appOutDir, `${appName}.zip`)

  // notarytool only accepts a zip/pkg/dmg, not a raw .app bundle — zip it
  // with ditto (preserves resource forks/symlinks, unlike a plain zip).
  console.log(`\n📦 Zipping app for submission: ${appPath}`)
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' })

  const authArgs = `--key "${APPLE_API_KEY_PATH}" --key-id "${APPLE_API_KEY_ID}" --issuer "${APPLE_API_ISSUER_ID}"`

  console.log(`🍎 Submitting to Apple for notarization...`)
  // Deliberately NOT using notarytool's own --wait here: a long-lived xcrun
  // process crashed with a Bus error mid-wait on this machine once already.
  // Submitting, then polling with short-lived `info` calls, has proven stable.
  const submitOutput = execSync(`xcrun notarytool submit "${zipPath}" ${authArgs}`, { encoding: 'utf8' })
  console.log(submitOutput)
  const idMatch = submitOutput.match(/id:\s*([a-f0-9-]+)/i)
  if (!idMatch) throw new Error('Could not parse submission id from notarytool output')
  const submissionId = idMatch[1]

  console.log(`⏳ Polling submission ${submissionId}...`)
  let status = ''
  for (let i = 0; i < 90; i++) {
    sleep(20000)
    const infoOutput = execSync(`xcrun notarytool info "${submissionId}" ${authArgs}`, { encoding: 'utf8' })
    const statusMatch = infoOutput.match(/status:\s*(.+)/)
    status = statusMatch ? statusMatch[1].trim() : ''
    console.log(`  [${i + 1}] status: ${status}`)
    if (status === 'Accepted' || status === 'Invalid') break
  }

  if (status !== 'Accepted') {
    execSync(`xcrun notarytool log "${submissionId}" ${authArgs}`, { stdio: 'inherit' })
    throw new Error(`Notarization did not succeed — final status: ${status}`)
  }

  console.log('📎 Stapling notarization ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  fs.unlinkSync(zipPath)

  console.log('✅ Notarization complete!\n')
}
