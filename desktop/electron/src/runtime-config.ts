import { app } from "electron";
import fs from "fs";
import path from "path";

export type DesktopRuntimeConfig = {
    appName: string;
    lockedServerMode: boolean;
    autoConnectOnLaunch: boolean;
    server: {
        name: string;
        url: string;
    };
};

const defaultConfig: DesktopRuntimeConfig = {
    appName: "Darna Desktop",
    lockedServerMode: true,
    autoConnectOnLaunch: true,
    server: {
        name: "Production",
        url: "https://darna.lightency.io",
    },
};

let runtimeConfig: DesktopRuntimeConfig | undefined;
let runtimeConfigPath = "";

function normalizeConfig(value: unknown): DesktopRuntimeConfig {
    const partial = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const partialServer =
        typeof partial.server === "object" && partial.server !== null
            ? (partial.server as Record<string, unknown>)
            : ({} as Record<string, unknown>);

    return {
        appName:
            typeof partial.appName === "string" && partial.appName.trim().length > 0
                ? partial.appName.trim()
                : defaultConfig.appName,
        lockedServerMode:
            typeof partial.lockedServerMode === "boolean" ? partial.lockedServerMode : defaultConfig.lockedServerMode,
        autoConnectOnLaunch:
            typeof partial.autoConnectOnLaunch === "boolean"
                ? partial.autoConnectOnLaunch
                : defaultConfig.autoConnectOnLaunch,
        server: {
            name:
                typeof partialServer.name === "string" && partialServer.name.trim().length > 0
                    ? partialServer.name.trim()
                    : defaultConfig.server.name,
            url:
                typeof partialServer.url === "string" && partialServer.url.trim().length > 0
                    ? partialServer.url.trim()
                    : defaultConfig.server.url,
        },
    };
}

function getDefaultConfigPath() {
    return path.join(app.getPath("userData"), "desktop-config.json");
}

async function init() {
    runtimeConfigPath = process.env.WA_DESKTOP_CONFIG_PATH || getDefaultConfigPath();

    let shouldWriteBack = false;
    let loadedValue: unknown = {};

    if (fs.existsSync(runtimeConfigPath)) {
        try {
            loadedValue = JSON.parse(await fs.promises.readFile(runtimeConfigPath, "utf8"));
        } catch (error) {
            console.error("Failed to read desktop runtime config. Falling back to defaults.", error);
            loadedValue = {};
            shouldWriteBack = true;
        }
    } else {
        shouldWriteBack = true;
    }

    runtimeConfig = normalizeConfig(loadedValue);

    if (shouldWriteBack) {
        await fs.promises.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
        await fs.promises.writeFile(runtimeConfigPath, JSON.stringify(runtimeConfig, null, 2), "utf8");
    }
}

function get() {
    if (!runtimeConfig) {
        throw new Error("Runtime config not initialized");
    }
    return runtimeConfig;
}

function getPath() {
    if (!runtimeConfigPath) {
        throw new Error("Runtime config path not initialized");
    }
    return runtimeConfigPath;
}

export default {
    init,
    get,
    getPath,
};

