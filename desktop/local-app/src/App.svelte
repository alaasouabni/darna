<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";

    import KeyRecord from "~/lib/KeyRecord.svelte";
    import ToggleSwitch from "~/lib/ToggleSwitch.svelte";
    import { api, AppViewStatusEvent, DesktopLocalRuntimeConfig, SettingsData } from "~/lib/ipc";

    type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

    let insideElectron = api?.desktop;
    let version = "";
    let config: DesktopLocalRuntimeConfig | undefined;
    let settings: SettingsData | undefined;
    let status: ConnectionStatus = "idle";
    let statusDetail = "Waiting for startup";
    let errorMessage = "";
    let settingsOpen = false;
    let busy = false;
    let headerElement: HTMLElement | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let appViewStatusUnsubscribe: (() => void) | undefined;
    let configActionMessage = "";
    let configActionError = false;
    let topBarVisible = true;

    function isMeaningfulLoadedUrl(url?: string) {
        if (!url) {
            return false;
        }

        const normalized = url.trim().toLowerCase();
        return normalized.length > 0 && normalized !== "about:blank" && !normalized.startsWith("chrome-error://");
    }

    function resultErrorMessage(result: unknown): string | undefined {
        if (result === true || result === undefined || result === null) {
            return undefined;
        }

        if (typeof result === "object" && result !== null && "message" in result) {
            const message = (result as { message?: unknown }).message;
            if (typeof message === "string" && message.length > 0) {
                return message;
            }
        }

        if (typeof result === "string" && result.length > 0) {
            return result;
        }

        return "Unknown error";
    }

    async function syncAppViewInsets() {
        if (!api?.desktop || !headerElement) {
            return;
        }

        const top = topBarVisible ? Math.ceil(headerElement.getBoundingClientRect().height) : 0;
        await api.setAppViewInsets({ top, left: 0, right: 0, bottom: 0 });
    }

    function applyAppViewStatus(appViewStatus: AppViewStatusEvent) {
        switch (appViewStatus.state) {
            case "loading":
                status = "connecting";
                statusDetail = `Loading ${config?.server.name || "server"}`;
                errorMessage = "";
                break;
            case "loaded":
                if (!isMeaningfulLoadedUrl(appViewStatus.url)) {
                    break;
                }
                status = "connected";
                statusDetail = `Connected to ${config?.server.name || "server"}`;
                errorMessage = "";
                busy = false;
                break;
            case "error":
                status = "error";
                statusDetail = "Connection failed";
                errorMessage =
                    appViewStatus.errorDescription && appViewStatus.errorDescription.length > 0
                        ? `${appViewStatus.errorDescription}${
                              typeof appViewStatus.errorCode === "number" ? ` (${appViewStatus.errorCode})` : ""
                          }`
                        : "Unable to connect";
                busy = false;
                break;
            case "hidden":
                status = "idle";
                statusDetail = settingsOpen ? "Desktop settings open" : "App view hidden";
                busy = false;
                break;
        }
    }

    $: topBarVisible = settingsOpen || status !== "connected";

    async function connectToConfiguredServer() {
        if (!api?.desktop) {
            return;
        }

        busy = true;
        status = "connecting";
        statusDetail = `Connecting to ${config?.server.name || "server"}`;
        errorMessage = "";

        try {
            const result = await api.connectConfiguredServer();
            const error = resultErrorMessage(result);
            if (error) {
                throw new Error(error);
            }
        } catch (error) {
            if (status !== "error") {
                status = "error";
                statusDetail = "Connection failed";
                errorMessage = error instanceof Error ? error.message : "Unable to connect";
            }
        } finally {
            busy = false;
        }
    }

    async function openSettings() {
        if (!api?.desktop) {
            return;
        }

        settingsOpen = true;
        await api.showLocalApp();
        await api.setShortcutsEnabled(false);
        await tick();
        await syncAppViewInsets();
    }

    async function closeSettings() {
        if (!api?.desktop) {
            return;
        }

        settingsOpen = false;
        await api.setShortcutsEnabled(true);
        await tick();
        await syncAppViewInsets();
        await connectToConfiguredServer();
    }

    async function saveShortcut(key: "mute_toggle" | "camera_toggle", value: string) {
        if (!api?.desktop || !settings) {
            return;
        }

        const shortcuts = { ...settings.shortcuts, [key]: value };
        settings = { ...settings, shortcuts };
        await api.saveSetting("shortcuts", shortcuts);
    }

    async function saveAutoLaunch(autoLaunchEnabled: boolean) {
        if (!api?.desktop || !settings) {
            return;
        }

        settings = { ...settings, auto_launch_enabled: autoLaunchEnabled };
        await api.saveSetting("auto_launch_enabled", autoLaunchEnabled);
    }

    async function openConfigFile() {
        if (!api?.desktop) {
            return;
        }

        configActionMessage = "";
        const result = await api.openDesktopConfigFile();
        const error = resultErrorMessage(result);

        if (error) {
            configActionError = true;
            configActionMessage = `Failed to open config file: ${error}`;
            return;
        }

        configActionError = false;
        configActionMessage = "Opened config file in your default editor.";
    }

    async function openConfigFolder() {
        if (!api?.desktop) {
            return;
        }

        configActionMessage = "";
        const result = await api.openDesktopConfigFolder();
        const error = resultErrorMessage(result);

        if (error) {
            configActionError = true;
            configActionMessage = `Failed to open config folder: ${error}`;
            return;
        }

        configActionError = false;
        configActionMessage = "Opened config folder.";
    }

    onMount(async () => {
        if (!api?.desktop) {
            return;
        }

        appViewStatusUnsubscribe = api.onAppViewStatus((appViewStatus) => {
            applyAppViewStatus(appViewStatus);
        });

        version = await api.getVersion();
        config = await api.getDesktopConfig();
        settings = await api.getSettings();

        await tick();
        await syncAppViewInsets();

        resizeObserver = new ResizeObserver(() => {
            void syncAppViewInsets();
        });
        if (headerElement) {
            resizeObserver.observe(headerElement);
        }

        window.addEventListener("resize", syncAppViewInsets);

        if (config.autoConnectOnLaunch) {
            await connectToConfiguredServer();
        } else {
            status = "idle";
            statusDetail = "Auto connect disabled";
        }
    });

    onDestroy(() => {
        appViewStatusUnsubscribe?.();
        resizeObserver?.disconnect();
        window.removeEventListener("resize", syncAppViewInsets);
        if (api?.desktop) {
            void api.setShortcutsEnabled(true);
        }
    });
