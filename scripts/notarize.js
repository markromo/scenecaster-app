const { execSync } = require('child_process')
const path = require('path')

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)

  console.log(`\n🍎 Submitting app directly to Apple for notarization: ${appPath}`)
  execSync(
    `xcrun notarytool submit "${appPath}" --keychain-profile "SceneCaster-Notarize" --wait`,
    { stdio: 'inherit' }
  )

  console.log('📎 Stapling notarization ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  console.log('✅ Notarization complete!\n')
}
