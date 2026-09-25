'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  request: (op, payload = {}) => ipcRenderer.invoke('jarvis:request', op, payload),
  pickSave: (options = {}) => ipcRenderer.invoke('jarvis:pick-save', options),
  pickOpen: (options = {}) => ipcRenderer.invoke('jarvis:pick-open', options),
  openUserData: () => ipcRenderer.invoke('jarvis:open-user-data'),
  restartCore: () => ipcRenderer.invoke('jarvis:restart-core'),
  onCoreStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('jarvis:core-status', listener);
    return () => ipcRenderer.removeListener('jarvis:core-status', listener);
  }
});