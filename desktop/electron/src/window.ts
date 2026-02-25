import { BrowserView, BrowserWindow, app } from "electron";
import electronIsDev from "electron-is-dev";
import windowStateKeeper from "electron-window-state";
import path from "path";
import { loadCustomScheme } from "./serve";
import type { AppViewStatusEvent } from "./preload-local-app/types";

let mainWindow: BrowserWindow | undefined;
let appView: BrowserView | undefined;
let appViewUrl = "";
let appViewAttached = false;
let lastAppViewBounds: { x: number; y: number; width: number; height: number } | undefined;

type AppViewInsets = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

const appViewInsets: AppViewInsets = {
    top: 72,
    right: 0,
    bottom: 0,
    left: 0,
};

function isIgnorableLoadUrlError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.includes("ERR_ABORTED") || message.includes("(-3)");
}

function isMeaningfulLoadedUrl(url: string | undefined) {
    if (!url) {
        return false;
    }

    const normalized = url.trim().toLowerCase();
    if (normalized.length === 0) {
        return false;
    }

    if (normalized === "about:blank") {
        return false;
    }

    if (normalized.startsWith("chrome-error://")) {
        return false;
    }

    return true;
}

export function getWindow() {
    return mainWindow;
}

export function getAppView() {
    return appView;
}

function emitAppViewStatus(status: AppViewStatusEvent) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send("local-app:appViewStatus", status);
}

export function setAppViewInsets(nextInsets: Partial<AppViewInsets>) {
    Object.assign(appViewInsets, nextInsets);
    resizeAppView();
}

function resizeAppView() {
    setTimeout(() => {
        if (!mainWindow || !appView) {
            return;
        }

        let { width, height } = mainWindow.getContentBounds();
        if (width <= 0 || height <= 0) {
            const windowBounds = mainWindow.getBounds();
            width = windowBounds.width;
            height = windowBounds.height;
        }

        const nextBounds = {
            x: appViewInsets.left,
            y: appViewInsets.top,
            width: Math.max(0, width - appViewInsets.left - appViewInsets.right),
            height: Math.max(0, height - appViewInsets.top - appViewInsets.bottom),
        };

        if (nextBounds.width <= 0 || nextBounds.height <= 0) {
            if (lastAppViewBounds) {
                appView.setBounds(lastAppViewBounds);
            }
            setTimeout(resizeAppView, 50);
            return;
        }

        lastAppViewBounds = nextBounds;
        appView.setBounds(nextBounds);
    });
}

export async function createWindow() {
    if (mainWindow) {
        return;
    }

    const windowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800,
        maximize: true,
    });

    mainWindow = new BrowserWindow({
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.resolve(__dirname, "..", "dist", "preload-local-app", "preload.js"),
        },
    });
    mainWindow.setMenu(null);

    windowState.manage(mainWindow);

    mainWindow.on("closed", () => {
        mainWindow = undefined;
    });

    mainWindow.on("show", resizeAppView);
    mainWindow.on("maximize", resizeAppView);
    mainWindow.on("unmaximize", resizeAppView);
    mainWindow.on("restore", resizeAppView);
    mainWindow.on("enter-full-screen", resizeAppView);
    mainWindow.on("leave-full-screen", resizeAppView);

    appView = new BrowserView({
        webPreferences: {
            preload: path.resolve(__dirname, "..", "dist", "preload-app", "preload.js"),
        },
    });
    const createdAppView = appView;

    createdAppView.webContents.on("did-finish-load", () => {
        if (!appViewAttached) {
            return;
        }
        const currentUrl = createdAppView.webContents.getURL();
        if (!isMeaningfulLoadedUrl(currentUrl)) {
            return;
        }
        emitAppViewStatus({ state: "loaded", url: currentUrl });
    });

    createdAppView.webContents.on(
        "did-fail-load",
        (_event, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
            if (!appViewAttached) {
                return;
            }
            if (!isMainFrame || errorCode === -3) {
                return;
            }
            emitAppViewStatus({
                state: "error",
                url: validatedURL,
                errorCode,
                errorDescription,
            });
        }
    );

    resizeAppView();
    createdAppView.setAutoResize({ width: true, height: true });
    mainWindow.on("resize", resizeAppView);

    mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
        resizeAppView();
    });

    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow?.setTitle("WorkAdventure Desktop (alpha release)");
    });

    if (electronIsDev && process.env.LOCAL_APP_URL) {
        await mainWindow.loadURL(process.env.LOCAL_APP_URL);
    } else {
        await loadCustomScheme(mainWindow);
        await mainWindow.loadURL("app://-");
    }
}

export async function showAppView(url?: string) {
    if (!appView) {
        throw new Error("App view not found");
    }

    if (!mainWindow) {
        throw new Error("Main window not found");
    }

    if (mainWindow.getBrowserView()) {
        mainWindow.removeBrowserView(appView);
    }
    mainWindow.addBrowserView(appView);
    appViewAttached = true;
    resizeAppView();

    if (url && url !== appViewUrl) {
        emitAppViewStatus({ state: "loading", url });
        appViewUrl = url;
        try {
            await appView.webContents.loadURL(url);
        } catch (error) {
            if (!isIgnorableLoadUrlError(error)) {
                throw error;
            }
        }
        resizeAppView();
    } else {
        emitAppViewStatus({
            state: "loaded",
            url: appView.webContents.getURL() || url || appViewUrl,
        });
        resizeAppView();
    }

    appView.webContents.focus();
}

export function hideAppView() {
    if (!appView) {
        throw new Error("App view not found");
    }

    if (!mainWindow) {
        throw new Error("Main window not found");
    }

    appViewAttached = false;
    try {
        mainWindow.removeBrowserView(appView);
    } catch {
        // Ignore if the view is already detached.
    }

    emitAppViewStatus({
        state: "hidden",
        url: appView.webContents.getURL(),
    });
}
