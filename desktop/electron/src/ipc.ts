import { ipcMain, app, desktopCapturer } from "electron";
import electronIsDev from "electron-is-dev";
import { createAndShowNotification } from "./notification";
import settings, { SettingsData } from "./settings";
import { loadShortcuts, setShortcutsEnabled } from "./shortcuts";
import { getAppView, hideAppView, showAppView } from "./window";
// import fetch from "node-fetch";

export function emitMuteToggle() {
    const appView = getAppView();
    if (!appView) {
        throw new Error("Main window not found");
    }

    appView.webContents.send("app:on-mute-toggle");
}

export function emitCameraToggle() {
    const appView = getAppView();
    if (!appView) {
        throw new Error("Main window not found");
    }

    appView.webContents.send("app:on-camera-toggle");
}

export default () => {
    ipcMain.handle("is-development", () => electronIsDev);
    ipcMain.handle("get-version", () => (electronIsDev ? "dev" : app.getVersion()));

    // app ipc
    ipcMain.on("app:notify", (event, txt: string) => {
        createAndShowNotification({ body: txt });
    });

    ipcMain.handle("app:getDesktopCapturerSources", async (event, options: Electron.SourcesOptions) => {
        return (await desktopCapturer.getSources(options)).map((source) => ({
            id: source.id,
            name: source.name,
            thumbnailURL: source.thumbnail.toDataURL(),
        }));
    });

    // local-app ipc
    ipcMain.handle("local-app:showLocalApp", () => {
        hideAppView();
    });

    ipcMain.handle("local-app:getServers", () => {
        return settings.get("servers");
    });

    ipcMain.handle("local-app:selectServer", async (event, serverId: string) => {
        const servers = settings.get("servers") || [];
        const selectedServer = servers.find((s) => s._id === serverId);

        if (!selectedServer) {
            return new Error("Server not found");
        }

        await showAppView(selectedServer.url);
        return true;
    });

    ipcMain.handle("local-app:addServer", () => {
        throw new Error("Adding servers is disabled in this desktop build.");
    });

    ipcMain.handle("local-app:removeServer", () => {
        throw new Error("Removing servers is disabled in this desktop build.");
    });

    ipcMain.handle("local-app:reloadShortcuts", (event) => loadShortcuts());

    ipcMain.handle("local-app:getSettings", (event) => settings.get() || {});
    ipcMain.handle(
        "local-app:saveSetting",
        <T extends keyof SettingsData>(event: Electron.IpcMainInvokeEvent, key: T, value: SettingsData[T]) =>
            settings.set(key, value)
    );

    ipcMain.handle("local-app:setShortcutsEnabled", (event, enabled: boolean) => setShortcutsEnabled(enabled));
};
