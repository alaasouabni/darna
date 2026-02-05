import type { AreaData, AtLeast, GameMapAreas, PersonalAreaPropertyData } from "@workadventure/map-editor";
import { AreaPermissions } from "@workadventure/map-editor";
import { Area } from "../../Entity/Area";
import type { GameScene } from "../GameScene";
import { mapEditorActivatedForThematics } from "../../../Stores/MenuStore";
import { localUserStore } from "../../../Connection/LocalUserStore";

/**
 * This class handles the display
 * of Phaser Areas objects
 */
export class AreasManager {
    private areas: Area[] = [];
    private areaPermissions: AreaPermissions;
    private personalAreaHoverHandlers = new Map<
        string,
        { over: (pointer: Phaser.Input.Pointer) => void; out: (pointer: Phaser.Input.Pointer) => void }
    >();
    private personalAreaHoverZones = new Map<string, Phaser.GameObjects.Zone>();
    private personalAreaHoverOutlines = new Map<string, Phaser.GameObjects.Rectangle>();
    private personalAreaHoverMeta = new Map<
        string,
        { area: Area; areaData: AreaData; property: PersonalAreaPropertyData }
    >();
    private currentHoverAreaId: string | undefined;
    private readonly onPointerMove = (pointer: Phaser.Input.Pointer) => this.handlePointerMove(pointer);
    private readonly onGameOut = (pointer: Phaser.Input.Pointer) => this.handleGameOut(pointer);
    private readonly onWindowPointerMove = (event: PointerEvent) => this.handleWindowPointerMove(event);

    constructor(
        private scene: GameScene,
        private gameMapAreas: GameMapAreas,
        private userConnectedTags: string[],
        private userCanEdit: boolean,
        private onPersonalAreaHover?: (
            area: Area,
            areaData: AreaData,
            property: PersonalAreaPropertyData,
            pointer?: Phaser.Input.Pointer
        ) => void,
        private onPersonalAreaHoverOut?: (
            area: Area,
            areaData: AreaData,
            property: PersonalAreaPropertyData,
            pointer?: Phaser.Input.Pointer
        ) => void,
        private onPersonalAreaHoverOutAll?: (pointer?: Phaser.Input.Pointer) => void
    ) {
        this.areaPermissions = new AreaPermissions(gameMapAreas, userConnectedTags, userCanEdit);
        this.initializeAreas();
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
        this.scene.input.on(Phaser.Input.Events.GAME_OUT, this.onGameOut);
        window.addEventListener("pointermove", this.onWindowPointerMove, { passive: true });
        this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    }

    public addArea(areaData: AreaData): void {
        const area = new Area(
            this.scene,
            areaData,
            this.areaPermissions.isUserHasAreaAccess(areaData.id),
            this.areaPermissions.isOverlappingArea(areaData.id)
        );
        this.areas.push(area);
        this.configurePersonalAreaHover(area);
        this.updateMapEditorOptionForSpecificAreas();
    }

    public updateArea(updatedArea: AtLeast<AreaData, "id">): void {
        const indexOfAreaToUpdate = this.areas.findIndex((area) => area.areaData.id === updatedArea.id);
        if (indexOfAreaToUpdate === -1) {
            console.error("Unable to find area to update : ", updatedArea.id);
            return;
        }
        const areaToUpdate = this.areas[indexOfAreaToUpdate];
        areaToUpdate.updateArea(updatedArea, !this.areaPermissions.isUserHasAreaAccess(updatedArea.id));
        this.configurePersonalAreaHover(areaToUpdate);
        this.updateMapEditorOptionForSpecificAreas();
    }

    public removeArea(deletedAreaId: string): void {
        const removedAreaIndex = this.areas.findIndex((area) => area.areaData.id === deletedAreaId);
        if (removedAreaIndex === -1) {
            console.error("Unable to find area to remove : ", deletedAreaId);
            return;
        }
        this.areas[removedAreaIndex].destroy();
        const removedArea = this.areas[removedAreaIndex];
        this.clearPersonalAreaHover(removedArea);
        this.areas = this.areas.filter((area) => area.areaData.id !== deletedAreaId);
        this.updateMapEditorOptionForSpecificAreas();
    }

    private initializeAreas() {
        const gameMapAreas = this.gameMapAreas.getAreas();
        gameMapAreas.forEach((areaData) =>
            this.areas.push(
                new Area(
                    this.scene,
                    areaData,
                    !this.areaPermissions.isUserHasAreaAccess(areaData.id),
                    this.areaPermissions.isOverlappingArea(areaData.id)
                )
            )
        );
        for (const area of this.areas) {
            this.configurePersonalAreaHover(area);
        }
        this.updateMapEditorOptionForSpecificAreas();
    }

    private updateMapEditorOptionForSpecificAreas() {
        const userId = localUserStore.getLocalUser()?.uuid;
        const userTags = this.scene.connection?.getAllTags() ?? [];
        const isGameMapHasSpecificAreas = this.gameMapAreas.isGameMapContainsSpecificAreas(userId, userTags);
        mapEditorActivatedForThematics.set(isGameMapHasSpecificAreas);
    }

