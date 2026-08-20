const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prospectionDesktop', {
  getConfigStatus: () => ipcRenderer.invoke('secure-config:status'),
  saveConfig: (values) => ipcRenderer.invoke('secure-config:save', values),
});
