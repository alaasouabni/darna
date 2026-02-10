import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import { HtmlUtils } from "../../WebRtc/HtmlUtils";
import type { Game } from "../Game/Game";
import { ResizableScene } from "../Login/ResizableScene";
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

    private updateActualZoom(gameSize: { width: number; height: number }, realSize: { width: number; height: number }, devicePixelRatio: number): void {
        if (realSize.width !== 0 && gameSize.width !== 0 && devicePixelRatio !== 0) {
            this.actualZoom = realSize.width / gameSize.width / devicePixelRatio;
        }
    }

    private applyCameraZoom(
        gameSize: { width: number; height: number },
        realSize: { width: number; height: number },
        camera?: Phaser.Cameras.Scene2D.Camera
    ): void {
        if (!camera) {
            return;
        }

        if (gameSize.width <= realSize.width && gameSize.height <= realSize.height) {
            camera.setZoom(1);
        } else {
            const zoom =
                this.hdpiManager.zoomModifier * this.hdpiManager.getOptimalZoomLevel(realSize.width * realSize.height);
            camera.setZoom(zoom);
        }
    }

    private getCurrentOptimalZoomLevelForRuntime(): number {
        if (this.scaleManager === undefined) {
            return 1;
        }
        const width = this.scaleManager.displaySize.width || this.scaleManager.width;
        const height = this.scaleManager.displaySize.height || this.scaleManager.height;
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
        if (this.scaleManager === undefined) {
            return;
        }
        const { devicePixelRatio, gameSize, realSize } = this.getCurrentOptimalSizes();
        this.updateActualZoom(gameSize, realSize, devicePixelRatio);

        // The performance shows us that resizing the game size outside its real size causes many lags and bad game performance.
        //      So we apply this condition: if the game size is greater than the real size, we don't zoom through the canvas.
        //      To zoom in and out, we use the camera. This is used in the Explorer mode. The zoom is calculated using the optimal zoom level.
        if (gameSize.width <= realSize.width && gameSize.height <= realSize.height) {
            this.scaleManager.resize(gameSize.width, gameSize.height);
            this.scaleManager.setZoom(this.actualZoom);
            this.applyCameraZoom(gameSize, realSize, camera);
        } else {
            if (this.scaleManager.width !== realSize.width || this.scaleManager.height !== realSize.height) {
                this.scaleManager.resize(realSize.width, realSize.height);
            }

            this.scaleManager.setZoom(this.actualZoom);
            this.applyCameraZoom(gameSize, realSize, camera);
        }

        // Override bug in canvas resizing in Phaser. Let's resize the canvas ourselves
        const style = this.scaleManager.canvas.style;
        style.width = Math.ceil(realSize.width !== 0 ? realSize.width / devicePixelRatio : 0) + "px";
        style.height = Math.ceil(realSize.height !== 0 ? realSize.height / devicePixelRatio : 0) + "px";

        // Resize the game element at the same size at the canvas
        const gameStyle = HtmlUtils.getElementByIdOrFail<HTMLDivElement>("game").style;
        gameStyle.width = style.width;
        gameStyle.height = style.height;

        // Resize the game element at the same size at the canvas
        // By default, the scaleManager.resize() method will change the take the zoom into account in the displaySize.
        // This is not what we want, we want the displaySize to be the real size of the game.
        this.scaleManager.displaySize.width = realSize.width;
        this.scaleManager.displaySize.height = realSize.height;
        this.scaleManager.refresh(realSize.width, realSize.height);

        // Resize the game element at the same size at the canvas
        // By default, the scaleManager.resize() method will change the take the zoom into account in the displaySize.
        // This is not what we want, we want the displaySize to be the real size of the game.
        this.scaleManager.displaySize.width = realSize.width;
        this.scaleManager.displaySize.height = realSize.height;
        this.scaleManager.refresh(realSize.width, realSize.height);

        // Note: onResize will be called twice (once here and once in Game.ts), but we have no better way.
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene instanceof ResizableScene) {
                // We are delaying the call to the "render" event because otherwise, the "camera" coordinates are not correctly updated.
                scene.events.once(Phaser.Scenes.Events.RENDER, () => scene.onResize());
            }
        }

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
