'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  getSetupState: () => ipcRenderer.invoke('setup:get-state'),
  chooseShareDirectory: () => ipcRenderer.invoke('setup:choose-share-directory'),
  completeSetup: (setup) => ipcRenderer.invoke('setup:complete', setup),
  getDesktopState: () => ipcRenderer.invoke('desktop:get-state'),
  copyLanAddress: () => ipcRenderer.invoke('desktop:copy-lan-address'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
});

contextBridge.exposeInMainWorld('nasDesktop', desktopApi);
