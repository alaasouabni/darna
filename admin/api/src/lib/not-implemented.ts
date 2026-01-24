import { errorData } from "./error-response";

export function notImplemented(endpoint: string) {
    return errorData(
        "NOT_IMPLEMENTED",
        "Not implemented",
        `${endpoint} is not implemented yet.`,
        "This endpoint will be available in a later phase of the admin service."
    );
}