    public getAreaById(areaId: string): Area | undefined {
        return this.areas.find((area) => area.areaData.id === areaId);
    }

    public getAreasByPropertyType(propertyType: string): Area[] {
        return this.areas.reduce((areas, area) => {
            const areaFound = area.areaData.properties.find((property) => property.type === propertyType);
            if (areaFound) {
                areas.push(area);
            }
            return areas;
        }, [] as Area[]);
    }

    /**
     * Returns the list of all areas that the user has no access to.
     */
    public getCollidingAreas(): AreaData[] {
        const lockedAreas = this.getLockedPersonalAreasForUser();
        if (this.userCanEdit) {
            return lockedAreas;
        }
        const collidingAreas = this.gameMapAreas.getCollidingAreas(this.userConnectedTags);
        if (lockedAreas.length === 0) {
            return collidingAreas;
        }
        const dedup = new Map<string, AreaData>();
        for (const area of collidingAreas) {
            dedup.set(area.id, area);
        }
        for (const area of lockedAreas) {
            dedup.set(area.id, area);
        }
        return [...dedup.values()];
    }

    private getLockedPersonalAreasForUser(): AreaData[] {
        const areas = Array.from(this.gameMapAreas.getAreas().values());
        return areas.filter((area) => this.isLockedPersonalAreaForUser(area));
    }

    private isLockedPersonalAreaForUser(area: AreaData): boolean {
        const userId = localUserStore.getLocalUser()?.uuid;
        if (!userId) {
            return false;
        }

        const property = area.properties.find(
            (prop) => prop.type === "personalAreaPropertyData"
        ) as PersonalAreaPropertyData | undefined;

        if (!property?.locked) {
            return false;
        }
        if (property.ownerId && property.ownerId === userId) {
            return false;
        }
        return true;
    }

    private configurePersonalAreaHover(area: Area) {
        const property = area.areaData.properties.find(
            (prop) => prop.type === "personalAreaPropertyData"
        ) as PersonalAreaPropertyData | undefined;

        if (!property?.ownerId) {
            this.clearPersonalAreaHover(area);
            return;
        }

        if (this.personalAreaHoverHandlers.has(area.areaData.id)) {
            this.clearPersonalAreaHover(area);
        }

        let zone = this.personalAreaHoverZones.get(area.areaData.id);
        if (!zone) {
            zone = this.scene.add.zone(area.x, area.y, area.width, area.height);
            this.personalAreaHoverZones.set(area.areaData.id, zone);
        }
        zone.setPosition(area.x, area.y);
        zone.setSize(area.width, area.height);
        zone.setInteractive({ cursor: "pointer" });
        this.updatePersonalAreaOutline(area);
        this.personalAreaHoverMeta.set(area.areaData.id, { area, areaData: area.areaData, property });
        const over = (pointer: Phaser.Input.Pointer) => {
            this.setPersonalAreaOutlineVisible(area, true);
            this.currentHoverAreaId = area.areaData.id;
            this.onPersonalAreaHover?.(area, area.areaData, property, pointer);
        };
        const out = (pointer: Phaser.Input.Pointer) => {
            this.setPersonalAreaOutlineVisible(area, false);
            if (this.currentHoverAreaId === area.areaData.id) {
                this.currentHoverAreaId = undefined;
            }
            this.onPersonalAreaHoverOut?.(area, area.areaData, property, pointer);
        };
        zone.on(Phaser.Input.Events.POINTER_OVER, over);
        zone.on(Phaser.Input.Events.POINTER_OUT, out);
        this.personalAreaHoverHandlers.set(area.areaData.id, { over, out });
    }

    private clearPersonalAreaHover(area: Area) {
        const handlers = this.personalAreaHoverHandlers.get(area.areaData.id);
        if (handlers) {
            const zone = this.personalAreaHoverZones.get(area.areaData.id);
            if (zone) {
                zone.off(Phaser.Input.Events.POINTER_OVER, handlers.over);
                zone.off(Phaser.Input.Events.POINTER_OUT, handlers.out);
            }
            this.personalAreaHoverHandlers.delete(area.areaData.id);
        }
        const zone = this.personalAreaHoverZones.get(area.areaData.id);
        if (zone) {
            zone.disableInteractive();
            zone.destroy();
            this.personalAreaHoverZones.delete(area.areaData.id);
        }
        const outline = this.personalAreaHoverOutlines.get(area.areaData.id);
        if (outline) {
            outline.destroy();
            this.personalAreaHoverOutlines.delete(area.areaData.id);
        }
        this.personalAreaHoverMeta.delete(area.areaData.id);
        if (this.currentHoverAreaId === area.areaData.id) {
            this.currentHoverAreaId = undefined;
        }
    }

