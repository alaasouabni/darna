import { mapEditorModeStore } from "../../Stores/MapEditorStore";
import { Easing } from "../../types";
import { HtmlUtils } from "../../WebRtc/HtmlUtils";
import type { Box } from "../../WebRtc/LayoutManager";
import { ZOOM_DISCRETE_LEVEL_COUNT, ZOOM_MAX_STEPS_PER_EVENT, ZOOM_WHEEL_STEP } from "../../Enum/EnvironmentVariable";
import type { Player } from "../Player/Player";
import { hasMovedEventName } from "../Player/Player";
import type { WaScaleManagerFocusTarget, WaScaleManager } from "../Services/WaScaleManager";
import { waScaleManager, WaScaleManagerEvent } from "../Services/WaScaleManager";
import type { ActiveEventList } from "../UserInput/UserInputManager";
import { UserInputEvent } from "../UserInput/UserInputManager";
import { debugZoom } from "../../Utils/Debuggers";
import type { RemotePlayer } from "../Entity/RemotePlayer";
import type { GameScene } from "./GameScene";
import Clamp = Phaser.Math.Clamp;

export enum CameraMode {
    /**
     * Camera looks at certain point but is not locked and will start following the player on his movement
     */
    Positioned = "Positioned",
    /**
     * Camera is actively following the player
     */
    Follow = "Follow",
    /**
     * Camera is focusing on certain point and will not break this focus even on player movement
     */
    Focus = "Focus",

    /**
     * Camera is free and can be moved anywhere on the map by the user (only in the exploration mode)
     */
    Exploration = "Exploration",
}

export enum CameraManagerEvent {
    CameraUpdate = "CameraUpdate",
}

export interface CameraManagerEventCameraUpdateData {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
}

export interface CameraZoomStateSnapshot {
    cameraZoom: number;
    normalizedDiscreteLevel: number;
    effectiveCssZoom?: number; // NEW: camera.zoom * scene.scale.zoom
}

/**
 * The CameraManager is responsible for managing the camera in the game.
 * It allows to set the camera to follow the player, to focus on a specific point or to be in exploration mode.
 *
 * The CameraManager handles the transitions / animations between the different camera modes.
 * It also handles the smooth zoom in and out of the camera.
 */
export class CameraManager extends Phaser.Events.EventEmitter {
    private camera: Phaser.Cameras.Scene2D.Camera;
    private waScaleManager: WaScaleManager;

    private cameraMode: CameraMode = CameraMode.Positioned;

    private restoreZoomTween?: Phaser.Tweens.Tween;
    private startFollowTween?: Phaser.Tweens.Tween;

    private playerToFollow?: Player | RemotePlayer;
    private cameraLocked: boolean;
    private zoomLocked: boolean;

    private readonly EDITOR_MODE_SCROLL_SPEED: number = 5;
    private readonly FOLLOW_MIN_ZOOM_MARGIN = 1.05;
    private readonly SAFE_MIN_ZOOM_OUT_FACTOR = 1.05;
    private readonly DISCRETE_EDGE_SKIP_LEVELS = 1;
    private readonly DISCRETE_ZOOM_LEVEL_COUNT = Math.max(2, ZOOM_DISCRETE_LEVEL_COUNT);
    private readonly NORMALIZED_WHEEL_STEP = Math.max(1, 30);
    private readonly MAX_WHEEL_STEPS_PER_EVENT = Math.max(1, ZOOM_MAX_STEPS_PER_EVENT);

    private unsubscribeMapEditorModeStore: () => void;

    // Whether a pan or tween effect is in progress
    private animationInProgress = false;
    // Are we yet arrived to targetZoomModifier?
    private targetReachInProgress = false;
    // The target zoom we should reach. Each step, we get closer to this target.
    private targetZoomModifier: number | undefined;
    private targetDirection: "zoom_out" | "zoom_in" | undefined;
    private cameraZoomSpeed = 1;
    private _resistanceStartZoomLevel = 0.6;
    private _resistanceEndZoomLevel = 0.3;
    // The resistance strength is the speed at which the camera will go back to the resistance start zoom level.
    private _resistanceStrength = 1;
    // The callback to be called when the resistance zone is overcome
    private resistanceCallback?: () => void;
    private animateCallback: (time: number, delta: number) => void;
    // The date when the resistance wall was broken
    private wallDownDate = 0;
    private resistanceZoneEnterDate = 0;
    private cameraSpeed: { x: number; y: number } | undefined;
    // If set to false, the resistance wall will never be active
    private enableResistanceWall = false;
    private resistanceRadiusAroundWoka: number | undefined;
    private player: Player | undefined;

    // The point of the scene the explorer mode is focusing on.
    private explorerFocusOn: { x: number; y: number } = { x: 0, y: 0 };
    // If set, the camera will move toward this target.
    private explorerFocusOnTarget: { x: number; y: number; zoom: number } | undefined;
    private zoomAnchor:
        | {
              screenX: number;
              screenY: number;
              worldX: number;
              worldY: number;
          }
        | undefined;
    private focusTargetSpeed = 0.2;
    private explorationAllowOutsideMap = true;
    private wheelZoomAccumulator = 0;
    private resizeInProgress = false;

    // The tween for the camera offset
    private cameraOffsetCurrentTween?: Phaser.Tweens.Tween;

    constructor(
        private scene: GameScene,
        private mapSize: { width: number; height: number },
        waScaleManager: WaScaleManager
    ) {
        super();
        this.animateCallback = this.animate.bind(this);

        this.camera = scene.cameras.main;
        // Keep pixel rounding enabled by default (follow/positioned modes).
        this.camera.roundPixels = true;
        this.cameraLocked = false;
        this.zoomLocked = false;

        this.waScaleManager = waScaleManager;

        this.initCamera();

        this.bindEventHandlers();

        // Subscribe to map editor mode store to change camera bounds when the map editor is opened or closed
        this.unsubscribeMapEditorModeStore = mapEditorModeStore.subscribe((isOpened) => {
            // Define new bounds for camera if the map editor is opened
            if (isOpened) {
                this.camera.setBounds(0, 0, this.mapSize.width * 2, this.mapSize.height);
            } else {
                // We set the bounds back after a call to start following the player
                //this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
            }
        });

        this.scene.cameras.main.on(Phaser.Cameras.Scene2D.Events.PAN_START, () => {
            this.animationInProgress = true;
        });
        this.scene.cameras.main.on(Phaser.Cameras.Scene2D.Events.PAN_COMPLETE, () => {
            this.animationInProgress = false;
        });

        // Set zoom out to the maximum possible value (fit-to-map)
        this.refreshZoomBounds();
        this.targetZoomModifier = undefined;
    }

