import { getColorOfStatus } from "../../../Utils/AvailabilityStatus";
import { StringUtils } from "../../../Utils/StringUtils";
import { ENABLE_DOM_PLAYER_NAMES } from "../../../Enum/EnvironmentVariable";
import type { Character } from "../../Entity/Character";
import type { RemotePlayer } from "../../Entity/RemotePlayer";
import type { GameScene } from "../GameScene";

type DomPlayerLabelEntry = {
    root: HTMLDivElement;
    nameEl: HTMLSpanElement;
    statusDotEl: HTMLSpanElement;
    megaphoneEl: HTMLElement;
    isVisible: boolean;
    lastTransform?: string;
    lastName?: string;
    lastFontSizePx?: number;
    lastStatusFill?: string;
    lastStatusOutline?: string;
    lastMegaphoneVisible?: boolean;
};

type UiExperimentControls = {
    domPlayerNames?: boolean;
};

type WorldProjectionBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const PLAYER_NAME_FONT_SIZE_LATIN_PX = 12;
const PLAYER_NAME_FONT_SIZE_NON_LATIN_PX = 14;
const NAME_LABEL_SCREEN_SCALE_BASE = 1;
const NAME_LABEL_SCREEN_SCALE_MAX = 1.1;
const NAME_LABEL_ZOOM_OUT_EXPONENT = 0.65;
const NAME_LABEL_ZOOM_IN_SCALE_MAX = 1.3;
const NAME_LABEL_ZOOM_IN_RANGE = 2.2;
const NAME_LABEL_ZOOM_IN_EXPONENT = 0.55;
const LABEL_CULL_MARGIN_PX = 64;

export class PlayerNameOverlayManager {
    private readonly labels = new Map<string, DomPlayerLabelEntry>();
    private rootElement?: HTMLDivElement;
    private domModeActive = false;
    private nameFontReady = false;
    private readonly fallbackMegaphoneGlyph = "M";
    private megaphoneIconDataUrl?: string;

    constructor(private readonly scene: GameScene) {
        const uiWindow = window as unknown as { __waUi?: UiExperimentControls };
        if (!uiWindow.__waUi) {
            uiWindow.__waUi = {};
        }
        if (typeof uiWindow.__waUi.domPlayerNames !== "boolean") {
            uiWindow.__waUi.domPlayerNames = ENABLE_DOM_PLAYER_NAMES;
        }

        try {
            if (this.scene.textures.exists("iconMegaphone")) {
                this.megaphoneIconDataUrl = this.scene.textures.getBase64("iconMegaphone");
            }
        } catch (error) {
            console.warn("Could not resolve megaphone icon for DOM player labels", error);
        }

        this.preloadNameFont();

        if (this.isDomPlayerNamesEnabled()) {
            this.setDomModeActive(false);
        }
    }

