import "phaser";
import "./front/style/index.scss";

import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

const versionKey = "waClientHash";

async function ensureFreshClient(): Promise<boolean> {
    try {
        const response = await fetch(`/version.json?_=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) {
            return false;
        }
        const data = (await response.json()) as { hash?: string };
        const hash = typeof data?.hash === "string" ? data.hash : null;
        if (!hash) {
            return false;
        }
        const stored = localStorage.getItem(versionKey);
        if (stored && stored !== hash) {
            localStorage.setItem(versionKey, hash);
            localStorage.removeItem("authToken");
            window.location.reload();
            return true;
        }
        if (!stored) {
            localStorage.setItem(versionKey, hash);
        }
    } catch {
        return false;
    }
    return false;
}

let app: App | undefined;

void (async () => {
    const reloaded = await ensureFreshClient();
    if (reloaded) {
        return;
    }
    app = new App({
        target: HtmlUtils.getElementByIdOrFail("app"),
    });
})();

export default app;
