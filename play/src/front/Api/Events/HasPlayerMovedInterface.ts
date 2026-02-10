import type { PositionMessage_Direction } from "@workadventure/messages";

export interface HasPlayerMovedInterface {
    x: number;
    y: number;
    direction: PositionMessage_Direction;
    moving: boolean;
    oldX?: number;
    oldY?: number;
}
