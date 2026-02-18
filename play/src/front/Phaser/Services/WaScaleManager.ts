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
    private readonly WA_SCALE_DEBUG = true;

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
        if (!this.scaleManager) return;

        const { width: cssWraw, height: cssHraw } = coWebsiteManager.getGameSize();
        const cssW = Math.max(1, Math.round(cssWraw));
        const cssH = Math.max(1, Math.round(cssHraw));
        const dpr = window.devicePixelRatio ?? 1;

        // Ask HdpiManager for an internal pixel budget (device pixels)
        const { real: budgetRaw } = this.hdpiManager.getOptimalGameSize({
            width: cssW * dpr,
            height: cssH * dpr,
        });

        const budgetW = Math.max(1, Math.round(budgetRaw.width));
        const budgetH = Math.max(1, Math.round(budgetRaw.height));
        const budgetPixels = budgetW * budgetH;
        if (this.WA_SCALE_DEBUG) {
            console.log("[SeamDebug][Scale] applyNewSize:start", {
                cssWraw,
                cssHraw,
                cssW,
                cssH,
                dpr,
                budgetW,
                budgetH,
                budgetPixels,
                currentScaleW: this.scaleManager.width,
                currentScaleH: this.scaleManager.height,
                currentScaleZoom: this.scaleManager.zoom,
            });
        }

        // "Clean" zoom candidates only (avoid 0.998xxx type ratios)
        // 1 = internal == css
        // 0.5 = internal = 2x css (downscale by 2)
        // 2 = internal = css/2 (upscale by 2)  <-- only works cleanly if css dims divisible by 2
        const candidates = [1, 0.5, 2, 0.25, 3];

        let bestZoom = 1;
        let bestW = cssW;
        let bestH = cssH;
        let bestPixels = bestW * bestH;

        for (const zoom of candidates) {
            // internal buffer derived from CSS and zoom
            const w = Math.max(1, Math.round(cssW / zoom));
            const h = Math.max(1, Math.round(cssH / zoom));

            // Require exact mapping to CSS to avoid 1px rounding resample
            const exactW = Math.round(w * zoom) === cssW;
            const exactH = Math.round(h * zoom) === cssH;
            if (!exactW || !exactH) {
                if (this.WA_SCALE_DEBUG) {
                    console.log("[SeamDebug][Scale] candidate:reject-mapping", {
                        zoom,
                        w,
                        h,
                        exactW,
                        exactH,
                        mappedW: Math.round(w * zoom),
                        mappedH: Math.round(h * zoom),
                    });
                }
                continue;
            }

            const pixels = w * h;
            if (this.WA_SCALE_DEBUG) {
                console.log("[SeamDebug][Scale] candidate", {
                    zoom,
                    w,
                    h,
                    pixels,
                    budgetPixels,
                });
            }

            // Must fit budget; choose the largest internal resolution that fits
            if (pixels <= budgetPixels && pixels > bestPixels) {
                bestZoom = zoom;
                bestW = w;
                bestH = h;
                bestPixels = pixels;
                if (this.WA_SCALE_DEBUG) {
                    console.log("[SeamDebug][Scale] candidate:new-best", {
                        bestZoom,
                        bestW,
                        bestH,
                        bestPixels,
                    });
                }
            }
        }

        if (this.scaleManager.width !== bestW || this.scaleManager.height !== bestH) {
            this.scaleManager.resize(bestW, bestH);
        }

        this.scaleManager.setZoom(bestZoom);
        this.actualZoom = bestZoom;
        if (this.WA_SCALE_DEBUG) {
            console.log("[SeamDebug][Scale] applyNewSize:chosen", {
                bestZoom,
                bestW,
                bestH,
                bestPixels,
                dpr,
            });
        }

        this.applyCameraZoom({ width: bestW, height: bestH }, { width: bestW, height: bestH }, camera);

        // Optional: keep container sizing
        const gameStyle = HtmlUtils.getElementByIdOrFail<HTMLDivElement>("game").style;
        gameStyle.width = `${cssW}px`;
        gameStyle.height = `${cssH}px`;

        this.game.markDirty();
        if (this.WA_SCALE_DEBUG) {
            console.log("[SeamDebug][Scale] applyNewSize:end", {
                scaleW: this.scaleManager.width,
                scaleH: this.scaleManager.height,
                scaleZoom: this.scaleManager.zoom,
                actualZoom: this.actualZoom,
            });
        }
    }

    /**
     * Runtime zoom path used by camera wheel / pinch animations.
     * It intentionally avoids resizing the canvas and DOM to prevent jitter.
     */
    public setRuntimeZoomModifier(zoomModifier: number, camera?: Phaser.Cameras.Scene2D.Camera): void {
        this.hdpiManager.zoomModifier = zoomModifier;
        if (this.WA_SCALE_DEBUG) {
            console.log("[SeamDebug][Scale] runtimeZoomModifier:set", {
                zoomModifier,
                computedCameraZoom: this.zoomModifierToCameraZoom(zoomModifier),
            });
        }
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
        if (this.WA_SCALE_DEBUG) {
            console.log("[SeamDebug][Scale] runtimeCameraZoom:set", {
                cameraZoom,
                safeCameraZoom,
                zoomModifier: this.hdpiManager.zoomModifier,
            });
        }
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
