import { ipcMain, app, desktopCapturer, shell } from "electron";
import electronIsDev from "electron-is-dev";
import path from "path";
import { createAndShowNotification } from "./notification";
import { Server } from "./preload-local-app/types";
import settings, { SettingsData } from "./settings";
import { loadShortcuts, setShortcutsEnabled } from "./shortcuts";
import type { AppViewInsets } from "./window";
import { getAppView, hideAppView, setAppViewInsets, showAppView } from "./window";
import runtimeConfig from "./runtime-config";

export function emitMuteToggle() {
    const currentAppView = getAppView();
    if (!currentAppView) {
        throw new Error("Main window not found");
    }

    currentAppView.webContents.send("app:on-mute-toggle");
}

export function emitCameraToggle() {
    const currentAppView = getAppView();
    if (!currentAppView) {
        throw new Error("Main window not found");
    }

    currentAppView.webContents.send("app:on-camera-toggle");
}

function isLockedServerMode() {
    return runtimeConfig.get().lockedServerMode;
}

function toResultFromOpenPathResult(result: string) {
    if (result && result.length > 0) {
        return new Error(result);
    }
    return true;
}

function parseAppViewInsets(value: unknown): Partial<AppViewInsets> {
    if (!value || typeof value !== "object") {
        return {};
    }

    const input = value as Record<string, unknown>;
    const insets: Partial<AppViewInsets> = {};
    const entries: Array<keyof AppViewInsets> = ["top", "right", "bottom", "left"];

    for (const key of entries) {
        const rawValue = input[key];
        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            insets[key] = rawValue;
        }
    }

    return insets;
}

export default () => {
    ipcMain.handle("is-development", () => electronIsDev);
    ipcMain.handle("get-version", () => (electronIsDev ? "dev" : app.getVersion()));

    ipcMain.on("app:notify", (_event, txt: string) => {
        createAndShowNotification({ body: txt });
    });

    ipcMain.handle("app:getDesktopCapturerSources", async (_event, options: Electron.SourcesOptions) => {
        return (await desktopCapturer.getSources(options)).map((source) => ({
            id: source.id,
            name: source.name,
            thumbnailURL: source.thumbnail.toDataURL(),
        }));
    });

    ipcMain.handle("local-app:showLocalApp", () => {
        hideAppView();
    });

    ipcMain.handle("local-app:getDesktopConfig", () => {
        const config = runtimeConfig.get();
        return {
            ...config,
            configPath: runtimeConfig.getPath(),
        };
    });

    ipcMain.handle("local-app:connectConfiguredServer", async () => {
        const config = runtimeConfig.get();
        await showAppView(config.server.url);
        return true;
    });

    ipcMain.handle("local-app:setAppViewInsets", (_event, insets: unknown) => {
        setAppViewInsets(parseAppViewInsets(insets));
    });

    ipcMain.handle("local-app:openDesktopConfigFile", async () => {
        return toResultFromOpenPathResult(await shell.openPath(runtimeConfig.getPath()));
    });

    ipcMain.handle("local-app:openDesktopConfigFolder", async () => {
        return toResultFromOpenPathResult(await shell.openPath(path.dirname(runtimeConfig.getPath())));
    });

    ipcMain.handle("local-app:getServers", () => {
        return settings.get("servers");
    });

    ipcMain.handle("local-app:selectServer", async (_event, serverId: string) => {
        if (isLockedServerMode()) {
            return new Error("Server selection is disabled in locked server mode");
        }

        const servers = settings.get("servers") || [];
        const selectedServer = servers.find((s) => s._id === serverId);

        if (!selectedServer) {
            return new Error("Server not found");
        }

        await showAppView(selectedServer.url);
        return true;
    });

    ipcMain.handle("local-app:addServer", (_event, server: Omit<Server, "_id">) => {
        if (isLockedServerMode()) {
            return new Error("Adding servers is disabled in locked server mode");
        }

        const servers = settings.get("servers") || [];
        const newServer = {
            ...server,
            _id: `${Date.now()}-${servers.length + 1}`,
        };
        servers.push(newServer);
        settings.set("servers", servers);
        return newServer;
    });

    ipcMain.handle("local-app:removeServer", (_event, serverId: string) => {
        if (isLockedServerMode()) {
            return new Error("Removing servers is disabled in locked server mode");
        }

        const servers = settings.get("servers") || [];
        settings.set(
            "servers",
            servers.filter((s) => s._id !== serverId)
        );
        return true;
    });

    ipcMain.handle("local-app:reloadShortcuts", () => loadShortcuts());

    ipcMain.handle("local-app:getSettings", () => settings.get() || {});
    ipcMain.handle(
        "local-app:saveSetting",
        <T extends keyof SettingsData>(_event: Electron.IpcMainInvokeEvent, key: T, value: SettingsData[T]) =>
            settings.set(key, value)
    );

    ipcMain.handle("local-app:setShortcutsEnabled", (_event, enabled: boolean) => setShortcutsEnabled(enabled));
};
