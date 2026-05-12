const { execSync } = require('child_process')
const path = require('path')

exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  const zipPath = '/tmp/SceneCaster-notarize.zip'

  console.log(`\n📦 Zipping app for notarization: ${appPath}`)
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`)

  console.log('🍎 Submitting to Apple for notarization (this takes a few minutes)...')
  execSync(
    `xcrun notarytool submit "${zipPath}" --keychain-profile "SceneCaster-Notarize" --wait`,
    { stdio: 'inherit' }
  )

  console.log('📎 Stapling notarization ticket to app...')
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' })

  console.log('✅ Notarization complete!\n')
}
