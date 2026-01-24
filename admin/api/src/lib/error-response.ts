import type { ErrorApiData } from "@workadventure/messages";

export function errorData(code: string, title: string, subtitle: string, details: string): ErrorApiData {
    return {
        status: "error",
        type: "error",
        code,
        title,
        subtitle,
        details,
    };
}

export function unauthorizedData(details: string): ErrorApiData {
    return {
        status: "error",
        type: "unauthorized",
        code: "UNAUTHORIZED",
        title: "Unauthorized",
        subtitle: "Access denied",
        details,
    };
}