const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    getKubeConfig: () => ipcRenderer.invoke('get-kubeconfig'),
    setContext: (contextName) => ipcRenderer.invoke('set-context', contextName),
    k8sApi: (request) => ipcRenderer.invoke('k8s-api', request)
  }
); 