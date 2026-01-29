import { AvailabilityStatus } from "@workadventure/messages";
import { requestedStatusStore } from "../../Stores/MediaStore";
import { localUserStore } from "../../Connection/LocalUserStore";
import { popupStore } from "../../Stores/PopupStore";
import BubbleConfirmationModal from "../../Components/ActionBar/AvailabilityStatus/Modals/BubbleConfirmationModal.svelte";
import ChangeStatusConfirmationModal from "../../Components/ActionBar/AvailabilityStatus/Modals/ChangeStatusConfirmationModal.svelte";
import DoNotDisturbModeModal from "../../Components/ActionBar/AvailabilityStatus/Modals/DoNotDisturbModeModal.svelte";
import type { RequestedStatus } from "./statusRules";

const DND_MODE_MODAL_ID = "dndModeModal";

export const askToChangeStatus = () => {
    popupStore.addPopup(ChangeStatusConfirmationModal, {}, "changeStatusConfirmationModal");
};

export const closeChangeStatusConfirmationModal = () => {
    popupStore.removePopup("changeStatusConfirmationModal");
};

export const hideBubbleConfirmationModal = () => {
    closeBubbleConfirmationModal();
};

export const resetAllStatusStoreExcept = (status: RequestedStatus | null = null) => {
    requestedStatusStore.set(status);
    localUserStore.setRequestedStatus(status);
};

export const passStatusToOnline = () => {
    resetAllStatusStoreExcept();
    closeChangeStatusConfirmationModal();
    closeBubbleConfirmationModal();
};

export const closeBubbleConfirmationModal = () => {
    popupStore.removePopup("bubbleConfirmationModal");
};

export const askIfUserWantToJoinBubbleOf = (name: string) => {
    popupStore.addPopup(
        BubbleConfirmationModal,
        {
            name,
        },
        "bubbleConfirmationModal"
    );
};

export const showDndModeModal = (status: AvailabilityStatus) => {
    if (status !== AvailabilityStatus.DO_NOT_DISTURB && status !== AvailabilityStatus.BACK_IN_A_MOMENT) {
        return;
    }
    popupStore.addPopup(DoNotDisturbModeModal, { status }, DND_MODE_MODAL_ID);
};

export const hideDndModeModal = () => {
    popupStore.removePopup(DND_MODE_MODAL_ID);
};
