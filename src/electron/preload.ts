import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('bulbNative', {
  chooseProject: (): Promise<string | null> => ipcRenderer.invoke('bulb:choose-project'),
  capture: (): Promise<string> => ipcRenderer.invoke('bulb:capture'),
  notify: (n: { id: string; title: string; body: string }): void => ipcRenderer.send('bulb:notify', n),
  daemonLost: (): void => ipcRenderer.send('bulb:daemon-lost'),
  onNotificationClick: (cb: (id: string) => void): void => { ipcRenderer.on('bulb:notification-click', (_e, id: string) => cb(id)); },
});