    public destroy(): void {
        this.scene.game.events.off(WaScaleManagerEvent.RefreshFocusOnTarget);
        this.camera.off("followupdate", this.onFollowUpdate);
        this.unsubscribeMapEditorModeStore();
        super.destroy();
    }

    public getCamera(): Phaser.Cameras.Scene2D.Camera {
        return this.camera;
    }

    /**
     * Set camera view to specific destination without changing current camera mode. Won't work if camera mode is set to Focus.
     * @param setTo Viewport on which the camera should set the position
     * @param duration Time for the transition im MS. If set to 0, transition will occur immediately
     */
    public setPosition(setTo: WaScaleManagerFocusTarget, duration = 1000): void {
        if (this.cameraMode === CameraMode.Focus) {
            return;
        }
        this.setCameraMode(CameraMode.Positioned);
        this.waScaleManager.saveZoom();
        this.camera.stopFollow();

        const currentZoomModifier = this.waScaleManager.zoomModifier;
        const zoomModifierChange = this.getZoomModifierChange(setTo.width, setTo.height);

        if (duration === 0) {
            this.waScaleManager.setRuntimeZoomModifier(currentZoomModifier + zoomModifierChange, this.camera);
            this.camera.centerOn(setTo.x, setTo.y);
            this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            this.playerToFollow?.once(hasMovedEventName, () => {
                if (this.playerToFollow) {
                    this.startFollowPlayer(this.playerToFollow, duration);
                }
            });
            return;
        }
        this.stopPan();
        this.camera.pan(setTo.x, setTo.y, duration, Easing.SineEaseOut, true, (camera, progress, x, y) => {
            if (this.cameraMode === CameraMode.Positioned) {
                if (zoomModifierChange !== 0) {
                    this.waScaleManager.setRuntimeZoomModifier(
                        currentZoomModifier + progress * zoomModifierChange,
                        this.camera
                    );
                }
                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            }
            if (progress === 1) {
                this.playerToFollow?.once(hasMovedEventName, () => {
                    if (this.playerToFollow) {
                        this.startFollowPlayer(this.playerToFollow, duration);
                    }
                });
            }
        });
    }

    /**
     * Set camera to focus mode. As long as the camera is in the Focus mode, its view cannot be changed.
     * @param setTo Viewport on which the camera should focus on
     * @param duration Time for the transition im MS. If set to 0, transition will occur immediately
     */
    public enterFocusMode(focusOn: WaScaleManagerFocusTarget, margin = 0, duration = 1000): void {
        this.setCameraMode(CameraMode.Focus);
        this.waScaleManager.saveZoom();
        this.waScaleManager.setFocusTarget(focusOn);

        this.cameraLocked = false;
        this.zoomLocked = false;

        this.restoreZoomTween?.stop();
        this.startFollowTween?.stop();

        //Set the camera to focus on the given point
        const focusPoint = {
            x: focusOn.x,
            y: focusOn.y,
        };

        this.camera.startFollow(focusPoint, true);
        this.playerToFollow = undefined;

        const currentZoomModifier = this.waScaleManager.zoomModifier;
        const zoomModifierChange = this.getZoomModifierChange(focusOn.width, focusOn.height, 1 + margin);

        if (duration === 0) {
            this.waScaleManager.setRuntimeZoomModifier(currentZoomModifier + zoomModifierChange, this.camera);
            this.camera.centerOn(focusOn.x, focusOn.y);
            this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            return;
        }
        this.stopPan();
        this.camera.pan(focusOn.x, focusOn.y, duration, Easing.SineEaseOut, true, (camera, progress, x, y) => {
            if (zoomModifierChange) {
                this.waScaleManager.setRuntimeZoomModifier(
                    currentZoomModifier + progress * zoomModifierChange,
                    this.camera
                );
            }
            if (progress === 1) {
                // NOTE: Making sure the last action will be centering after zoom change
                this.camera.centerOn(focusOn.x, focusOn.y);
            }
            this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
        });
    }

    public leaveFocusMode(player: Player, duration = 0): void {
        this.waScaleManager.setFocusTarget();
        this.unlockCameraWithDelay(duration);
        this.startFollowPlayer(player, duration);
        this.restoreZoom(duration);
    }

    public move(moveEvents: ActiveEventList): void {
        let sendViewportUpdate = false;
        if (moveEvents.get(UserInputEvent.MoveUp)) {
            this.explorerFocusOn.y -= this.EDITOR_MODE_SCROLL_SPEED;
            this.clampExplorerFocus();
            this.scene.markDirty();
            sendViewportUpdate = true;
        } else if (moveEvents.get(UserInputEvent.MoveDown)) {
            this.explorerFocusOn.y += this.EDITOR_MODE_SCROLL_SPEED;
            this.clampExplorerFocus();
            this.scene.markDirty();
            sendViewportUpdate = true;
        }

        if (moveEvents.get(UserInputEvent.MoveLeft)) {
            this.explorerFocusOn.x -= this.EDITOR_MODE_SCROLL_SPEED;
            this.clampExplorerFocus();
            this.scene.markDirty();
            sendViewportUpdate = true;
        } else if (moveEvents.get(UserInputEvent.MoveRight)) {
            this.explorerFocusOn.x += this.EDITOR_MODE_SCROLL_SPEED;
            this.clampExplorerFocus();
            this.scene.markDirty();
            sendViewportUpdate = true;
        }

        if (sendViewportUpdate) {
            this.scene.sendViewportToServer();
        }
    }