    public update(): void {
        const enabled = this.isDomPlayerNamesEnabled();
        if (!enabled) {
            this.setDomModeActive(false);
            return;
        }

        if (!this.nameFontReady) {
            this.setDomModeActive(false);
            return;
        }

        const camera = this.scene.cameras.main;
        const canvas = this.scene.game.canvas as HTMLCanvasElement | undefined;
        if (!camera || !canvas) {
            this.hideAllLabels();
            this.setDomModeActive(true);
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const projectionBounds = this.getProjectionBounds(camera);
        if (rect.width <= 0 || rect.height <= 0 || projectionBounds.width <= 0 || projectionBounds.height <= 0) {
            this.hideAllLabels();
            this.setDomModeActive(true);
            return;
        }

        this.setDomModeActive(true);

        const effectiveZoom = (camera.zoom || 1) * (this.scene.scale.zoom || 1);
        const normalizedDiscreteLevel = this.scene
            .getCameraManager()
            .captureZoomStateSnapshot().normalizedDiscreteLevel;
        const nameScale = this.computeNameScreenScale(effectiveZoom, normalizedDiscreteLevel);

        const presentPlayerIds = new Set<string>();

        const currentPlayer = this.scene.CurrentPlayer;
        if (currentPlayer) {
            const playerId = "local";
            presentPlayerIds.add(playerId);
            currentPlayer.setPlayerLabelStackVisible(false);
            this.upsertLabel(playerId, currentPlayer, projectionBounds, rect, nameScale);
        }

        this.scene.MapPlayersByKey.forEach((remotePlayer: RemotePlayer) => {
            const playerId = `remote-${remotePlayer.userId}`;
            presentPlayerIds.add(playerId);
            remotePlayer.setPlayerLabelStackVisible(false);
            this.upsertLabel(playerId, remotePlayer, projectionBounds, rect, nameScale);
        });

        for (const [id, entry] of this.labels.entries()) {
            if (!presentPlayerIds.has(id)) {
                entry.root.remove();
                this.labels.delete(id);
            }
        }
    }

    public isUsingDomLabels(): boolean {
        return this.domModeActive;
    }

    public destroy(): void {
        this.setDomModeActive(false);
        this.clearLabels();
        this.rootElement?.remove();
        this.rootElement = undefined;
    }

    private upsertLabel(
        playerId: string,
        character: Character,
        projectionBounds: WorldProjectionBounds,
        rect: DOMRect,
        nameScale: number
    ): void {
        const entry = this.getOrCreateLabel(playerId);
        const labelAnchor = character.getPlayerLabelAnchorWorldPosition();
        const screenX = rect.left + ((labelAnchor.x - projectionBounds.x) / projectionBounds.width) * rect.width;
        const screenY = rect.top + ((labelAnchor.y - projectionBounds.y) / projectionBounds.height) * rect.height;

        const isOnScreen =
            screenX >= rect.left - LABEL_CULL_MARGIN_PX &&
            screenX <= rect.right + LABEL_CULL_MARGIN_PX &&
            screenY >= rect.top - LABEL_CULL_MARGIN_PX &&
            screenY <= rect.bottom + LABEL_CULL_MARGIN_PX;

        if (!isOnScreen) {
            if (entry.isVisible) {
                entry.root.style.display = "none";
                entry.isVisible = false;
            }
            return;
        }

        if (!entry.isVisible) {
            entry.root.style.display = "block";
            entry.isVisible = true;
        }

        const snappedX = Math.round(screenX * 100) / 100;
        const snappedY = Math.round(screenY * 100) / 100;
        const transform = `translate3d(${snappedX}px, ${snappedY}px, 0) translate(-50%, -100%)`;
        if (entry.lastTransform !== transform) {
            entry.root.style.transform = transform;
            entry.lastTransform = transform;
        }

        const playerName = character.playerName;
        if (entry.lastName !== playerName) {
            entry.nameEl.textContent = playerName;
            entry.lastName = playerName;
        }

        const baseFontSize = StringUtils.containsNonLatinCharacters(playerName)
            ? PLAYER_NAME_FONT_SIZE_NON_LATIN_PX
            : PLAYER_NAME_FONT_SIZE_LATIN_PX;
        const fontSizePx = Math.round(baseFontSize * nameScale * 100) / 100;
        if (entry.lastFontSizePx !== fontSizePx) {
            entry.root.style.fontSize = `${fontSizePx}px`;
            entry.lastFontSizePx = fontSizePx;
        }

        const statusColors = getColorOfStatus(character.getAvailabilityStatus());
        const statusFill = this.toHexColor(statusColors.filling);
        const statusOutline = this.toHexColor(statusColors.outline);
        if (entry.lastStatusFill !== statusFill) {
            entry.statusDotEl.style.backgroundColor = statusFill;
            entry.lastStatusFill = statusFill;
        }
        if (entry.lastStatusOutline !== statusOutline) {
            entry.statusDotEl.style.borderColor = statusOutline;
            entry.lastStatusOutline = statusOutline;
        }

        const showMegaphone = character.isMegaphoneIconShown();
        if (entry.lastMegaphoneVisible !== showMegaphone) {
            entry.megaphoneEl.style.display = showMegaphone ? "inline-flex" : "none";
            entry.lastMegaphoneVisible = showMegaphone;
        }
    }

    private getOrCreateLabel(playerId: string): DomPlayerLabelEntry {
        const existing = this.labels.get(playerId);
        if (existing) {
            return existing;
        }

        const root = document.createElement("div");
        root.className = "wa-player-name-label";
        root.style.display = "none";

        const row = document.createElement("div");
        row.className = "wa-player-name-row";
        row.style.fontStyle = "normal";
        row.style.fontVariant = "normal";

        const statusDotEl = document.createElement("span");
        statusDotEl.className = "wa-player-name-status-dot";

        const nameEl = document.createElement("span");
        nameEl.className = "wa-player-name-text";
        nameEl.style.fontStyle = "normal";

        const megaphoneEl = this.createMegaphoneElement();
        megaphoneEl.classList.add("wa-player-name-megaphone");
        megaphoneEl.style.display = "none";

        row.append(statusDotEl, nameEl, megaphoneEl);
        root.append(row);

        this.ensureRootElement().append(root);

        const entry: DomPlayerLabelEntry = {
            root,
            nameEl,
            statusDotEl,
            megaphoneEl,
            isVisible: false,
        };
        this.labels.set(playerId, entry);
        return entry;
    }

    private createMegaphoneElement(): HTMLElement {
        if (this.megaphoneIconDataUrl) {
            const image = document.createElement("img");
            image.src = this.megaphoneIconDataUrl;
            image.alt = "";
            image.setAttribute("aria-hidden", "true");
            return image;
        }

        const text = document.createElement("span");
        text.textContent = this.fallbackMegaphoneGlyph;
        text.setAttribute("aria-hidden", "true");
        return text;
    }

    private ensureRootElement(): HTMLDivElement {
        if (this.rootElement) {
            return this.rootElement;
        }

        const rootElement = document.createElement("div");
        rootElement.className = "wa-player-name-overlay";
        rootElement.style.display = "none";
        document.body.append(rootElement);
        this.rootElement = rootElement;
        return rootElement;
    }

    private isDomPlayerNamesEnabled(): boolean {
        const uiWindow = window as unknown as { __waUi?: UiExperimentControls };
        return uiWindow.__waUi?.domPlayerNames === true;
    }

    private setDomModeActive(active: boolean): void {
        if (this.domModeActive === active) {
            return;
        }

        this.domModeActive = active;
        const rootElement = this.ensureRootElement();
        rootElement.style.display = active ? "block" : "none";

        if (active) {
            this.hidePhaserPlayerLabels();
            return;
        }

        this.showPhaserPlayerLabels();
        this.hideAllLabels();
    }

    private hidePhaserPlayerLabels(): void {
        this.scene.CurrentPlayer?.setPlayerLabelStackVisible(false);
        this.scene.MapPlayersByKey.forEach((player: RemotePlayer) => player.setPlayerLabelStackVisible(false));
    }

    private showPhaserPlayerLabels(): void {
        this.scene.CurrentPlayer?.setPlayerLabelStackVisible(true);
        this.scene.MapPlayersByKey.forEach((player: RemotePlayer) => player.setPlayerLabelStackVisible(true));
    }

    private clearLabels(): void {
        for (const entry of this.labels.values()) {
            entry.root.remove();
        }
        this.labels.clear();
    }

    private hideAllLabels(): void {
        for (const entry of this.labels.values()) {
            if (!entry.isVisible) {
                continue;
            }
            entry.root.style.display = "none";
            entry.isVisible = false;
        }
    }

    private computeNameScreenScale(effectiveZoom: number, normalizedDiscreteLevel: number): number {
        const safeZoom = Math.max(effectiveZoom, 0.0001);
        if (safeZoom < 1) {
            const t = this.clamp(normalizedDiscreteLevel, 0, 1);
            const easedT = Math.pow(t, NAME_LABEL_ZOOM_OUT_EXPONENT);
            const zoomOutBoost = 1 - easedT;
            return this.lerp(NAME_LABEL_SCREEN_SCALE_BASE, NAME_LABEL_SCREEN_SCALE_MAX, zoomOutBoost);
        }

        const zoomInT = this.clamp((safeZoom - 1) / NAME_LABEL_ZOOM_IN_RANGE, 0, 1);
        const easedZoomInT = Math.pow(zoomInT, NAME_LABEL_ZOOM_IN_EXPONENT);
        return this.lerp(NAME_LABEL_SCREEN_SCALE_BASE, NAME_LABEL_ZOOM_IN_SCALE_MAX, easedZoomInT);
    }

    private toHexColor(color: number): string {
        return `#${Math.max(0, color).toString(16).padStart(6, "0")}`;
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    private lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }

    private getProjectionBounds(camera: Phaser.Cameras.Scene2D.Camera): WorldProjectionBounds {
        const topLeft = camera.getWorldPoint(0, 0);
        const bottomRight = camera.getWorldPoint(camera.width, camera.height);
        return {
            x: topLeft.x,
            y: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
        };
    }

    private preloadNameFont(): void {
        if (!("fonts" in document) || !document.fonts?.load) {
            this.nameFontReady = true;
            return;
        }

        void Promise.allSettled([
            document.fonts.load('700 12px "Noto Sans"'),
            document.fonts.load('700 12px "Noto Sans Arabic"'),
        ]).finally(() => {
            this.nameFontReady = true;
        });
    }
}
