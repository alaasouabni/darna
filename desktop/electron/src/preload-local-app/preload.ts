import { contextBridge, ipcRenderer } from "electron";
import type { WorkAdventureLocalAppApi } from "./types";

const api: WorkAdventureLocalAppApi = {
    desktop: true,
    isDevelopment: () => ipcRenderer.invoke("is-development"),
    getVersion: () => ipcRenderer.invoke("get-version"),
    showLocalApp: () => ipcRenderer.invoke("local-app:showLocalApp"),
    getDesktopConfig: () => ipcRenderer.invoke("local-app:getDesktopConfig"),
    connectConfiguredServer: () => ipcRenderer.invoke("local-app:connectConfiguredServer"),
    setAppViewInsets: (insets) => ipcRenderer.invoke("local-app:setAppViewInsets", insets),
    onAppViewStatus: (callback) => {
        const listener = (_event: unknown, status: unknown) => {
            callback(status as Parameters<typeof callback>[0]);
        };
        ipcRenderer.on("local-app:appViewStatus", listener);
        return () => {
            ipcRenderer.removeListener("local-app:appViewStatus", listener);
        };
    },
    openDesktopConfigFile: () => ipcRenderer.invoke("local-app:openDesktopConfigFile"),
    openDesktopConfigFolder: () => ipcRenderer.invoke("local-app:openDesktopConfigFolder"),
    getServers: () => ipcRenderer.invoke("local-app:getServers"),
    selectServer: (serverId) => ipcRenderer.invoke("local-app:selectServer", serverId),
    addServer: (server) => ipcRenderer.invoke("local-app:addServer", server),
    removeServer: (serverId) => ipcRenderer.invoke("local-app:removeServer", serverId),
    reloadShortcuts: () => ipcRenderer.invoke("local-app:reloadShortcuts"),
    getSettings: () => ipcRenderer.invoke("local-app:getSettings"),
    saveSetting: (key, value) => ipcRenderer.invoke("local-app:saveSetting", key, value),
    setShortcutsEnabled: (enabled) => ipcRenderer.invoke("local-app:setShortcutsEnabled", enabled),
};

contextBridge.exposeInMainWorld("WAD", api);
