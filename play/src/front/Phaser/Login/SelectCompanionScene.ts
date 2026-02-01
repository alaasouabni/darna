import type { CompanionTextureCollection } from "@workadventure/messages";
import { Loader } from "../Components/Loader";
import { gameManager } from "../Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import { touchScreenManager } from "../../Touch/TouchScreenManager";
import { PinchManager } from "../UserInput/PinchManager";
import {
    selectCompanionPreviewFrameStore,
    selectCompanionReadyStore,
    selectCompanionSceneVisibleStore,
} from "../../Stores/SelectCompanionStore";
import { inGameProfileEditStore } from "../../Stores/ProfileEditStore";
import { get, type Unsubscriber } from "svelte/store";
import { waScaleManager } from "../Services/WaScaleManager";
import { isMediaBreakpointUp } from "../../Utils/BreakpointsUtils";
import { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
import {
    companionListMetakey,
    CompanionTexturesLoadingManager,
    lazyLoadPlayerCompanionTexture,
} from "../Companion/CompanionTexturesLoadingManager";
import type { CompanionTextureDescriptionInterface } from "../Companion/CompanionTextures";
import { CompanionTextures } from "../Companion/CompanionTextures";
import { collectionsSizeStore, selectedCollection } from "../../Stores/SelectCharacterSceneStore";
import { connectionManager } from "../../Connection/ConnectionManager";
import { EnableCameraSceneName } from "./EnableCameraScene";
import { ResizableScene } from "./ResizableScene";
import { loaderVisibleStore } from "../../Stores/LoaderStore";
import { PROFILE_COMPANION_VARIABLE } from "../../Connection/ProfileVariables";

// Event listeners are valid for the lifetime of the Phaser scene and will be garbage collected when the object is destroyed
/* eslint-disable listeners/no-missing-remove-event-listener, listeners/no-inline-function-event-listener */

export const SelectCompanionSceneName = "SelectCompanionScene";

export class SelectCompanionScene extends ResizableScene {
    private selectedCompanion!: Phaser.Physics.Arcade.Sprite | null;
    private companions: Array<Phaser.Physics.Arcade.Sprite> = new Array<Phaser.Physics.Arcade.Sprite>();
    private companionModels!: CompanionTextureDescriptionInterface[];
    private companionCurrentCollection!: CompanionTextureDescriptionInterface[];
    private currentCompanionId!: string | null;

    private selectedCollectionIndex!: number;
    private companionTextures: CompanionTextures;
    private companionCollectionKeys: string[] = [];
    private currentCompanion = 0;
    private pointerClicked = false;
    private pointerTimer = 0;
    private loader: Loader;
    protected superLoad: SuperLoaderPlugin;
    private sceneCreated = false;
    private companionsInitialized = false;
    private previewFrameUnsub: Unsubscriber | undefined;

    constructor() {
        super({
            key: SelectCompanionSceneName,
        });
        this.companionTextures = new CompanionTextures();
        this.loader = new Loader(this);
        this.superLoad = new SuperLoaderPlugin(this);
    }

    preload() {
        const isInGameEdit = get(inGameProfileEditStore);
        this.cache.json.remove(companionListMetakey());
        selectCompanionReadyStore.set(false);

        const companionLoadingManager = new CompanionTexturesLoadingManager(this.superLoad, this.load);

        companionLoadingManager.loadTextures((collections: CompanionTextureCollection[]) => {
            this.companionTextures.mapTexturesMetadataIntoResources(collections);
            collectionsSizeStore.set(this.companionTextures.getCollectionsKeys().length);
            this.companionModels = companionLoadingManager.loadModels(this.load, this.companionTextures);
            const initAfterLoad = () => this.tryInitializeCompanions();
            if (this.load.isLoading()) {
                this.load.once(Phaser.Loader.Events.COMPLETE, initAfterLoad);
            } else {
                this.load.once(Phaser.Loader.Events.COMPLETE, initAfterLoad);
                this.load.start();
            }
        });
        if (!isInGameEdit) {
            this.loader.addLoader();
        } else {
            loaderVisibleStore.set(false);
        }
    }

    create() {
        this.sceneCreated = true;
        this.selectedCollectionIndex = 0;
        this.currentCompanion = 0;
        this.companionCollectionKeys = this.companionTextures.getCollectionsKeys();
        selectedCollection.set(this.getSelectedCollectionName());
        waScaleManager.saveZoom();
        waScaleManager.zoomModifier = isMediaBreakpointUp("md") ? 2 : 1;
        if (touchScreenManager.supportTouchScreen) {
            new PinchManager(this);
        }

        const companionTextureId = localUserStore.getCompanionTextureId();

        if (companionTextureId) {
            const companionCollectionKeyAndIndex =
                this.companionTextures.getCompanionCollectionAndIndexByCompanionId(companionTextureId);

            if (companionCollectionKeyAndIndex) {
                this.currentCompanionId = companionTextureId;
                const [companionCollectionKey, companionIndex] = companionCollectionKeyAndIndex;

                this.selectedCollectionIndex = this.companionCollectionKeys.indexOf(companionCollectionKey);
                if (companionIndex > -1 || companionIndex < this.companions.length) {
                    this.currentCompanion = companionIndex;
                    this.selectedCompanion = this.companions[companionIndex];
                }
                selectedCollection.set(this.getSelectedCollectionName());
            }
        }
        // input events
        this.input.keyboard?.on("keyup-ENTER", () => {
            this.selectCompanion.bind(this)().catch(console.error);
        });

        this.input.keyboard?.on("keydown-RIGHT", this.moveToRight.bind(this));
        this.input.keyboard?.on("keydown-LEFT", this.moveToLeft.bind(this));

        localUserStore.setCompanionTextureId(null);
        gameManager.setCompanionTextureId(null);

        this.tryInitializeCompanions();
        if (gameManager.currentStartedRoom.backgroundColor != undefined) {
            this.cameras.main.setBackgroundColor(gameManager.currentStartedRoom.backgroundColor);
        }

        if (get(inGameProfileEditStore)) {
            this.previewFrameUnsub?.();
            this.previewFrameUnsub = selectCompanionPreviewFrameStore.subscribe((frame) => {
                if (frame && this.companionsInitialized) {
                    this.moveCompanion();
                }
            });
        }
    }

    update(time: number, delta: number): void {
        // pointerTimer is set to 250 when pointerdown events is trigger
        // After 250ms, pointerClicked is set to false and the pointerdown events can be trigger again
        this.pointerTimer -= delta;
        if (this.pointerTimer <= 0) {
            this.pointerClicked = false;
        }
    }

    public async selectCompanion(): Promise<void> {
        const companionDescriptor = this.companionCurrentCollection[this.currentCompanion];
        const companionId = companionDescriptor.id;
        localUserStore.setCompanionTextureId(companionId);
        gameManager.setCompanionTextureId(companionId);
        await connectionManager.saveCompanionTexture(companionId, companionDescriptor);

        try {
            const currentPlayer = gameManager.getCurrentGameScene().CurrentPlayer;
            if (currentPlayer) {
                const texturePromise = lazyLoadPlayerCompanionTexture(
                    this.superLoad,
                    this.companionCurrentCollection[this.currentCompanion]
                );
                currentPlayer.updateCompanionTexture(texturePromise);
            }
            if (get(inGameProfileEditStore)) {
                const scene = gameManager.getCurrentGameScene();
                scene?.setProfileVariable(
                    PROFILE_COMPANION_VARIABLE,
                    this.companionCurrentCollection[this.currentCompanion]
                );
            }
        } catch (e) {
            console.warn("Could not update companion in scene", e);
        }

        this.closeScene();
    }

    public async noCompagnion(): Promise<void> {
        localUserStore.setCompanionTextureId(null);
        gameManager.setCompanionTextureId(null);
        await connectionManager.saveCompanionTexture(null, null);
        try {
            const currentPlayer = gameManager.getCurrentGameScene().CurrentPlayer;
            if (currentPlayer) {
                currentPlayer.updateCompanionTexture(null);
            }
            if (get(inGameProfileEditStore)) {
                const scene = gameManager.getCurrentGameScene();
                scene?.setProfileVariable(PROFILE_COMPANION_VARIABLE, null);
            }
        } catch (e) {
            console.warn("Could not update companion in scene", e);
        }

        this.closeScene();
    }

    public closeScene() {
        const isInGameEdit = get(inGameProfileEditStore);
        // next scene
        this.scene.stop(SelectCompanionSceneName);
        waScaleManager.restoreZoom();
        if (!isInGameEdit) {
            gameManager.tryResumingGame(EnableCameraSceneName);
        }
        this.scene.remove(SelectCompanionSceneName);
        selectCompanionSceneVisibleStore.set(false);
        selectCompanionReadyStore.set(false);
        this.previewFrameUnsub?.();
        this.previewFrameUnsub = undefined;
        if (isInGameEdit) {
            inGameProfileEditStore.set(false);
        }
    }

    private createCurrentCompanion(): void {
        this.companionCurrentCollection = this.companionTextures.getCompanionCollectionTextures(
            this.getSelectedCollectionName()
        );

        this.companionCurrentCollection.forEach((companionResource, index) => {
            const [middleX, middleY] = this.getCompanionPosition();
            const companion = this.physics.add.sprite(middleX, middleY, companionResource.id, 0);
            this.setUpCompanion(companion, index);
            this.anims.create({
                key: companionResource.id,
                frames: this.anims.generateFrameNumbers(companionResource.id, { start: 0, end: 2 }),
                frameRate: 10,
                repeat: -1,
            });

            companion.setInteractive().on("pointerdown", () => {
                if (this.pointerClicked) {
                    return;
                }
                //To not trigger two time the pointerdown events :
                // We set a boolean to true so that pointerdown events does nothing when the boolean is true
                // We set a timer that we decrease in update function to not trigger the pointerdown events twice
                this.pointerClicked = true;
                this.pointerTimer = 250;
                if (!localUserStore.getCompanionTextureId()) {
                    this.currentCompanion = index;
                }
                this.moveCompanion();
            });
            this.companions.push(companion);
        });
        this.selectedCompanion = this.companions[this.currentCompanion];
    }

    public onResize(): void {
        this.moveCompanion();
    }

    private updateSelectedCompanion(): void {
        this.selectedCompanion?.anims.pause();
        const companion = this.companions[this.currentCompanion];
        companion.play(this.companionCurrentCollection[this.currentCompanion].id);
        this.selectedCompanion = companion;
    }

    private moveCompanion() {
        for (let i = 0; i < this.companions.length; i++) {
            const companion = this.companions[i];
            this.setUpCompanion(companion, i);
        }
        this.updateSelectedCompanion();
    }

    private tryInitializeCompanions(): void {
        if (!this.sceneCreated || this.companionsInitialized) {
            return;
        }
        const keys = this.companionTextures.getCollectionsKeys();
        if (keys.length === 0) {
            return;
        }
        this.companionCollectionKeys = keys;
        selectedCollection.set(this.getSelectedCollectionName());
        this.createCurrentCompanion();
        this.updateSelectedCompanion();
        this.companionsInitialized = true;
        selectCompanionSceneVisibleStore.set(true);
        selectCompanionReadyStore.set(true);
    }

    public moveToRight() {
        if (this.currentCompanion === this.companions.length - 1) {
            return;
        }
        this.currentCompanion += 1;
        this.moveCompanion();
    }

    public moveToLeft() {
        if (this.currentCompanion === 0) {
            return;
        }
        this.currentCompanion -= 1;
        this.moveCompanion();
    }

    public getSelectedCollectionName(): string {
        return this.companionCollectionKeys[this.selectedCollectionIndex] ?? "";
    }

    public selectPreviousCompanionCollection() {
        this.selectedCollectionIndex = (this.selectedCollectionIndex + 1) % this.companionCollectionKeys.length;
        selectedCollection.set(this.getSelectedCollectionName());
        this.populateCompanionCollection();
    }

    public selectNextCompanionCollection() {
        if (this.companionCollectionKeys.length === 1) {
            return;
        }
        this.selectedCollectionIndex =
            this.selectedCollectionIndex - 1 < 0
                ? this.companionCollectionKeys.length - 1
                : this.selectedCollectionIndex - 1;
        selectedCollection.set(this.getSelectedCollectionName());
        this.populateCompanionCollection();
    }

    public populateCompanionCollection() {
        this.companions.forEach((companion) => companion.destroy());
        this.companions = [];
        this.selectedCompanion = null;
        this.currentCompanion = 0;
        this.createCurrentCompanion();
        this.moveCompanion();
    }

    private defineSetupCompanion(num: number) {
        const deltaX = 30;
        const deltaY = 2;
        let [companionX, companionY] = this.getCompanionPosition();
        let companionVisible = true;
        let companionScale = 1.5;
        let companionOpactity = 1;
        if (this.currentCompanion !== num) {
            companionVisible = false;
        }
        if (num === this.currentCompanion + 1) {
            companionY -= deltaY;
            companionX += deltaX;
            companionScale = 0.8;
            companionOpactity = 0.6;
            companionVisible = true;
        }
        if (num === this.currentCompanion + 2) {
            companionY -= deltaY;
            companionX += deltaX * 2;
            companionScale = 0.8;
            companionOpactity = 0.6;
            companionVisible = true;
        }
        if (num === this.currentCompanion - 1) {
            companionY -= deltaY;
            companionX -= deltaX;
            companionScale = 0.8;
            companionOpactity = 0.6;
            companionVisible = true;
        }
        if (num === this.currentCompanion - 2) {
            companionY -= deltaY;
            companionX -= deltaX * 2;
            companionScale = 0.8;
            companionOpactity = 0.6;
            companionVisible = true;
        }
        return { companionX, companionY, companionScale, companionOpactity, companionVisible };
    }

    /**
     * Returns pixel position by on column and row number
     */
    private getCompanionPosition(): [number, number] {
        const isInGameEdit = get(inGameProfileEditStore);
        if (isInGameEdit) {
            const frame = get(selectCompanionPreviewFrameStore);
            const canvas = this.game.canvas;
            if (frame && canvas) {
                const rect = canvas.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    const scaleX = this.game.renderer.width / rect.width;
                    const scaleY = this.game.renderer.height / rect.height;
                    const x = (frame.centerX - rect.left) * scaleX;
                    const y = (frame.centerY - rect.top) * scaleY;
                    return [x, y];
                }
            }
        }
        return [this.game.renderer.width / 2, this.game.renderer.height / 3];
    }

    private setUpCompanion(companion: Phaser.Physics.Arcade.Sprite, numero: number) {
        const { companionX, companionY, companionScale, companionOpactity, companionVisible } =
            this.defineSetupCompanion(numero);
        companion.setBounce(0.2);
        companion.setCollideWorldBounds(true);
        companion.setVisible(companionVisible);
        companion.setScale(companionScale, companionScale);
        companion.setAlpha(companionOpactity);
        companion.setX(companionX);
        companion.setY(companionY);
    }
}