    public startFollowPlayer(
        player: Player | RemotePlayer,
        duration = 0,
        targetZoomLevel: number | undefined = undefined
    ): void {
        this.playerToFollow = player;
        this.setCameraMode(CameraMode.Follow);
        if (duration === 0) {
            this.camera.startFollow(player, true);
            this.scene.markDirty();
            this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
            this.refreshZoomBounds();
            this.snapCurrentZoomToDiscreteLevel();
            return;
        }
        this.setExplorationMode();
        if (!this.explorerFocusOn) {
            this.explorerFocusOn = { x: this.camera.centerX, y: this.camera.centerY };
            this.camera.startFollow(this.explorerFocusOn, true);
        }

        const oldPos = { ...this.explorerFocusOn };
        const startZoomModifier = this.waScaleManager.zoomModifier;
        this.animationInProgress = true;
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animateCallback);
        this.targetReachInProgress = false;
        this.explorerFocusOnTarget = undefined;
        this.stopPan();
        this.startFollowTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration,
            ease: Easing.SineEaseOut,
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                if (!this.playerToFollow) {
                    return;
                }
                const progress = tween.getValue() ?? 0;
                const shiftX = (this.playerToFollow.x - oldPos.x) * progress;
                const shiftY = (this.playerToFollow.y - oldPos.y) * progress;
                this.explorerFocusOn.x = oldPos.x + shiftX;
                this.explorerFocusOn.y = oldPos.y + shiftY;
                if (targetZoomLevel !== undefined) {
                    this.waScaleManager.setRuntimeZoomModifier(
                        (targetZoomLevel - startZoomModifier) * progress + startZoomModifier,
                        this.camera
                    );
                }

                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
            onComplete: () => {
                this.setCameraMode(CameraMode.Follow); 
                this.camera.startFollow(player, true);
                this.animationInProgress = false;
                this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
                this.refreshZoomBounds();
                this.snapCurrentZoomToDiscreteLevel();
                this.startFollowTween = undefined;
            },
        });
    }

    /**
     * Follow a remote player by their UUID. Centers the camera on them and shows a popup.
     */
    public followRemotePlayer(userUuid: string): void {
        // Find the remote player by UUID
        let remotePlayer = null;
        for (const [, player] of this.scene.MapPlayersByKey) {
            if (player.userUuid === userUuid) {
                remotePlayer = player;
                break;
            }
        }

        if (!remotePlayer) {
            console.warn(`Remote player with UUID ${userUuid} not found`);
            return;
        }

        // Restore camera mode
        this.startFollowPlayer(remotePlayer, 1000);
    }

    /**
     * Stop following a remote player.
     */
    public stopFollowRemotePlayer(): void {
        // Start following the current player
        this.startFollowPlayer(this.scene.CurrentPlayer, 1000);
    }

    /**
     * Updates the offset of the character compared to the center of the screen according to the layout manager
     * (tries to put the character in the center of the remaining space if there is a discussion going on.
     */
    public updateCameraOffset(box: Box, instant = false): void {
        if (this.cameraMode !== CameraMode.Follow || box.xEnd === undefined || box.yEnd === undefined) {
            return;
        }
        const xCenter = (box.xEnd - box.xStart) / 2 + box.xStart;
        const yCenter = (box.yEnd - box.yStart) / 2 + box.yStart;

        const game = HtmlUtils.querySelectorOrFail<HTMLCanvasElement>("#game canvas");

        // Let's put this in Game coordinates by applying the zoom level:
        let followOffsetX = (xCenter - game.offsetWidth / 2) / this.scene.scale.zoom;
        let followOffsetY = (yCenter - game.offsetHeight / 2) / this.scene.scale.zoom;
        const dpr = window.devicePixelRatio ?? 1;
        const eff = (this.camera.zoom || 1) * (this.scene.scale.zoom || 1) * dpr;
        if (eff <= 1.000001) {
            const q = eff > 0 ? 1 / eff : 1;
            followOffsetX = Math.round(followOffsetX / q) * q;
            followOffsetY = Math.round(followOffsetY / q) * q;
        }

        if (instant) {
            this.camera.setFollowOffset(followOffsetX, followOffsetY);
            this.scene.markDirty();
            return;
        }

        const oldFollowOffsetX = this.camera.followOffset.x;
        const oldFollowOffsetY = this.camera.followOffset.y;

        this.animationInProgress = true;
        if (this.cameraOffsetCurrentTween) {
            this.cameraOffsetCurrentTween.stop();
            this.cameraOffsetCurrentTween.destroy();
            this.cameraOffsetCurrentTween = undefined;
        }
        this.cameraOffsetCurrentTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 500,
            ease: Easing.QuadEaseOut,
            onStart: () => {
                this.animationInProgress = true;
            },
            onUpdate: (tween) => {
                const progress = tween.getValue() ?? 0;
                const newOffsetX = oldFollowOffsetX + (followOffsetX - oldFollowOffsetX) * progress;
                const newOffsetY = oldFollowOffsetY + (followOffsetY - oldFollowOffsetY) * progress;
                this.camera.setFollowOffset(newOffsetX, newOffsetY);
                this.scene.markDirty();
            },
            onComplete: () => {
                this.animationInProgress = false;
            },
        });
    }

    public isCameraLocked(): boolean {
        return this.cameraLocked;
    }

    public isZoomLocked(): boolean {
        return this.isCameraLocked() || this.zoomLocked;
    }

    private getZoomModifierChange(width?: number, height?: number, multiplier = 1): number {
        if (!width || !height) {
            return 0;
        }
        const targetZoomModifier = this.waScaleManager.getTargetZoomModifierFor(
            width * multiplier,
            height * multiplier
        );
        const currentZoomModifier = this.waScaleManager.zoomModifier;
        return targetZoomModifier - currentZoomModifier;
    }

    public unlockCameraWithDelay(delay: number): void {
        this.scene.time.delayedCall(delay, () => {
            this.cameraLocked = false;
        });
    }

    public lockZoom(): void {
        this.zoomLocked = true;
    }

    public unlockZoom(): void {
        this.zoomLocked = false;
    }

    private setCameraMode(mode: CameraMode): void {
        if (this.cameraMode === mode) {
            return;
        }
        this.cameraMode = mode;
        this.updateRoundPixelsForMode();
    }

    public isInExplorationMode(): boolean {
        return this.cameraMode === CameraMode.Exploration;
    }

    private restoreZoom(duration = 0): void {
        if (duration === 0) {
            this.waScaleManager.setRuntimeZoomModifier(this.waScaleManager.getSaveZoom(), this.camera);
            return;
        }
        this.animationInProgress = true;
        this.restoreZoomTween?.stop();
        this.restoreZoomTween = this.scene.tweens.addCounter({
            from: this.waScaleManager.zoomModifier,
            to: this.waScaleManager.getSaveZoom(),
            duration,
            ease: Easing.SineEaseOut,
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                this.waScaleManager.setRuntimeZoomModifier(tween.getValue() ?? 0, this.camera);
                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
            onComplete: () => {
                this.animationInProgress = false;
            },
        });
    }

    private initCamera() {
        this.camera = this.scene.cameras.main;
        this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
    }

    private onFollowUpdate = () => {
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    };

    private bindEventHandlers(): void {
        this.scene.game.events.on(
            WaScaleManagerEvent.RefreshFocusOnTarget,
            (focusOn: { x: number; y: number; width: number; height: number }) => {
                if (!focusOn) {
                    return;
                }

                this.camera.centerOn(focusOn.x, focusOn.y);

                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            }
        );

        this.camera.on("followupdate", this.onFollowUpdate);
    }

    private getCameraUpdateEventData(): CameraManagerEventCameraUpdateData {
        return {
            x: this.camera.worldView.x,
            y: this.camera.worldView.y,
            width: this.camera.worldView.width,
            height: this.camera.worldView.height,
            zoom: this.camera.scaleManager.zoom,
        };
    }

    // Create function to define the camera on exploration mode. The camera can be moved anywhere on the map. The camera is not locked on the player. The camera can be zoomed in and out. The camera can be moved with the mouse. The camera can be moved with the keyboard. The camera can be moved with the touchpad.
    public setExplorationMode(allowOutsideMap = true): void {
        this.cameraLocked = false;
        //this.stopFollow();
        this.setCameraMode(CameraMode.Exploration);
        this.explorationAllowOutsideMap = allowOutsideMap;

        this.camera.setFollowOffset(0, 0);

        if (allowOutsideMap) {
            this.camera.setBounds(
                -this.mapSize.width,
                -this.mapSize.height,
                this.mapSize.width * 3,
                this.mapSize.height * 3,
                false
            );
        } else {
            this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
        }

        this.explorerFocusOn = {
            x: this.camera.scrollX + this.camera.width / 2,
            y: this.camera.scrollY + this.camera.height / 2,
        };
        this.clampExplorerFocus();
        // In exploration mode, keep sub-pixel camera movement for smooth drag/pan.
        this.camera.startFollow(this.explorerFocusOn, false);
        this.refreshZoomBounds();
        this.snapCurrentZoomToDiscreteLevel();

        // Center the camera on the player
        //this.scene.cameras.main.centerOn(this.scene.CurrentPlayer.x, this.scene.CurrentPlayer.y);

        //const targetZoomModifier = this.waScaleManager.getTargetZoomModifierFor(mapWidth, mapHeight);
        //this.waScaleManager.maxZoomOut = targetZoomModifier;
    }

    public refreshZoomBounds(): void {
        this.waScaleManager.maxZoomOut = this.getFitZoomModifier();
    }

    public setResizeInProgress(isInProgress: boolean): void {
        this.resizeInProgress = isInProgress;
        if (isInProgress) {
            this.wheelZoomAccumulator = 0;
            this.cancelSmoothZoomAndAnchor();
        }
    }

    public getZoomModifier(): number {
        return this.waScaleManager.zoomModifier;
    }

    public captureZoomStateSnapshot(): CameraZoomStateSnapshot {
        const minCameraZoom = this.getMinimumCameraZoomForCurrentView();
        const maxCameraZoom = this.getMaximumCameraZoomForCurrentView();
        const levels = this.buildDiscreteCameraZoomLevels(minCameraZoom, maxCameraZoom);

        const currentCameraZoom = Clamp(this.camera.zoom, minCameraZoom, maxCameraZoom);
        const index = this.getClosestZoomLevelIndex(levels, currentCameraZoom);
        const normalizedDiscreteLevel = levels.length <= 1 ? 0 : index / (levels.length - 1);

        const scaleZoom = this.scene.scale.zoom || 1;

        return {
            cameraZoom: currentCameraZoom,
            normalizedDiscreteLevel,
            effectiveCssZoom: currentCameraZoom * scaleZoom,
        };
    }

    public restoreZoomStateSnapshotAfterResize(snapshot: CameraZoomStateSnapshot): void {
        if (!snapshot || !Number.isFinite(snapshot.cameraZoom)) {
            this.snapCurrentZoomToDiscreteLevel();
            return;
        }

        this.cancelSmoothZoomAndAnchor();

        const minCameraZoom = this.getMinimumCameraZoomForCurrentView();
        const maxCameraZoom = this.getMaximumCameraZoomForCurrentView();
        const levels = this.buildDiscreteCameraZoomLevels(minCameraZoom, maxCameraZoom);

        const scaleZoomNow = this.scene.scale.zoom || 1;

        // NEW: preserve effective css zoom across resize
        let targetCameraZoom = snapshot.effectiveCssZoom
            ? snapshot.effectiveCssZoom / scaleZoomNow
            : snapshot.cameraZoom;

        targetCameraZoom = Clamp(targetCameraZoom, minCameraZoom, maxCameraZoom);

        if (levels.length > 0) {
            const idx = this.getClosestZoomLevelIndex(levels, targetCameraZoom);
            targetCameraZoom = levels[idx] ?? targetCameraZoom;
        }

        if (Math.abs(this.camera.zoom - targetCameraZoom) > 0.000001) {
            this.waScaleManager.setRuntimeCameraZoom(targetCameraZoom, this.camera);
        }

        if (this.cameraMode === CameraMode.Exploration) {
            this.clampExplorerFocus();
        }

        this.scene.markDirty();
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    }

    public snapCurrentZoomToDiscreteLevel(): void {
        const minCameraZoom = this.getMinimumCameraZoomForCurrentView();
        const maxCameraZoom = this.getMaximumCameraZoomForCurrentView();
        const levels = this.buildDiscreteCameraZoomLevels(minCameraZoom, maxCameraZoom);
        const currentCameraZoom = Clamp(this.camera.zoom, minCameraZoom, maxCameraZoom);
        const closestIndex = this.getClosestZoomLevelIndex(levels, currentCameraZoom);
        const snappedCameraZoom = levels[closestIndex] ?? currentCameraZoom;

        if (Math.abs(snappedCameraZoom - this.camera.zoom) <= 0.000001) {
            return;
        }

        this.waScaleManager.setRuntimeCameraZoom(snappedCameraZoom, this.camera);
        this.snapCameraToPixelGrid();
        if (this.cameraMode === CameraMode.Exploration) {
            this.clampExplorerFocus();
        }
        this.scene.markDirty();
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    }

    private getFitCameraZoom(): number {
        const safeMapWidth = Math.max(this.mapSize.width, 1);
        const safeMapHeight = Math.max(this.mapSize.height, 1);
        return Math.max(Math.min(this.camera.width / safeMapWidth, this.camera.height / safeMapHeight), Number.EPSILON);
    }

    private getFitZoomModifier(): number {
        return this.waScaleManager.cameraZoomToZoomModifier(this.getFitCameraZoom());
    }

    private quantizeMinZoomToTileGrid(minZoom: number): number {
        const dpr = window.devicePixelRatio ?? 1;
        const scaleZoom = this.scene.scale.zoom || 1; // ScaleManager zoom
        const tileSize = 32; // <-- set to your actual tile size

        // Convert camera zoom -> effective screen scale
        const eff = minZoom * scaleZoom * dpr;

        // Choose the smallest eff >= current that makes tileSize*eff integer
        const k = Math.ceil(tileSize * eff);
        const effQuant = k / tileSize;

        // Convert back to camera zoom
        return effQuant / (scaleZoom * dpr);
    }

    private getSafeFitCameraZoom(): number {
        const fit = this.getFitCameraZoom();
        console.log(
            `Fit zoom: ${fit}, fit * safe factor: ${
                fit * this.SAFE_MIN_ZOOM_OUT_FACTOR
            }, max camera zoom: ${this.getMaximumCameraZoomForCurrentView()}`
        );
        const maxCameraZoom = this.getMaximumCameraZoomForCurrentView();

        // you already keep it slightly zoomed-in vs fit (good)
        const safe = Math.min(fit * this.SAFE_MIN_ZOOM_OUT_FACTOR, maxCameraZoom);

        // NEW: quantize so pixel art minification doesn't get a cursed ratio
        return Math.min(this.quantizeMinZoomToTileGrid(safe), maxCameraZoom);
    }

    private getMinimumCameraZoomForCurrentView(): number {
        const fitMinimum = this.getSafeFitCameraZoom();
        if (this.cameraMode === CameraMode.Exploration) {
            return Math.min(fitMinimum, this.getMaximumCameraZoomForCurrentView());
        }
        let minimum = fitMinimum;

        if (this.cameraMode !== CameraMode.Follow) {
            return minimum;
        }

        const followMinimum = fitMinimum * this.FOLLOW_MIN_ZOOM_MARGIN;
        minimum = Math.max(minimum, followMinimum);
        return Math.min(minimum, this.getMaximumCameraZoomForCurrentView());
    }

    private getMaximumCameraZoomForCurrentView(): number {
        return this.waScaleManager.zoomModifierToCameraZoom(this.getMaximumZoomModifierForCurrentView());
    }

    private getMinimumZoomModifierForCurrentView(): number {
        return this.waScaleManager.cameraZoomToZoomModifier(this.getMinimumCameraZoomForCurrentView());
    }

    private getMaximumZoomModifierForCurrentView(): number {
        return this.waScaleManager.getMaximumZoomModifierForCurrentView();
    }

    private buildDiscreteZoomLevels(minZoomModifier: number, maxZoomModifier: number): number[] {
        if (
            !Number.isFinite(minZoomModifier) ||
            !Number.isFinite(maxZoomModifier) ||
            minZoomModifier <= 0 ||
            maxZoomModifier <= 0
        ) {
            return [this.waScaleManager.zoomModifier];
        }

        if (maxZoomModifier <= minZoomModifier) {
            return [minZoomModifier];
        }

        const levels: number[] = [];
        const minLog = Math.log(minZoomModifier);
        const maxLog = Math.log(maxZoomModifier);
        const denom = this.DISCRETE_ZOOM_LEVEL_COUNT - 1;

        for (let i = 0; i < this.DISCRETE_ZOOM_LEVEL_COUNT; i++) {
            const t = i / denom;
            levels.push(Math.exp(minLog + t * (maxLog - minLog)));
        }

        return levels;
    }

    private buildDiscreteCameraZoomLevels(minCameraZoom: number, maxCameraZoom: number): number[] {
        const levels = this.buildDiscreteZoomLevels(minCameraZoom, maxCameraZoom);
        if (levels.length <= 4 || this.DISCRETE_EDGE_SKIP_LEVELS <= 0) {
            return levels;
        }

        const skip = Clamp(this.DISCRETE_EDGE_SKIP_LEVELS, 0, levels.length - 1);
        const sliced = levels.slice(skip);
        return sliced.length > 0 ? sliced : [levels[levels.length - 1]];
    }

    private getClosestZoomLevelIndex(levels: number[], zoomModifier: number): number {
        let closestIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < levels.length; i++) {
            const distance = Math.abs(levels[i] - zoomModifier);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }
        return closestIndex;
    }

    private normalizeWheelDelta(deltaY: number): number {
        // Phaser already gives us pixel-like deltas in most environments.
        // Clamp outliers so stalled frames don't cause giant zoom jumps.
        return Clamp(deltaY, -1000, 1000);
    }

    public zoomByWheelDelta(deltaY: number, smooth: boolean): void {
        if (this.resizeInProgress || this.isZoomLocked() || !Number.isFinite(deltaY) || deltaY === 0) {
            return;
        }

        const normalizedDelta = this.normalizeWheelDelta(deltaY);
        this.wheelZoomAccumulator += normalizedDelta;

        let steps = 0;
        while (Math.abs(this.wheelZoomAccumulator) >= this.NORMALIZED_WHEEL_STEP) {
            const direction = Math.sign(this.wheelZoomAccumulator);
            this.wheelZoomAccumulator -= direction * this.NORMALIZED_WHEEL_STEP;
            steps += direction;
            if (Math.abs(steps) >= this.MAX_WHEEL_STEPS_PER_EVENT) {
                break;
            }
        }

        if (steps === 0) {
            return;
        }

        const minCameraZoom = this.getMinimumCameraZoomForCurrentView();
        const maxCameraZoom = this.getMaximumCameraZoomForCurrentView();
        const levels = this.buildDiscreteCameraZoomLevels(minCameraZoom, maxCameraZoom);
        const currentCameraZoom = Clamp(this.camera.zoom, minCameraZoom, maxCameraZoom);
        const currentIndex = this.getClosestZoomLevelIndex(levels, currentCameraZoom);

        // Positive wheel delta means zoom-out in browser semantics.
        const nextIndex = Clamp(currentIndex - steps, 0, levels.length - 1);
        if (nextIndex === currentIndex) {
            return;
        }

        const nextCameraZoom = levels[nextIndex];
        if (smooth) {
            this.animateToZoomLevel(this.waScaleManager.cameraZoomToZoomModifier(nextCameraZoom));
        } else {
            this.waScaleManager.setRuntimeCameraZoom(nextCameraZoom, this.camera);
            this.snapCameraToPixelGrid();
            // Camera matrices/worldView are not always fully coherent in the same tick as setZoom().
            // Defer anchor correction to the next update frame to keep cursor-anchored zoom reliable.
            this.startAnimation();
        }
    }

    public triggerMaxZoomOutAnimation(): void {
        const targetZoomModifier = this.getFitZoomModifier();

        this.startFollowTween?.stop();
        this.startFollowTween = undefined;
        this.animationInProgress = false;

        this.centerCameraOn({ x: this.mapSize.width / 2, y: this.mapSize.height / 2 }, targetZoomModifier);
    }

    private stopPan(): void {
        this.camera.panEffect.reset();
    }

    public centerCameraOn(position: { x: number; y: number }, zoom?: number): void {
        this.explorerFocusOnTarget = {
            ...position,
            zoom: zoom ?? this.waScaleManager.zoomModifier,
        };

        if (zoom === undefined && this.waScaleManager.zoomModifier < this._resistanceEndZoomLevel) {
            this.explorerFocusOnTarget.zoom = this._resistanceEndZoomLevel;
        }

        this.startAnimation();
    }

    /**
     * Zooms the camera by a factor passed in parameter.
     * Is the final zoom level is greater than the max zoom level, an animation will slowly bring back the camera to the max zoom level
     * (if no animation is currently running)
     *
     * Also, this supports the notion of "WALL".
     * The wall can be "in-place" or "broken". When the wall is in place, it is NOT possible to pass the resistance zone.
     * We do this by altering the zoom factor to make it slower as we are getting closer to the resistance zone end.
     *
     * When we get out of the resistance zone OR if we are in the resistance zone but zoom towards the start of the zone,
     * we break the wall for 10 seconds.
     */
    public zoomByFactor(zoomFactor: number, smooth: boolean): void {
        // Keep zoom-out clamped to map bounds (avoid blank space around the map)
        const minZoomModifier = this.getMinimumZoomModifierForCurrentView();
        const maxZoomModifier = this.getMaximumZoomModifierForCurrentView();

        const wallBroken = Date.now() - this.wallDownDate < 10000 || this.enableResistanceWall === false;
        if (
            this.isBetween(
                this.waScaleManager.zoomModifier,
                this._resistanceStartZoomLevel,
                this._resistanceEndZoomLevel
            )
        ) {
            if (
                !wallBroken &&
                ((this._resistanceEndZoomLevel < this._resistanceStartZoomLevel && zoomFactor < 1) ||
                    (this.resistanceEndZoomLevel > this.resistanceStartZoomLevel && zoomFactor > 1))
            ) {
                // Let's alter the zoom factor to make it slower if we are in the resistance zone.
                //const maxZoomFactor = this._resistanceEndZoomLevel / this.waScaleManager.zoomModifier;
                const lambda =
                    5 / ((this.resistanceEndZoomLevel - this.resistanceStartZoomLevel) * this._resistanceEndZoomLevel);

                const resultZoom =
                    this.resistanceEndZoomLevel - 1 / (lambda * this.waScaleManager.zoomModifier * zoomFactor);
                zoomFactor = resultZoom / this.waScaleManager.zoomModifier;
            } else {
                // We zoom in the opposite direction, let's break the wall for 10 seconds.
                this.wallDownDate = Date.now();
                debugZoom("Resistance wall is broken because we scrolled towards the start of the resistance zone");
            }
        }

        const targetZoom = this.waScaleManager.zoomModifier * zoomFactor;
        const clampedZoom = Clamp(targetZoom, minZoomModifier, maxZoomModifier);

        if (!smooth) {
            waScaleManager.setRuntimeZoomModifier(clampedZoom, this.camera);
            this.applyZoomAnchor();
            this.clearZoomAnchor();
        } else {
            this.animateToZoomLevel(clampedZoom);
        }

        if (this.animationInProgress) {
            // Let's not trigger the resistance if the zoom in or out originates from an animation.
            return;
        }

        if (!this.resistanceCallback) {
            // If there is no resistance configured, let's return.
            return;
        }

        if (
            this.isBetween(
                this.waScaleManager.zoomModifier,
                this._resistanceStartZoomLevel,
                this._resistanceEndZoomLevel
            ) &&
            this.isCameraWithinWokaRadius()
        ) {
            if (!this.resistZoomCallback) {
                this.resistZoomCallback = this.resistZoom.bind(this);
                this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.resistZoomCallback);
                this.resistanceZoneEnterDate = Date.now();
            }
        }
    }

    private isCameraWithinWokaRadius(): boolean {
        if (this.resistanceRadiusAroundWoka === undefined || !this.player) {
            return true;
        }
        const cameraCenter = {
            x: this.camera.worldView.x + this.camera.worldView.width / 2,
            y: this.camera.worldView.y + this.camera.worldView.height / 2,
        };
        const distance = Math.sqrt(
            Math.pow(cameraCenter.x - this.player.x, 2) + Math.pow(cameraCenter.y - this.player.y, 2)
        );
        return distance < this.resistanceRadiusAroundWoka;
    }

    /**
     * Returns true if the value is between the two bounds (strictly).
     * The 2 bounds can be in any order.
     */
    private isBetween(value: number, bound1: number, bound2: number): boolean {
        return (value > bound1 && value < bound2) || (value > bound2 && value < bound1);
    }

    private animateToZoomLevel(targetZoomModifier: number): void {
        this.targetZoomModifier = targetZoomModifier;
        this.targetDirection = this.targetZoomModifier > this.waScaleManager.zoomModifier ? "zoom_in" : "zoom_out";
        this.startAnimation();
    }

    private startAnimation() {
        if (!this.targetReachInProgress) {
            this.targetReachInProgress = true;
            this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.animateCallback);
        }
    }

    private animate(time: number, delta: number): void {
        if (this.animationInProgress) {
            return;
        }
        const minZoomModifier = this.getMinimumZoomModifierForCurrentView();
        const maxZoomModifier = this.getMaximumZoomModifierForCurrentView();
        if (this.targetZoomModifier !== undefined) {
            let targetZoomModifier;
            if (this.targetDirection === "zoom_in") {
                targetZoomModifier = this.targetZoomModifier * 1.01;
            } else {
                targetZoomModifier = this.targetZoomModifier / 1.01;
            }

            let newZoom =
                this.waScaleManager.zoomModifier +
                (((targetZoomModifier - this.waScaleManager.zoomModifier) * delta) / 100) * this.cameraZoomSpeed;

            if (this.targetDirection === "zoom_in" && newZoom > this.targetZoomModifier) {
                newZoom = this.targetZoomModifier;
                this.targetZoomModifier = undefined;
            } else if (this.targetDirection === "zoom_out" && newZoom <= this.targetZoomModifier) {
                newZoom = this.targetZoomModifier;
                this.targetZoomModifier = undefined;
            }

            if (newZoom < minZoomModifier || newZoom > maxZoomModifier) {
                newZoom = Clamp(newZoom, minZoomModifier, maxZoomModifier);
                if (this.targetDirection === "zoom_out") {
                    this.targetZoomModifier = undefined;
                }
                if (this.targetDirection === "zoom_in") {
                    this.targetZoomModifier = undefined;
                }
            }

            waScaleManager.setRuntimeZoomModifier(newZoom, this.camera);
            this.clampExplorerFocus();
        }

        // Let's move the camera according to the speed
        if (this.cameraSpeed) {
            this.explorerFocusOn.x += (this.cameraSpeed.x * delta) / 400;
            this.explorerFocusOn.y += (this.cameraSpeed.y * delta) / 400;
            this.clampExplorerFocus();

            // Now, let's slow down the camera a bit
            this.cameraSpeed.x *= 1 - delta / 500;
            this.cameraSpeed.y *= 1 - delta / 500;
            if (Math.pow(this.cameraSpeed.x, 2) + Math.pow(this.cameraSpeed.y, 2) < 20) {
                this.cameraSpeed = undefined;
            }
        }

        if (this.explorerFocusOnTarget) {
            let newZoom =
                this.waScaleManager.zoomModifier +
                (((this.explorerFocusOnTarget.zoom - this.waScaleManager.zoomModifier) * delta) / 100) *
                    this.focusTargetSpeed;

            let x =
                this.explorerFocusOn.x +
                (((this.explorerFocusOnTarget.x - this.explorerFocusOn.x) * delta) / 100) * this.focusTargetSpeed;
            let y =
                this.explorerFocusOn.y +
                (((this.explorerFocusOnTarget.y - this.explorerFocusOn.y) * delta) / 100) * this.focusTargetSpeed;

            if (Math.abs(this.explorerFocusOnTarget.x - x) < 1 && Math.abs(this.explorerFocusOnTarget.y - y) < 1) {
                x = this.explorerFocusOnTarget.x;
                y = this.explorerFocusOnTarget.y;
                newZoom = this.explorerFocusOnTarget.zoom;
                this.explorerFocusOnTarget = undefined;
            }

            newZoom = Clamp(newZoom, minZoomModifier, maxZoomModifier);

            waScaleManager.setRuntimeZoomModifier(newZoom, this.camera);
            this.explorerFocusOn.x = x;
            this.explorerFocusOn.y = y;
            this.clampExplorerFocus();
        }

        this.applyZoomAnchor();
        this.snapCameraToPixelGrid();

        if (
            this.cameraSpeed === undefined &&
            this.targetZoomModifier === undefined &&
            this.explorerFocusOnTarget === undefined
        ) {
            this.clearZoomAnchor();
            this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animateCallback);
            this.targetReachInProgress = false;
        }

        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    }
    private snapCameraToPixelGrid(): void {
        const camZoom = this.camera.zoom || 1;
        const scaleZoom = this.scene.scale.zoom || 1;
        const dpr = window.devicePixelRatio ?? 1;

        // Effective device pixels per world unit
        const eff = camZoom * scaleZoom * dpr;
        if (!Number.isFinite(eff) || eff <= 0) return;

        // Only snap when we're minifying / at-or-below 1 device-pixel per world-unit
        if (eff > 1.000001) return;

        // 1 device pixel == 1/eff world units
        const q = 1 / eff;
        const snap = (v: number) => Math.round(v / q) * q;

        if (this.cameraMode === CameraMode.Exploration) {
            this.explorerFocusOn.x = snap(this.explorerFocusOn.x);
            this.explorerFocusOn.y = snap(this.explorerFocusOn.y);
        } else {
            // In Follow mode scroll is driven by follow each frame; snapping offset is the important part.
            // Still OK to snap scroll a bit, but followOffset snapping is the big win.
            this.camera.scrollX = snap(this.camera.scrollX);
            this.camera.scrollY = snap(this.camera.scrollY);
        }

        // Follow offset is a common fractional source
        this.camera.setFollowOffset(snap(this.camera.followOffset.x), snap(this.camera.followOffset.y));
    }

    private resistZoomCallback: ((time: number, delta: number) => void) | undefined;
    private resistZoom(time: number, delta: number): void {
        if (this.animationInProgress) {
            return;
        }
        // If we are out of resistance zone, let's stop the resistance.
        if (
            !this.isBetween(
                this.waScaleManager.zoomModifier,
                this._resistanceStartZoomLevel,
                this._resistanceEndZoomLevel
            )
        ) {
            this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.resistZoomCallback);
            this.resistZoomCallback = undefined;
            this.scene.removeWhiteMask();
            if (
                this.resistanceCallback &&
                ((this._resistanceStartZoomLevel < this._resistanceEndZoomLevel &&
                    this.waScaleManager.zoomModifier > this._resistanceEndZoomLevel) ||
                    (this._resistanceEndZoomLevel < this._resistanceStartZoomLevel &&
                        this.waScaleManager.zoomModifier < this._resistanceEndZoomLevel))
            ) {
                this.resistanceCallback();
                this.wallDownDate = 0;
                this.resistanceZoneEnterDate = 0;
                debugZoom("We passed through resistance zone. Resistance wall is back up");
                debugZoom("this._resistanceStartZoomLevel", this._resistanceStartZoomLevel);
                debugZoom("this._resistanceEndZoomLevel", this._resistanceEndZoomLevel);
                debugZoom("this.waScaleManager.zoomModifier", this.waScaleManager.zoomModifier);
            } else {
                this.wallDownDate = Date.now();
                this.resistanceZoneEnterDate = 0;
                debugZoom("Resistance wall is broken because we left the resistance zone");
                debugZoom("this._resistanceStartZoomLevel", this._resistanceStartZoomLevel);
                debugZoom("this._resistanceEndZoomLevel", this._resistanceEndZoomLevel);
                debugZoom("this.waScaleManager.zoomModifier", this.waScaleManager.zoomModifier);
            }

            return;
        }

        // Let's calculate the new zoom level
        // Our target point is 10% before the resistance zone
        const targetZoom =
            this._resistanceStartZoomLevel - (this._resistanceEndZoomLevel - this._resistanceStartZoomLevel) * 0.1;

        const newZoom =
            (this.targetZoomModifier ?? this.waScaleManager.zoomModifier) +
            (((targetZoom - (this.targetZoomModifier ?? this.waScaleManager.zoomModifier)) * delta) / 250) *
                this._resistanceStrength;
        //this.targetZoomModifier = newZoom;

        this.animateToZoomLevel(newZoom);

        // If the wall is not broken and we spent more than 2 seconds in the resistance zone, let's break the wall.
        if (this.wallDownDate === 0 && Date.now() - this.resistanceZoneEnterDate > 2000) {
            this.wallDownDate = Date.now();
            debugZoom("Resistance wall is broken because we spent 2 seconds in the resistance zone");
        }

        // The alpha is calculated based on the distance between the current zoom level and the resistance zone
        // The closer we are to the resistance zone, the more the alpha is important.
        // We apply a "sqrt" function to make the white layer appear gently if we are close to the start of the resistance
        // zone and faster as we are closer to the end of the resistance zone.
        const alpha = Clamp(
            1 -
                Math.sqrt(
                    (this.waScaleManager.zoomModifier - this._resistanceEndZoomLevel) /
                        (this._resistanceStartZoomLevel - this._resistanceEndZoomLevel)
                ),
            0,
            1
        );

        this.scene.applyWhiteMask(alpha);
    }

    /**
     * Set the resistance zone for the zoom level. The resistance zone is a zone where the camera will resist to zoom in or out.
     * If the resistance zone is overcome, the callback will be called.
     *
     * There can be only one resistance zone at a time.
     *
     * @param startZoomLevel
     * @param endZoomLevel
     * @param strength
     * @param callback
     * @param enableResistanceWall
     * @param resistanceRadiusAroundWoka If set, the resistance is enabled ONLY if the camera is within this radius around the woka
     * @param player
     */
    public setResistanceZone(
        startZoomLevel: number,
        endZoomLevel: number,
        strength: number,
        callback: () => void,
        enableResistanceWall: boolean,
        resistanceRadiusAroundWoka: number | undefined,
        player: Player
    ): void {
        this._resistanceStartZoomLevel = startZoomLevel;
        this._resistanceEndZoomLevel = endZoomLevel;
        this._resistanceStrength = strength;
        this.enableResistanceWall = enableResistanceWall;
        this.resistanceRadiusAroundWoka = resistanceRadiusAroundWoka;
        this.player = player;

        this.resistanceCallback = callback;
    }

    public disableResistanceZone(): void {
        this.scene.removeWhiteMask();
        if (this.resistZoomCallback) {
            this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.resistZoomCallback);
            this.resistZoomCallback = undefined;
        }
    }

    get resistanceStartZoomLevel(): number {
        return this._resistanceStartZoomLevel;
    }

    get resistanceEndZoomLevel(): number {
        return this._resistanceEndZoomLevel;
    }

    emit(event: string | symbol, ...args: unknown[]): boolean {
        // If the camera is defined on Exploration mode, the camera manager events will be not emitted
        if (event === CameraManagerEvent.CameraUpdate && CameraMode.Exploration === this.cameraMode) return false;
        return super.emit(event, ...args);
    }

    setSpeed(speed: { x: number; y: number }) {
        this.cameraSpeed = speed;
        this.explorerFocusOnTarget = undefined;
        this.startAnimation();
    }

    stopSpeed() {
        this.cameraSpeed = undefined;
    }

    public cancelSmoothZoomAndAnchor(): void {
        this.targetZoomModifier = undefined;
        this.targetDirection = undefined;
        this.clearZoomAnchor();
    }

    scrollCamera(x: number, y: number): void {
        this.explorerFocusOn.x += x;
        this.explorerFocusOn.y += y;
        this.clampExplorerFocus();

        this.explorerFocusOnTarget = undefined;

        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
        this.scene.markDirty();
    }

    adjustCameraAnchor(deltaX: number, deltaY: number): void {
        if (this.cameraMode === CameraMode.Exploration) {
            this.scrollCamera(deltaX, deltaY);
            return;
        }

        const hasFollowTarget = Boolean(
            (this.camera as unknown as { followTarget?: Phaser.GameObjects.GameObject }).followTarget
        );
        if (hasFollowTarget) {
            this.camera.setFollowOffset(this.camera.followOffset.x + deltaX, this.camera.followOffset.y + deltaY);
            this.scene.markDirty();
            return;
        }

        this.camera.scrollX += deltaX;
        this.camera.scrollY += deltaY;
        this.scene.markDirty();
    }

    setZoomAnchor(anchor: { screenX: number; screenY: number; worldX: number; worldY: number } | undefined): void {
        this.zoomAnchor = anchor;
    }

    clearZoomAnchor(): void {
        this.zoomAnchor = undefined;
    }

    private clampExplorerFocus(): void {
        if (this.explorationAllowOutsideMap) {
            this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, 0, this.mapSize.width);
            this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, 0, this.mapSize.height);
            this.snapCameraToPixelGrid();

            return;
        }

        const halfViewWidth = this.camera.worldView.width / 2;
        const halfViewHeight = this.camera.worldView.height / 2;
        const minX = halfViewWidth;
        const maxX = this.mapSize.width - halfViewWidth;
        const minY = halfViewHeight;
        const maxY = this.mapSize.height - halfViewHeight;

        if (minX > maxX) {
            this.explorerFocusOn.x = this.mapSize.width / 2;
        } else {
            this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, minX, maxX);
        }

        if (minY > maxY) {
            this.explorerFocusOn.y = this.mapSize.height / 2;
        } else {
            this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, minY, maxY);
        }
    }

    private applyZoomAnchor(): void {
        if (!this.zoomAnchor) {
            return;
        }
        const { screenX, screenY, worldX, worldY } = this.zoomAnchor;

        if (this.cameraMode === CameraMode.Exploration) {
            // In exploration mode, the camera follows explorerFocusOn.
            // Compute the center directly from anchor + zoom to avoid one-frame lag from getWorldPoint().
            const zoom = this.camera.zoom || 1;
            const desiredCenterX = worldX - (screenX - this.camera.width / 2) / zoom;
            const desiredCenterY = worldY - (screenY - this.camera.height / 2) / zoom;
            const deltaX = desiredCenterX - this.explorerFocusOn.x;
            const deltaY = desiredCenterY - this.explorerFocusOn.y;

            if (Math.abs(deltaX) > 0.0001 || Math.abs(deltaY) > 0.0001) {
                this.scrollCamera(deltaX, deltaY);
            }
            return;
        }

        const current = this.camera.getWorldPoint(screenX, screenY);
        const deltaX = worldX - current.x;
        const deltaY = worldY - current.y;
        if (Math.abs(deltaX) > 0.0001 || Math.abs(deltaY) > 0.0001) {
            this.adjustCameraAnchor(deltaX, deltaY);
        }
    }

    private updateRoundPixelsForMode(): void {
        const camZoom = this.camera.zoom || 1;
        const scaleZoom = this.scene.scale.zoom || 1;
        const dpr = window.devicePixelRatio ?? 1;
        const eff = camZoom * scaleZoom * dpr;

        const zoomedOutVisually = eff <= 1.000001;
        this.camera.roundPixels = this.cameraMode !== CameraMode.Exploration || zoomedOutVisually;
    }
}
