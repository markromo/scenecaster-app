const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('showrunner', {
  // Correctly percent-encodes a filesystem path into a valid file:// URL —
  // customer-uploaded filenames can contain # or ? (unlike our own show
  // videos, which always get clean names from the production pipeline),
  // and those characters are URL-structural, not plain text: an unescaped
  // # truncates the path at a fragment, ? at a query string. Building the
  // URL with plain string concatenation silently fails to load in that case.
  // (Routed through main via sync IPC — the sandboxed preload's polyfilled
  // require('url') doesn't include pathToFileURL.)
  toFileUrl:       (path)        => ipcRenderer.sendSync('to-file-url-sync', path),
  checkLicense:    ()            => ipcRenderer.invoke('check-license'),
  activateLicense: (token)       => ipcRenderer.invoke('activate-license', token),
  finalizeLicense: (opts)        => ipcRenderer.invoke('finalize-license', opts),
  importVideo:     ()            => ipcRenderer.invoke('import-video'),
  importStill:     ()            => ipcRenderer.invoke('import-still'),
  sendToLed:       (data)        => ipcRenderer.invoke('send-to-led', data),
  saveLightingCue:      (opts)   => ipcRenderer.invoke('save-lighting-cue', opts),
  saveBackdropTrigger:  (opts)   => ipcRenderer.invoke('save-backdrop-trigger', opts),
  startMediaServer:   (folderPath) => ipcRenderer.invoke('start-media-server', folderPath),
  openUrl:            (url)        => ipcRenderer.invoke('open-url', url),
  exportCueSheet:     (html)       => ipcRenderer.invoke('export-cue-sheet', html),
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
  onShowActivate:     (cb)         => ipcRenderer.on('show-activate', () => cb()),
  onMenuUndo:         (cb)         => ipcRenderer.on('menu-undo', () => cb()),
  onMenuRedo:         (cb)         => ipcRenderer.on('menu-redo', () => cb()),
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
