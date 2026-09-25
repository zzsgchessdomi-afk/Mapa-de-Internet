const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvis', {
  invoke: (op, args = {}) => ipcRenderer.invoke('jarvis:invoke', op, args),
  state: () => ipcRenderer.invoke('jarvis:backend-state'),
  openLog: () => ipcRenderer.invoke('jarvis:open-log'),
  onEvent: (fn) => ipcRenderer.on('jarvis:event', (_e, payload) => fn(payload))
});
