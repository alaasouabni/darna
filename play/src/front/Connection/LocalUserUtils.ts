import { MAX_USERNAME_LENGTH } from "../Enum/EnvironmentVariable";

export type LayerNames = "woka" | "body" | "eyes" | "hair" | "clothes" | "hat" | "accessory";

export interface CharacterTexture {
    id: string;
    layer: LayerNames;
    url: string;
}

export const maxUserNameLength: number = MAX_USERNAME_LENGTH;
export const GUEST_NAME_SUFFIX = " (guest)";

const guestSuffixPattern = /\s*\(guest\)\s*$/i;

export function stripGuestSuffix(value: string): string {
    return value.replace(guestSuffixPattern, "").trim();
}

export function appendGuestSuffix(value: string): string {
    const baseName = stripGuestSuffix(value).replace(/\s+/g, " ").trim();
    if (!baseName) {
        return GUEST_NAME_SUFFIX.trim();
    }
    return `${baseName}${GUEST_NAME_SUFFIX}`;
}

function getNameForValidation(value: string): string {
    return guestSuffixPattern.test(value) ? stripGuestSuffix(value) : value;
}

export function isUserNameValid(value: unknown): boolean {
    if (typeof value !== "string") {
        return false;
    }
    const normalizedValue = getNameForValidation(value);
    return normalizedValue.length > 0 && normalizedValue.length <= maxUserNameLength && /\S/.test(normalizedValue);
}

export function isUserNameTooLong(value: unknown): boolean {
    return typeof value === "string" && getNameForValidation(value).length > maxUserNameLength;
}

export function areCharacterTexturesValid(value: string[] | null): boolean {
    if (!value || !value.length) {
        return false;
    }
    for (const layerName of value) {
        if (layerName.length === 0 || layerName === " ") {
            return false;
        }
    }
    return true;
}
