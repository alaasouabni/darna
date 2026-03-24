declare module "ws" {
    import type { EventEmitter } from "events";
    import type { IncomingMessage } from "http";

    export interface WebSocket extends EventEmitter {
        on(
            event: "message",
            listener: (data: Buffer | ArrayBuffer | Buffer[] | string, isBinary: boolean) => void
        ): this;
        on(event: "close", listener: (code: number, reason: Buffer) => void): this;
        on(event: "error", listener: (error: Error) => void): this;
        close(code?: number, data?: string): void;
    }

    export class WebSocketServer extends EventEmitter {
        constructor(options: { port: number; host?: string });
        on(event: "connection", listener: (socket: WebSocket, request: IncomingMessage) => void): this;
        on(event: "error", listener: (error: Error) => void): this;
        close(callback?: (error?: Error) => void): void;
    }
}
