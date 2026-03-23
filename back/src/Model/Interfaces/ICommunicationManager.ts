import type { SpaceUser } from "@workadventure/messages";

export interface ICommunicationManager {
    handleUserAdded(user: SpaceUser): Promise<void>;
    handleUserDeleted(user: SpaceUser): Promise<void>;
    handleUserUpdated(
        user: SpaceUser,
        options?: {
            /**
             * True when screenSharingState transitioned from true to false on this update.
             * This is provided by Space.updateUser because user objects are mutated in place.
             */
            screenSharingStopped?: boolean;
        }
    ): Promise<void>;
    handleUserToNotifyAdded(user: SpaceUser): Promise<void>;
    handleUserToNotifyDeleted(user: SpaceUser): Promise<void>;
}
