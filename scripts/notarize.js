const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

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

  console.log(`🍎 Submitting to Apple for notarization...`)
  execSync(
    `xcrun notarytool submit "${zipPath}" --keychain-profile "SceneCaster-Notarize" --wait`,
    { stdio: 'inherit' }
  )

  console.log('📎 Stapling notarization ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  fs.unlinkSync(zipPath)

  console.log('✅ Notarization complete!\n')
}
