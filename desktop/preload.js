const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prospectionDesktop', {
  getConfigStatus: () => ipcRenderer.invoke('secure-config:status'),
  saveConfig: (values) => ipcRenderer.invoke('secure-config:save', values),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:collect'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
});
