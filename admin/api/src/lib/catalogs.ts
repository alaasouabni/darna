import type {
    WokaDetail,
    WokaList,
    CompanionTextureCollection,
    CompanionDetail,
} from "@workadventure/messages";
import { wokaPartNames } from "@workadventure/messages";
import { resolveAssetUrl } from "./assets";
import rawWokaData from "../data/woka.json";
import rawCompanionData from "../data/companions.json";

type WokaTextureMap = Map<string, string>;
type CompanionTextureMap = Map<string, { id: string; url: string }>;

let cachedWokaList: WokaList | null = null;
let cachedWokaMap: WokaTextureMap | null = null;
let cachedCompanionList: CompanionTextureCollection[] | null = null;
let cachedCompanionMap: CompanionTextureMap | null = null;

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function buildWokaList(): WokaList {
    const list = cloneJson(rawWokaData as WokaList);

    for (const partName of Object.keys(list)) {
        const part = list[partName as keyof WokaList];
        if (!part) {
            continue;
        }

        for (const collection of part.collections) {
            for (const texture of collection.textures) {
                texture.url = resolveAssetUrl(texture.url);
            }
        }
    }

    return list;
}

function buildWokaMap(list: WokaList): WokaTextureMap {
    const map = new Map<string, string>();

    for (const partName of wokaPartNames) {
        const part = list[partName];
        if (!part) {
            continue;
        }

        for (const collection of part.collections) {
            for (const texture of collection.textures) {
                map.set(texture.id, texture.url);
            }
        }
    }

    return map;
}

function buildCompanionList(): CompanionTextureCollection[] {
    const list = cloneJson(rawCompanionData as CompanionTextureCollection[]);
    for (const collection of list) {
        for (const texture of collection.textures) {
            texture.url = resolveAssetUrl(texture.url);
        }
    }
    return list;
}

function buildCompanionMap(list: CompanionTextureCollection[]): CompanionTextureMap {
    const map = new Map<string, { id: string; url: string }>();

    for (const collection of list) {
        for (const texture of collection.textures) {
            map.set(texture.id, { id: texture.id, url: texture.url });
        }
    }

    return map;
}

export function getWokaList(): WokaList {
    if (!cachedWokaList) {
        cachedWokaList = buildWokaList();
        cachedWokaMap = buildWokaMap(cachedWokaList);
    }

    return cachedWokaList;
}

export function getWokaDetails(textureIds: string[]): WokaDetail[] | undefined {
    const list = getWokaList();
    const map = cachedWokaMap ?? buildWokaMap(list);
    const details: WokaDetail[] = [];

    for (const id of textureIds) {
        const url = map.get(id);
        if (!url) {
            return undefined;
        }
        details.push({ id, url });
    }

    return details;
}

export function getDefaultWokaTextureIds(): string[] {
    const list = getWokaList();
    const textureIds: string[] = [];

    for (const partName of wokaPartNames) {
        const part = list[partName];
        const firstCollection = part?.collections?.[0];
        const firstTexture = firstCollection?.textures?.[0];
        if (firstTexture?.id) {
            textureIds.push(firstTexture.id);
        }
    }

    return textureIds;
}

export function getCompanionList(): CompanionTextureCollection[] {
    if (!cachedCompanionList) {
        cachedCompanionList = buildCompanionList();
        cachedCompanionMap = buildCompanionMap(cachedCompanionList);
    }

    return cachedCompanionList;
}

export function getCompanionDetails(textureId: string): CompanionDetail | undefined {
    const list = getCompanionList();
    const map = cachedCompanionMap ?? buildCompanionMap(list);
    const entry = map.get(textureId);
    if (!entry) {
        return undefined;
    }
    return entry;
}
