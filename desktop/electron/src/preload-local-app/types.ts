export type Server = {
    _id: string;
    name: string;
    url: string;
};

export type SettingsData = {
    log_level: "error" | "warn" | "info" | "verbose" | "debug" | "silly";
    auto_launch_enabled: boolean;
    servers: Server[];
    shortcuts: Record<"mute_toggle" | "camera_toggle", string>;
};

export type AppViewInsets = {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
};

export type DesktopLocalRuntimeConfig = {
    appName: string;
    lockedServerMode: boolean;
    autoConnectOnLaunch: boolean;
    configPath: string;
    server: {
        name: string;
        url: string;
    };
};

export type AppViewStatusEvent = {
    state: "hidden" | "loading" | "loaded" | "error";
    url?: string;
    errorCode?: number;
    errorDescription?: string;
};

export type WorkAdventureLocalAppApi = {
    desktop: boolean;
    isDevelopment: () => Promise<boolean>;
    getVersion: () => Promise<string>;
    showLocalApp: () => Promise<void>;
    getDesktopConfig: () => Promise<DesktopLocalRuntimeConfig>;
    connectConfiguredServer: () => Promise<Error | boolean>;
    setAppViewInsets: (insets: AppViewInsets) => Promise<void>;
    onAppViewStatus: (callback: (status: AppViewStatusEvent) => void) => () => void;
    openDesktopConfigFile: () => Promise<Error | boolean>;
    openDesktopConfigFolder: () => Promise<Error | boolean>;
    getServers: () => Promise<Server[]>;
    selectServer: (serverId: string) => Promise<Error | boolean>;
    addServer: (server: Omit<Server, "_id">) => Promise<Server | Error>;
    removeServer: (serverId: Server["_id"]) => Promise<Error | boolean>;
    reloadShortcuts: () => Promise<void>;
    getSettings: () => Promise<SettingsData>;
    saveSetting: <T extends keyof SettingsData>(key: T, value: SettingsData[T]) => Promise<void>;
    setShortcutsEnabled: (enabled: boolean) => Promise<void>;
};
