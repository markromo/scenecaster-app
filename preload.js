const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('showrunner', {
  checkLicense:    ()            => ipcRenderer.invoke('check-license'),
  activateLicense: (token)       => ipcRenderer.invoke('activate-license', token),
  finalizeLicense: (opts)        => ipcRenderer.invoke('finalize-license', opts),
  getVideos:       ()            => ipcRenderer.invoke('get-videos'),
  loadShowFolder:  ()            => ipcRenderer.invoke('load-show-folder'),
  importVideo:     ()            => ipcRenderer.invoke('import-video'),
  getVideoDataUrl: (path)        => ipcRenderer.invoke('get-video-data-url', path),
  sendToLed:       (data)        => ipcRenderer.invoke('send-to-led', data),
  saveLightingCue:      (opts)   => ipcRenderer.invoke('save-lighting-cue', opts),
  saveBackdropTrigger:  (opts)   => ipcRenderer.invoke('save-backdrop-trigger', opts),
  startMediaServer:   (folderPath) => ipcRenderer.invoke('start-media-server', folderPath),
  openUrl:            (url)        => ipcRenderer.invoke('open-url', url),
  fetchManifest:      ()           => ipcRenderer.invoke('fetch-manifest'),
  getDownloadStatus:  ()           => ipcRenderer.invoke('get-download-status'),
  downloadFile:       (opts)       => ipcRenderer.invoke('download-file', opts),
  loadBundledShow:    (packId)     => ipcRenderer.invoke('load-bundled-show', packId),
  loadColorSettings:  ()           => ipcRenderer.invoke('load-color-settings'),
  saveColorSettings:  (data)       => ipcRenderer.invoke('save-color-settings', data),
  getCustomLayout:    (opts)       => ipcRenderer.invoke('get-custom-layout', opts),
  saveCustomLayout:   (opts)       => ipcRenderer.invoke('save-custom-layout', opts),
  resetCustomLayout:  (opts)       => ipcRenderer.invoke('reset-custom-layout', opts),
  onLedCommand:       (cb)         => ipcRenderer.on('led-command', (_, data) => cb(data)),
  onKeepAlive:        (cb)         => ipcRenderer.on('keep-alive', () => cb()),
  ledVideoReady:      ()           => ipcRenderer.send('led-video-ready'),
  onShowActivate:     (cb)         => ipcRenderer.on('show-activate', () => cb()),
  openLedWindow:      ()           => ipcRenderer.invoke('open-led-window'),
  onNoExternalDisplay:(cb)         => ipcRenderer.on('no-external-display', () => cb()),
  onLedWindowReady:   (cb)         => ipcRenderer.on('led-window-ready', () => cb()),
  getAppSettings:     ()           => ipcRenderer.invoke('get-app-settings'),
  saveAppSettings:    (data)       => ipcRenderer.invoke('save-app-settings', data),
  onDownloadProgress: (cb)         => {
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.on('download-progress', (_, data) => cb(data))
  },
})
