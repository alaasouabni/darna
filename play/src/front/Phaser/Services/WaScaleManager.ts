import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import { HtmlUtils } from "../../WebRtc/HtmlUtils";
import type { Game } from "../Game/Game";
import { HdpiManager } from "./HdpiManager";
import ScaleManager = Phaser.Scale.ScaleManager;

export enum WaScaleManagerEvent {
    RefreshFocusOnTarget = "wa-scale-manager:refresh-focus-on-target",
}

export type WaScaleManagerFocusTarget = { x: number; y: number; width?: number; height?: number };

export class WaScaleManager {
    private hdpiManager: HdpiManager;
    private scaleManager: ScaleManager | undefined;
    private game!: Game;
    private actualZoom = 1;
    private _saveZoom = 1;

    private focusTarget?: WaScaleManagerFocusTarget;

    public constructor(private minGamePixelsNumber: number, private absoluteMinPixelNumber: number) {
        this.hdpiManager = new HdpiManager(minGamePixelsNumber, absoluteMinPixelNumber);
    }

    public setGame(game: Game): void {
        this.scaleManager = game.scale;
        this.game = game;
    }

    private getCurrentOptimalSizes(): {
        devicePixelRatio: number;
        gameSize: { width: number; height: number };
        realSize: { width: number; height: number };
    } {
        const { width, height } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? 1;
        const { game: gameSize, real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: width * devicePixelRatio,
            height: height * devicePixelRatio,
        });