    private updatePersonalAreaOutline(area: Area) {
        let outline = this.personalAreaHoverOutlines.get(area.areaData.id);
        if (!outline) {
            outline = this.scene.add.rectangle(area.x, area.y, area.width, area.height);
            outline.setStrokeStyle(1, 0x5aa9ff, 0.45);
            outline.setFillStyle(0x5aa9ff, 0.12);
            outline.setVisible(false);
            this.personalAreaHoverOutlines.set(area.areaData.id, outline);
        }
        outline.setPosition(area.x, area.y);
        outline.setSize(area.width, area.height);
        outline.updateDisplayOrigin();
    }

    private setPersonalAreaOutlineVisible(area: Area, visible: boolean) {
        const outline = this.personalAreaHoverOutlines.get(area.areaData.id);
        if (outline) {
            outline.setVisible(visible);
        }
    }

    private handlePointerMove(pointer: Phaser.Input.Pointer) {
        const worldX = pointer.worldX ?? pointer.x;
        const worldY = pointer.worldY ?? pointer.y;
        this.updateHoverFromWorldPoint(worldX, worldY, pointer);
    }

    private handleGameOut(pointer: Phaser.Input.Pointer) {
        if (!this.currentHoverAreaId) {
            return;
        }

        const meta = this.personalAreaHoverMeta.get(this.currentHoverAreaId);
        if (!meta) {
            this.currentHoverAreaId = undefined;
            return;
        }

        this.setPersonalAreaOutlineVisible(meta.area, false);
        this.onPersonalAreaHoverOut?.(meta.area, meta.areaData, meta.property, pointer);
        this.currentHoverAreaId = undefined;
    }

    private handleWindowPointerMove(event: PointerEvent) {
        if (!this.currentHoverAreaId) {
            return;
        }

        const canvas = this.scene.game.canvas;
        if (!canvas) {
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const inCanvas =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

        if (!inCanvas) {
            this.forceClearHover();
            return;
        }

        const scaleX = rect.width ? canvas.width / rect.width : 1;
        const scaleY = rect.height ? canvas.height / rect.height : 1;
        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;
        const worldPoint = this.scene.cameras.main.getWorldPoint(canvasX, canvasY);
        this.updateHoverFromWorldPoint(worldPoint.x, worldPoint.y);
    }

    private clearHoverIfOutsideZones(worldX: number, worldY: number, pointer?: Phaser.Input.Pointer) {
        if (!this.currentHoverAreaId) {
            return;
        }

        for (const zone of this.personalAreaHoverZones.values()) {
            if (zone.getBounds().contains(worldX, worldY)) {
                return;
            }
        }

        const meta = this.personalAreaHoverMeta.get(this.currentHoverAreaId);
        if (!meta) {
            this.currentHoverAreaId = undefined;
            return;
        }

        this.setPersonalAreaOutlineVisible(meta.area, false);
        this.onPersonalAreaHoverOut?.(meta.area, meta.areaData, meta.property, pointer);
        this.currentHoverAreaId = undefined;
        this.onPersonalAreaHoverOutAll?.(pointer);
    }

    private updateHoverFromWorldPoint(worldX: number, worldY: number, pointer?: Phaser.Input.Pointer) {
        const hoveredAreaId = this.getHoverAreaIdAt(worldX, worldY);
        if (!hoveredAreaId) {
            this.clearHoverIfOutsideZones(worldX, worldY, pointer);
            return;
        }

        if (this.currentHoverAreaId === hoveredAreaId) {
            return;
        }

        if (this.currentHoverAreaId) {
            const prev = this.personalAreaHoverMeta.get(this.currentHoverAreaId);
            if (prev) {
                this.setPersonalAreaOutlineVisible(prev.area, false);
                this.onPersonalAreaHoverOut?.(prev.area, prev.areaData, prev.property, pointer);
            }
        }

        const next = this.personalAreaHoverMeta.get(hoveredAreaId);
        if (!next) {
            this.currentHoverAreaId = undefined;
            return;
        }

        this.currentHoverAreaId = hoveredAreaId;
        this.setPersonalAreaOutlineVisible(next.area, true);
        this.onPersonalAreaHover?.(next.area, next.areaData, next.property, pointer);
    }

    private getHoverAreaIdAt(worldX: number, worldY: number): string | undefined {
        for (const [areaId, zone] of this.personalAreaHoverZones.entries()) {
            if (zone.getBounds().contains(worldX, worldY)) {
                return areaId;
            }
        }
        return undefined;
    }

    private forceClearHover() {
        if (!this.currentHoverAreaId) {
            return;
        }

        const meta = this.personalAreaHoverMeta.get(this.currentHoverAreaId);
        if (!meta) {
            this.currentHoverAreaId = undefined;
            return;
        }

        this.setPersonalAreaOutlineVisible(meta.area, false);
        this.onPersonalAreaHoverOut?.(meta.area, meta.areaData, meta.property);
        this.currentHoverAreaId = undefined;
        this.onPersonalAreaHoverOutAll?.();
    }

    private destroy() {
        this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove);
        this.scene.input.off(Phaser.Input.Events.GAME_OUT, this.onGameOut);
        window.removeEventListener("pointermove", this.onWindowPointerMove);
    }
}