</script>

{#if insideElectron}
    <div class="desktop-shell">
        <header class="top-bar" class:is-collapsed={!topBarVisible} bind:this={headerElement}>
            <div class="brand">
                <div class="brand-mark" aria-hidden="true" />
                <div class="brand-copy">
                    <span class="eyebrow">{config?.appName || "Desktop"}</span>
                    <strong>{config?.server.name || "Server"}</strong>
                </div>
            </div>

            <div
                class="status-pill"
                class:status-idle={status === "idle"}
                class:status-connecting={status === "connecting"}
                class:status-connected={status === "connected"}
                class:status-error={status === "error"}
            >
                <span class="status-dot" aria-hidden="true" />
                <span>{statusDetail}</span>
            </div>

            <div class="actions">
                {#if settingsOpen}
                    <button class="secondary" type="button" on:click={closeSettings} disabled={busy}>Back to App</button
                    >
                {:else}
                    <button class="secondary" type="button" on:click={connectToConfiguredServer} disabled={busy}>
                        {busy ? "Connecting..." : status === "error" ? "Retry" : "Reconnect"}
                    </button>
                    <button class="primary" type="button" on:click={openSettings}>Settings</button>
                {/if}
            </div>
        </header>

        <main class="workspace">
            {#if settingsOpen}
                <section class="panel settings-panel">
                    <div class="panel-header">
                        <div>
                            <h1>Desktop Settings</h1>
                            <p>Local preferences only. Server URL is managed from the desktop config file.</p>
                        </div>
                        <span class="version">v{version}</span>
                    </div>

                    <div class="panel-grid">
                        <div class="card">
                            <h2>Shortcuts</h2>
                            <p class="muted">
                                Global shortcuts are disabled while this screen is open to avoid accidental triggers.
                            </p>

                            {#if settings}
                                <div class="field">
                                    <label for="shortcut-mute">Toggle Microphone</label>
                                    <KeyRecord
                                        id="shortcut-mute"
                                        value={settings.shortcuts.mute_toggle}
                                        on:change={(e) => saveShortcut("mute_toggle", e.detail)}
                                    />
                                </div>

                                <div class="field">
                                    <label for="shortcut-camera">Toggle Camera</label>
                                    <KeyRecord
                                        id="shortcut-camera"
                                        value={settings.shortcuts.camera_toggle}
                                        on:change={(e) => saveShortcut("camera_toggle", e.detail)}
                                    />
                                </div>
                            {/if}
                        </div>

                        <div class="card">
                            <h2>Startup</h2>
                            <p class="muted">Choose whether the desktop client starts with your operating system.</p>
                            {#if settings}
                                <div class="switch-row">
                                    <div>
                                        <label class="switch-title" for="toggle-autostart">Launch on startup</label>
                                        <div class="switch-subtitle">Applies to this device only.</div>
                                    </div>
                                    <ToggleSwitch
                                        id="toggle-autostart"
                                        value={settings.auto_launch_enabled}
                                        on:change={(e) => saveAutoLaunch(e.detail)}
                                    />
                                </div>
                            {/if}
                        </div>

                        <div class="card wide">
                            <h2>Managed Server</h2>
                            <p class="muted">
                                This client runs in locked server mode. Edit the config file to change the target
                                server.
                            </p>

                            <div class="kv-list">
                                <div class="kv-item">
                                    <span>Server Name</span>
                                    <code>{config?.server.name || "-"}</code>
                                </div>
                                <div class="kv-item">
                                    <span>Server URL</span>
                                    <code>{config?.server.url || "-"}</code>
                                </div>
                                <div class="kv-item">
                                    <span>Config File</span>
                                    <code>{config?.configPath || "-"}</code>
                                </div>
                            </div>

                            <div class="inline-actions">
                                <button type="button" class="secondary" on:click={openConfigFile}
                                    >Open Config File</button
                                >
                                <button type="button" class="secondary" on:click={openConfigFolder}>Open Folder</button>
                            </div>

                            <p class={`action-message ${configActionError ? "is-error" : ""}`}>
                                {configActionMessage || "Changes to this file apply after restarting the desktop app."}
                            </p>
                        </div>
                    </div>
                </section>
            {:else}
                <section class="panel launch-panel">
                    <div class="hero">
                        <p class="hero-label">Single-server desktop client</p>
                        <h1>{config?.server.name || "Configured Server"}</h1>
                        <p class="hero-copy">
                            The embedded app loads below this header. Use Settings for local shortcuts and startup
                            behavior.
                        </p>
                    </div>

                    <div class="status-grid">
                        <div class="stat-card">
                            <span>Mode</span>
                            <strong>{config?.lockedServerMode ? "Locked server" : "Standard"}</strong>
                        </div>
                        <div class="stat-card">
                            <span>Auto connect</span>
                            <strong>{config?.autoConnectOnLaunch ? "Enabled" : "Disabled"}</strong>
                        </div>
                        <div class="stat-card">
                            <span>Version</span>
                            <strong>{version || "-"}</strong>
                        </div>
                    </div>

                    {#if errorMessage}
                        <div class="error-box">
                            <strong>Connection error</strong>
                            <p>{errorMessage}</p>
                        </div>
                    {/if}
                </section>
            {/if}
        </main>
    </div>
{:else}
    <main class="fallback">
        <div class="panel">
            <h1>Desktop shell only</h1>
            <p>Open this UI from the Electron desktop app.</p>
        </div>
    </main>
{/if}

<style>
    :global(html, body, #app) {
        width: 100%;
        height: 100%;
        margin: 0;
    }

    :global(body) {
        font-family: "Segoe UI Variable", "Segoe UI", "Trebuchet MS", sans-serif;
        color: #e8edf4;
        background: #0b1220;
    }

    :global(*) {
        box-sizing: border-box;
    }

    :global(code) {
        font-family: Consolas, "Courier New", monospace;
    }

    .desktop-shell {
        display: grid;
        grid-template-rows: auto 1fr;
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
        isolation: isolate;
    }

    .top-bar {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto;
        gap: 16px;
        align-items: center;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: #0f1621;
        position: relative;
        z-index: 20;
        overflow: hidden;
        transition: height 180ms ease, padding 180ms ease, border-color 180ms ease, opacity 140ms ease;
    }

    .top-bar::after {
        content: none;
    }

    .top-bar.is-collapsed {
        height: 0;
        min-height: 0;
        padding-top: 0;
        padding-bottom: 0;
        border-bottom-color: transparent;
        opacity: 0;
    }

    .brand {
        display: flex;
        align-items: center;
        min-width: 0;
        gap: 12px;
    }

    .brand-mark {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: linear-gradient(135deg, #ff9500, #00bfff);
        flex: 0 0 auto;
    }

    .brand-copy {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .brand-copy strong {
        font-size: 14px;
        font-weight: 650;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(232, 237, 244, 0.62);
    }

    .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        background: #141d2a;
        font-size: 12px;
        color: rgba(232, 237, 244, 0.88);
        white-space: nowrap;
    }

    .status-dot {
        display: inline-block;
        flex: 0 0 8px;
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #7c8899;
    }

    .status-connecting .status-dot {
        background: #f59e0b;
        animation: pulse 1s infinite ease-in-out;
    }

    .status-connected .status-dot {
        background: #22c55e;
    }

    .status-error .status-dot {
        background: #ef4444;
    }

    .actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        align-items: center;
    }

    button {
        border: 0;
        border-radius: 12px;
        padding: 10px 14px;
        color: #edf2f8;
        font-weight: 600;
        font-size: 12px;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease, background 120ms ease;
    }

    button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    button:not(:disabled):hover {
        transform: translateY(-1px);
    }

    .primary {
        background: linear-gradient(135deg, #0ea5e9, #2563eb);
        box-shadow: 0 8px 20px rgba(37, 99, 235, 0.24);
    }

    .secondary {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .workspace {
        position: relative;
        padding: 18px;
        min-height: 0;
    }

    .workspace::before {
        content: none;
    }

    .panel {
        position: relative;
        z-index: 1;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        background: #121b28;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    }

    .launch-panel {
        padding: 24px;
        max-width: 840px;
    }

    .hero {
        margin-bottom: 20px;
    }

    .hero-label {
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 11px;
        color: rgba(232, 237, 244, 0.6);
    }

    .hero h1 {
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
        letter-spacing: -0.02em;
    }

    .hero-copy {
        margin: 12px 0 0;
        font-size: 14px;
        color: rgba(232, 237, 244, 0.72);
        max-width: 62ch;
    }

    .status-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
    }

    .stat-card {
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .stat-card span {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: rgba(232, 237, 244, 0.58);
    }

    .stat-card strong {
        font-size: 14px;
        word-break: break-word;
    }

    .error-box {
        margin-top: 14px;
        border-radius: 14px;
        border: 1px solid rgba(239, 68, 68, 0.25);
        background: rgba(127, 29, 29, 0.18);
        padding: 14px;
    }

    .error-box strong {
        display: block;
        margin-bottom: 4px;
    }

    .error-box p {
        margin: 0;
        color: rgba(255, 226, 226, 0.9);
        font-size: 13px;
    }

    .settings-panel {
        width: min(1080px, 100%);
        padding: 20px;
        animation: slideIn 180ms ease-out;
    }

    .panel-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        margin-bottom: 18px;
    }

    .panel-header h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: -0.02em;
    }

    .panel-header p {
        margin: 8px 0 0;
        color: rgba(232, 237, 244, 0.68);
        font-size: 13px;
        max-width: 60ch;
    }

    .version {
        flex: 0 0 auto;
        font-size: 12px;
        color: rgba(232, 237, 244, 0.66);
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.03);
    }

    .panel-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }

    .card {
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        background: rgba(255, 255, 255, 0.025);
        padding: 16px;
        min-width: 0;
    }

    .card.wide {
        grid-column: 1 / -1;
    }

    .card h2 {
        margin: 0;
        font-size: 16px;
        letter-spacing: -0.01em;
    }

    .muted {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(232, 237, 244, 0.64);
    }

    .field {
        margin-top: 16px;
    }

    .field label {
        display: block;
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(232, 237, 244, 0.88);
    }

    .switch-row {
        margin-top: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }

    .switch-title {
        display: block;
        font-size: 13px;
        font-weight: 600;
    }

    .switch-subtitle {
        margin-top: 4px;
        font-size: 12px;
        color: rgba(232, 237, 244, 0.62);
    }

    .kv-list {
        display: grid;
        gap: 10px;
        margin-top: 12px;
    }

    .kv-item {
        display: grid;
        gap: 6px;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
    }

    .kv-item span {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        color: rgba(232, 237, 244, 0.58);
    }

    .kv-item code {
        font-size: 12px;
        line-height: 1.45;
        word-break: break-all;
        color: rgba(237, 242, 248, 0.92);
    }

    .inline-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
    }

    .action-message {
        margin: 10px 0 0;
        font-size: 12px;
        color: rgba(232, 237, 244, 0.62);
    }

    .action-message.is-error {
        color: rgba(254, 202, 202, 0.95);
    }

    .fallback {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        padding: 16px;
    }

    .fallback .panel {
        padding: 20px;
        max-width: 420px;
    }

    .fallback h1 {
        margin: 0 0 8px;
        font-size: 20px;
    }

    .fallback p {
        margin: 0;
        color: rgba(232, 237, 244, 0.75);
    }

    @keyframes pulse {
        0%,
        100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.08);
            opacity: 0.8;
        }
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (max-width: 980px) {
        .top-bar {
            grid-template-columns: 1fr;
            align-items: stretch;
        }

        .status-pill {
            justify-content: center;
        }

        .actions {
            justify-content: stretch;
        }

        .actions button {
            flex: 1 1 auto;
        }

        .panel-grid {
            grid-template-columns: 1fr;
        }

        .status-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
