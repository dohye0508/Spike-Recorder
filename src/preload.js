'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  start: () => ipcRenderer.invoke('game:start'),
  stop: () => ipcRenderer.invoke('game:stop'),
  saveNames: (names) => ipcRenderer.invoke('hall:saveNames', names),
  reconnect: () => ipcRenderer.invoke('serial:reconnect'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  setSim: (on) => ipcRenderer.invoke('sim:set', on),
  simKey: (key, down) => ipcRenderer.invoke('sim:key', key, down),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
