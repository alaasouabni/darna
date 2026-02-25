import type {
    WorkAdventureLocalAppApi,
    SettingsData,
    Server,
    DesktopLocalRuntimeConfig,
    AppViewStatusEvent,
} from "@wa-preload-local-app";

export { WorkAdventureLocalAppApi, SettingsData, Server, DesktopLocalRuntimeConfig, AppViewStatusEvent };

export const api = window?.WAD;