        return { devicePixelRatio, gameSize, realSize };
    }

    private updateActualZoom(
        gameSize: { width: number; height: number },
        realSize: { width: number; height: number },
        devicePixelRatio: number
    ): void {
        if (realSize.width !== 0 && gameSize.width !== 0 && devicePixelRatio !== 0) {
            this.actualZoom = realSize.width / gameSize.width / devicePixelRatio;
        }
    }

    private applyCameraZoom(
        _gameSize: { width: number; height: number },
        _realSize: { width: number; height: number },
        camera?: Phaser.Cameras.Scene2D.Camera
    ): void {
        if (!camera) return;

        // Always keep camera zoom consistent with zoomModifier (no "camera.setZoom(1)" ever)
        camera.setZoom(this.zoomModifierToCameraZoom(this.hdpiManager.zoomModifier));
    }

    private getCurrentOptimalZoomLevelForRuntime(): number {
        if (this.scaleManager === undefined) return 1;

        const width = this.scaleManager.width;
        const height = this.scaleManager.height;

        return this.hdpiManager.getOptimalZoomLevel(width * height) || 1;
    }

    public zoomModifierToCameraZoom(zoomModifier: number): number {
        return zoomModifier * this.getCurrentOptimalZoomLevelForRuntime();
    }

    public cameraZoomToZoomModifier(cameraZoom: number): number {
        const optimal = this.getCurrentOptimalZoomLevelForRuntime();
        return optimal !== 0 ? cameraZoom / optimal : cameraZoom;
    }

    public applyNewSize(camera?: Phaser.Cameras.Scene2D.Camera) {
        if (this.scaleManager === undefined) return;

        const { width: cssWidthRaw, height: cssHeightRaw } = coWebsiteManager.getGameSize();
        const dpr = window.devicePixelRatio ?? 1;

        const cssWidth = Math.max(1, Math.round(cssWidthRaw));
        const cssHeight = Math.max(1, Math.round(cssHeightRaw));

        // Ask HdpiManager for the internal buffer size in *device pixels*
        const { real: realSizeRaw } = this.hdpiManager.getOptimalGameSize({
            width: cssWidth * dpr,
            height: cssHeight * dpr,
        });

        const bufferW = Math.max(1, Math.round(realSizeRaw.width));
        const bufferH = Math.max(1, Math.round(realSizeRaw.height));

        // 1) Internal resolution (canvas buffer)
        if (this.scaleManager.width !== bufferW || this.scaleManager.height !== bufferH) {
            this.scaleManager.resize(bufferW, bufferH);
        }

        // 2) Display scale (CSS) — MUST be done via ScaleManager so scene.scale.zoom is correct.
        // We want displayed size = cssWidth/cssHeight.
        const zoomX = cssWidth / bufferW;
        const zoomY = cssHeight / bufferH;
        const zoom = Math.min(zoomX, zoomY);

        this.scaleManager.setZoom(zoom);
        this.actualZoom = zoom;

        // Keep camera zoom consistent with zoomModifier
        this.applyCameraZoom({ width: bufferW, height: bufferH }, { width: bufferW, height: bufferH }, camera);

        // If you really need the #game container sized explicitly, do it here (optional):
        const gameStyle = HtmlUtils.getElementByIdOrFail<HTMLDivElement>("game").style;
        gameStyle.width = `${cssWidth}px`;
        gameStyle.height = `${cssHeight}px`;

        // IMPORTANT: do NOT manually set canvas.style.width/height
        // IMPORTANT: do NOT manually set displaySize.* or call refresh(w,h)

        this.game.markDirty();
    }

    /**
     * Runtime zoom path used by camera wheel / pinch animations.
     * It intentionally avoids resizing the canvas and DOM to prevent jitter.
     */
    public setRuntimeZoomModifier(zoomModifier: number, camera?: Phaser.Cameras.Scene2D.Camera): void {
        this.hdpiManager.zoomModifier = zoomModifier;
        if (this.scaleManager === undefined) {
            return;
        }

        // Runtime wheel/pinch must only change camera zoom.
        // Canvas/DOM zoom is handled by resize flow (applyNewSize) to avoid runtime jumps.
        if (camera) {
            camera.setZoom(this.zoomModifierToCameraZoom(zoomModifier));
        }
        this.game.markDirty();
    }

    /**
     * Runtime zoom path using camera-zoom as canonical value.
     * Keeps Hdpi zoomModifier synchronized with the current optimal zoom level.
     */
    public setRuntimeCameraZoom(cameraZoom: number, camera?: Phaser.Cameras.Scene2D.Camera): void {
        const safeCameraZoom = Math.max(cameraZoom, Number.EPSILON);
        this.hdpiManager.zoomModifier = this.cameraZoomToZoomModifier(safeCameraZoom);
        if (this.scaleManager === undefined) {
            return;
        }

        if (camera) {
            camera.setZoom(safeCameraZoom);
        }
        this.game.markDirty();
    }

    /**
     * Use this in case of resizing while focusing on something
     */
    public refreshFocusOnTarget(camera?: Phaser.Cameras.Scene2D.Camera): void {
        if (!this.focusTarget) {
            return;
        }
        if (this.focusTarget.width && this.focusTarget.height) {
            this.setZoomModifier(
                this.getTargetZoomModifierFor(this.focusTarget.width, this.focusTarget.height),
                camera
            );
        }

        this.game.events.emit(WaScaleManagerEvent.RefreshFocusOnTarget, this.focusTarget);
    }

    public setFocusTarget(targetDimensions?: WaScaleManagerFocusTarget): void {
        this.focusTarget = targetDimensions;
    }

    public getTargetZoomModifierFor(viewportWidth: number, viewportHeight: number) {
        const { width: gameWidth, height: gameHeight } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? this.hdpiManager.maxZoomOut;

        const { real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: gameWidth * devicePixelRatio,
            height: gameHeight * devicePixelRatio,
        });
        const desiredZoom = Math.min(realSize.width / viewportWidth, realSize.height / viewportHeight);
        const realPixelNumber = gameWidth * devicePixelRatio * gameHeight * devicePixelRatio;
        return desiredZoom / (this.hdpiManager.getOptimalZoomLevel(realPixelNumber) || 1);
    }

    /**
     * Maximum runtime zoom modifier that keeps at least `absoluteMinPixelNumber`
     * game pixels visible (same invariant as HdpiManager).
     */
    public getMaximumZoomModifierForCurrentView(): number {
        const { width: gameWidth, height: gameHeight } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? 1;
        const realPixelNumber = gameWidth * devicePixelRatio * gameHeight * devicePixelRatio;
        const optimalZoomLevel = this.hdpiManager.getOptimalZoomLevel(realPixelNumber) || 1;
        return Math.sqrt(realPixelNumber / this.absoluteMinPixelNumber) / optimalZoomLevel;
    }

    public get zoomModifier(): number {
        return this.hdpiManager.zoomModifier;
    }

    public set zoomModifier(zoomModifier: number) {
        let camera = undefined;
        // Let's attempt to get the camera
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene.cameras.main) {
                camera = scene.cameras.main;
            }
        }

        this.setZoomModifier(zoomModifier, camera);
    }

    public setZoomModifier(zoomModifier: number, camera?: Phaser.Cameras.Scene2D.Camera): void {
        this.hdpiManager.zoomModifier = zoomModifier;
        this.applyNewSize(camera);
    }

    public getFocusTarget(): WaScaleManagerFocusTarget | undefined {
        return this.focusTarget;
    }

    public saveZoom(): void {
        this._saveZoom = this.hdpiManager.zoomModifier;
    }

    public getSaveZoom(): number {
        return this._saveZoom;
    }

    public restoreZoom(): void {
        this.hdpiManager.zoomModifier = this._saveZoom;
        this.applyNewSize();
    }

    public getActualZoom(): number {
        return this.actualZoom;
    }

    /**
     * This is used to scale back the ui components to counter-act the zoom.
     */
    public get uiScalingFactor(): number {
        return this.actualZoom > 1 ? 1 : 1.2;
    }

    public set maxZoomOut(maxZoomOut: number) {
        this.hdpiManager.maxZoomOut = maxZoomOut;
    }
    public get maxZoomOut(): number {
        return this.hdpiManager.maxZoomOut;
    }

    public get isMaximumZoomOutReached(): boolean {
        return this.hdpiManager.isMaximumZoomReached;
    }

    public get isMaximumZoomInReached(): boolean {
        return this.hdpiManager.isMaximumZoomInReached;
    }
}

export const waScaleManager = new WaScaleManager(640 * 480, 196 * 196);
