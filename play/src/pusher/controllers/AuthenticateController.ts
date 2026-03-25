import fs from "fs";
import { v4 } from "uuid";
import type { MeResponse, RegisterData } from "@workadventure/messages";
import { MeRequest } from "@workadventure/messages";
import { z } from "zod";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import Mustache from "mustache";
import type { Application } from "express";
import Debug from "debug";
import type { AuthTokenData } from "../services/JWTTokenManager";
import type { FetchMemberDataByUuidResponse } from "../services/AdminApi";
import { jwtTokenManager } from "../services/JWTTokenManager";
import { openIDClient } from "../services/OpenIDClient";
import {
    DISABLE_ANONYMOUS,
    FRONT_URL,
    GUEST_ACCESS_TOKEN_TTL_HOURS,
    INVITE_ONLY_GUEST_ENABLED,
    MATRIX_PUBLIC_URI,
    PUSHER_URL,
} from "../enums/EnvironmentVariable";
import { adminService } from "../services/AdminService";
import { validateQuery } from "../services/QueryValidator";
import { VerifyDomainService } from "../services/verifyDomain/VerifyDomainService";
import { matrixProvider } from "../services/MatrixProvider";
import { BaseHttpController } from "./BaseHttpController";

const debug = Debug("pusher:requests");

const guestClaimBodySchema = z.object({
    inviteToken: z.string().min(1),
    playUri: z.string().url(),
    nickname: z.string().trim().min(1).max(64).optional(),
    characterTextureIds: z.array(z.string()).max(32).optional(),
    companionTextureId: z.string().max(256).optional(),
    continuityToken: z.string().trim().min(16).max(256).optional(),
});

const inviteResolveQuerySchema = z.object({
    inviteToken: z.string().trim().min(1),
    playUri: z.string().url().optional(),
});

export class AuthenticateController extends BaseHttpController {
    private readonly redirectToMatrixFile: string;
    private readonly redirectToPlayFile: string;
    constructor(app: Application) {
        super(app);

        let redirectToMatrixPath: string;
        if (fs.existsSync("dist/public/redirectToMatrix.html")) {
            // In prod mode
            redirectToMatrixPath = "dist/public/redirectToMatrix.html";
        } else if (fs.existsSync("redirectToMatrix.html")) {
            // In dev mode
            redirectToMatrixPath = "redirectToMatrix.html";
        } else {
            throw new Error("Could not find redirectToMatrix.html file");
        }

        this.redirectToMatrixFile = fs.readFileSync(redirectToMatrixPath, "utf8");

        // Pre-parse the file for speed (and validation)
        Mustache.parse(this.redirectToMatrixFile);

        let redirectToPlayPath: string;
        if (fs.existsSync("dist/public/redirectToPlay.html")) {
            // In prod mode
            redirectToPlayPath = "dist/public/redirectToPlay.html";
        } else if (fs.existsSync("redirectToPlay.html")) {
            // In dev mode
            redirectToPlayPath = "redirectToPlay.html";
        } else {
            throw new Error("Could not find redirectToPlay.html file");
        }

        this.redirectToPlayFile = fs.readFileSync(redirectToPlayPath, "utf8");

        // Pre-parse the file for speed (and validation)
        Mustache.parse(this.redirectToPlayFile);
    }

    routes(): void {
        this.openIDLogin();
        this.inviteResolve();
        this.guestClaim();
        this.guestRefresh();
        this.me();
        this.openIDCallback();
        this.matrixCallback();
        this.logoutCallback();
        this.register();
        this.anonymLogin();
        this.profileCallback();
        this.logoutUser();
    }

    private inviteResolve(): void {
        this.app.get("/invite/resolve", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} - IP: ${req.ip} - Time: ${Date.now()}`);

            const query = validateQuery(req, res, inviteResolveQuerySchema);
            if (query === undefined) {
                return;
            }

            try {
                const response = await adminService.resolveInviteToken(query.inviteToken, query.playUri);
                res.json(response);
            } catch (error) {
                const statusCode =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { status?: number } }).response?.status ?? 502
                        : 502;
                const data =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { data?: unknown } }).response?.data
                        : undefined;

                if (data && typeof data === "object") {
                    res.status(statusCode).json(data);
                } else {
                    res.status(statusCode).json({
                        message: "Failed to resolve invite.",
                        details: error instanceof Error ? error.message : "Unknown error",
                    });
                }
            }
        });
    }

    private openIDLogin(): void {
        /**
         * @openapi
         * /login-screen:
         *   get:
         *     description: Redirects the user to the OpenID login screen
         *     parameters:
         *      - name: "nonce"
         *        in: "query"
         *        description: "todo"
         *        required: true
         *        type: "string"
         *      - name: "state"
         *        in: "query"
         *        description: "todo"
         *        required: true
         *        type: "string"
         *      - name: "playUri"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *     responses:
         *       302:
         *         description: Redirects the user to the OpenID login screen
         *
         */

        this.app.get("/login-screen", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(
                req,
                res,
                z.object({
                    playUri: z.string(),
                    manuallyTriggered: z.literal("true").optional(),
                    chatRoomId: z.string().optional(),
                    providerId: z.string().optional(),
                    providerScopes: z.string().array().optional(), // Optional scopes to request
                })
            );
            if (query === undefined) {
                return;
            }

            // Let's validate the playUri (we don't want a hacker to forge a URL that will redirect to a malicious URL)
            const verifyDomainService_ = VerifyDomainService.get(await adminService.getCapabilities());
            const verifyDomainResult = await verifyDomainService_.verifyDomain(query.playUri);
            if (!verifyDomainResult) {
                res.status(403);
                res.send("Unauthorized domain in playUri");
                return;
            }

            const loginUri = await openIDClient.authorizationUrl(
                res,
                query.playUri,
                req,
                query.manuallyTriggered,
                query.chatRoomId,
                query.providerId,
                query.providerScopes
            );
            res.cookie("playUri", query.playUri, {
                httpOnly: true, // dont let browser javascript access cookie ever
                secure: req.secure, // only use cookie over https
            });

            res.redirect(loginUri);
            return;
        });
    }

    private guestClaim(): void {
        this.app.post("/guest/claim", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} - IP: ${req.ip} - Time: ${Date.now()}`);

            if (!INVITE_ONLY_GUEST_ENABLED) {
                res.status(403).json({
                    message: "Guest invite onboarding is disabled.",
                });
                return;
            }

            const bodyResult = guestClaimBodySchema.safeParse(req.body);
            if (!bodyResult.success) {
                res.status(400).json({
                    message: "Invalid request body.",
                    details: bodyResult.error.flatten(),
                });
                return;
            }

            try {
                const claim = await adminService.claimGuestInvite(
                    bodyResult.data.inviteToken,
                    bodyResult.data.playUri,
                    bodyResult.data.nickname,
                    bodyResult.data.characterTextureIds,
                    bodyResult.data.companionTextureId,
                    bodyResult.data.continuityToken
                );

                const authToken = jwtTokenManager.createAuthToken(
                    claim.userIdentifier,
                    undefined,
                    claim.username ?? undefined,
                    undefined,
                    ["guest"],
                    undefined,
                    claim.refreshToken,
                    {
                        tokenType: "guest",
                        guestSessionId: claim.guestSessionId,
                        expiresIn: `${GUEST_ACCESS_TOKEN_TTL_HOURS}h`,
                    }
                );

                res.json({
                    authToken,
                    userUuid: claim.userIdentifier,
                    username: claim.username ?? null,
                    expiresAt: claim.expiresAt,
                });
            } catch (error) {
                const statusCode =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { status?: number } }).response?.status ?? 502
                        : 502;
                const data =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { data?: unknown } }).response?.data
                        : undefined;

                if (data && typeof data === "object") {
                    res.status(statusCode).json(data);
                } else {
                    res.status(statusCode).json({
                        message: "Failed to claim guest invite.",
                        details: error instanceof Error ? error.message : "Unknown error",
                    });
                }
            }
        });
    }

    private guestRefresh(): void {
        this.app.post("/guest/refresh", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} - IP: ${req.ip} - Time: ${Date.now()}`);

            if (!INVITE_ONLY_GUEST_ENABLED) {
                res.status(403).json({
                    message: "Guest invite onboarding is disabled.",
                });
                return;
            }

            const authHeader = req.header("authorization");
            if (!authHeader) {
                res.status(401).send("Missing authorization header");
                return;
            }

            let tokenData: AuthTokenData;
            try {
                tokenData = jwtTokenManager.verifyJWTToken(authHeader, true);
            } catch {
                res.status(401).send("Invalid token");
                return;
            }

            if (
                tokenData.tokenType !== "guest" ||
                !tokenData.guestSessionId ||
                !tokenData.refreshToken
            ) {
                res.status(401).send("Invalid guest token");
                return;
            }

            try {
                const refreshResponse = await adminService.refreshGuestSession(
                    tokenData.guestSessionId,
                    tokenData.refreshToken
                );

                const authToken = jwtTokenManager.createAuthToken(
                    refreshResponse.userIdentifier,
                    undefined,
                    refreshResponse.username ?? undefined,
                    tokenData.locale,
                    tokenData.tags ?? ["guest"],
                    tokenData.matrixUserId,
                    refreshResponse.refreshToken,
                    {
                        tokenType: "guest",
                        guestSessionId: refreshResponse.guestSessionId,
                        expiresIn: `${GUEST_ACCESS_TOKEN_TTL_HOURS}h`,
                    }
                );

                res.json({
                    authToken,
                    userUuid: refreshResponse.userIdentifier,
                    username: refreshResponse.username ?? null,
                    expiresAt: refreshResponse.expiresAt,
                });
            } catch (error) {
                const statusCode =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { status?: number } }).response?.status ?? 502
                        : 502;
                const data =
                    typeof error === "object" && error !== null && "response" in error
                        ? (error as { response?: { data?: unknown } }).response?.data
                        : undefined;
                if (data && typeof data === "object") {
                    res.status(statusCode).json(data);
                } else {
                    res.status(statusCode).json({
                        message: "Failed to refresh guest session.",
                        details: error instanceof Error ? error.message : "Unknown error",
                    });
                }
            }
        });
    }

    private me(): void {
        /**
         * @openapi
         * /me:
         *   get:
         *     description: TODO
         *     parameters:
         *      - name: "code"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *      - name: "nonce"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *      - name: "token"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *      - name: "playUri"
         *        in: "query"
         *        description: "todo"
         *        required: true
         *        type: "string"
         *     responses:
         *       200:
         *         description: Response to the /me endpoint
         *         schema:
         *           $ref: '#/definitions/MeResponse'
         *       401:
         *         description: Thrown when the token is invalid
         */

        this.app.get("/me", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const IPAddress = req.header("x-forwarded-for") ?? "";
            const query = validateQuery(req, res, MeRequest);
            if (query === undefined) {
                return;
            }
            const { token, playUri, localStorageCompanionTextureId, chatID, inviteToken } = query;
            let localStorageCharacterTextureIds = query["localStorageCharacterTextureIds[]"];
            if (typeof localStorageCharacterTextureIds === "string") {
                localStorageCharacterTextureIds = [localStorageCharacterTextureIds];
            }
            try {
                let authTokenData: AuthTokenData;
                let refreshedAuthToken = token;

                const buildAuthToken = (
                    data: AuthTokenData,
                    overrides?: Partial<AuthTokenData> & { expiresIn?: string | number }
                ): string => {
                    const mergedTokenData: AuthTokenData = {
                        ...data,
                        ...overrides,
                        tokenType: (overrides?.tokenType ?? data.tokenType ?? "user") as "user" | "guest",
                    };
                    return jwtTokenManager.createAuthToken(
                        mergedTokenData.identifier,
                        mergedTokenData.accessToken,
                        mergedTokenData.username,
                        mergedTokenData.locale,
                        mergedTokenData.tags,
                        mergedTokenData.matrixUserId,
                        mergedTokenData.refreshToken,
                        {
                            tokenType: mergedTokenData.tokenType,
                            guestSessionId: mergedTokenData.guestSessionId,
                            expiresIn:
                                overrides?.expiresIn ??
                                (mergedTokenData.tokenType === "guest"
                                    ? `${GUEST_ACCESS_TOKEN_TTL_HOURS}h`
                                    : undefined),
                        }
                    );
                };

                const isInvalidGrant = (err: unknown): boolean => {
                    if (!err || typeof err !== "object") return false;
                    const error = err as { error?: string; error_description?: string; message?: string };
                    return (
                        error.error === "invalid_grant" ||
                        (error.error_description?.toLowerCase().includes("not active") ?? false) ||
                        (error.message?.toLowerCase().includes("invalid_grant") ?? false)
                    );
                };

                const refreshAccessToken = async (
                    currentRefreshToken: string
                ): Promise<{
                    nextAccessToken: string;
                    nextRefreshToken: string;
                    nextAuthToken: string;
                }> => {
                    let refreshed;
                    try {
                        refreshed = await openIDClient.refreshAccessToken(currentRefreshToken);
                    } catch (err) {
                        if (isInvalidGrant(err)) {
                            throw new JsonWebTokenError("Invalid token");
                        }
                        throw err;
                    }
                    if (!refreshed.access_token) {
                        throw new JsonWebTokenError("Invalid token");
                    }
                    const nextAccessToken = refreshed.access_token;
                    const nextRefreshToken = refreshed.refresh_token ?? currentRefreshToken;
                    const nextAuthToken = buildAuthToken(authTokenData, {
                        accessToken: nextAccessToken,
                        refreshToken: nextRefreshToken,
                    });
                    return {
                        nextAccessToken,
                        nextRefreshToken,
                        nextAuthToken,
                    };
                };

                const refreshGuestToken = async (
                    currentTokenData: AuthTokenData
                ): Promise<{
                    nextTokenData: AuthTokenData;
                    nextAuthToken: string;
                }> => {
                    if (
                        currentTokenData.tokenType !== "guest" ||
                        !currentTokenData.guestSessionId ||
                        !currentTokenData.refreshToken
                    ) {
                        throw new JsonWebTokenError("Invalid token");
                    }

                    const refreshedGuestSession = await adminService.refreshGuestSession(
                        currentTokenData.guestSessionId,
                        currentTokenData.refreshToken
                    );

                    const nextTokenData: AuthTokenData = {
                        ...currentTokenData,
                        identifier: refreshedGuestSession.userIdentifier,
                        username: refreshedGuestSession.username ?? currentTokenData.username,
                        refreshToken: refreshedGuestSession.refreshToken,
                        guestSessionId: refreshedGuestSession.guestSessionId,
                        tokenType: "guest",
                        accessToken: undefined,
                    };

                    const nextAuthToken = buildAuthToken(nextTokenData, {
                        expiresIn: `${GUEST_ACCESS_TOKEN_TTL_HOURS}h`,
                    });

                    return {
                        nextTokenData,
                        nextAuthToken,
                    };
                };

                try {
                    authTokenData = jwtTokenManager.verifyJWTToken(token, false);
                } catch (error) {
                    if (error instanceof TokenExpiredError) {
                        const decodedTokenData = jwtTokenManager.verifyJWTToken(token, true);
                        if (
                            decodedTokenData.tokenType === "guest" &&
                            decodedTokenData.guestSessionId &&
                            decodedTokenData.refreshToken
                        ) {
                            const refreshedGuestToken = await refreshGuestToken(decodedTokenData);
                            authTokenData = refreshedGuestToken.nextTokenData;
                            refreshedAuthToken = refreshedGuestToken.nextAuthToken;
                        } else {
                            throw new JsonWebTokenError("Invalid token");
                        }
                    } else {
                        throw error;
                    }
                }

                let accessToken = authTokenData.accessToken;
                let refreshToken = authTokenData.refreshToken;

                //Get user data from Admin Back Office
                //This is very important to create User Local in LocalStorage in WorkAdventure
                let resUserData: FetchMemberDataByUuidResponse;
                try {
                    resUserData = await adminService.fetchMemberDataByUuid(
                        authTokenData.identifier,
                        accessToken,
                        authTokenData.tokenType,
                        playUri,
                        IPAddress,
                        localStorageCharacterTextureIds ?? [],
                        localStorageCompanionTextureId,
                        req.header("accept-language"),
                        authTokenData.tags,
                        chatID,
                        inviteToken,
                        authTokenData.guestSessionId
                    );
                } catch (err) {
                    if (err instanceof JsonWebTokenError && refreshToken) {
                        if (authTokenData.tokenType === "guest") {
                            const refreshedGuestToken = await refreshGuestToken(authTokenData);
                            authTokenData = refreshedGuestToken.nextTokenData;
                            accessToken = undefined;
                            refreshToken = authTokenData.refreshToken;
                            refreshedAuthToken = refreshedGuestToken.nextAuthToken;
                        } else {
                            const refreshedTokens = await refreshAccessToken(refreshToken);
                            accessToken = refreshedTokens.nextAccessToken;
                            refreshToken = refreshedTokens.nextRefreshToken;
                            refreshedAuthToken = refreshedTokens.nextAuthToken;
                            authTokenData = {
                                ...authTokenData,
                                accessToken,
                                refreshToken,
                            };
                        }

                        resUserData = await adminService.fetchMemberDataByUuid(
                            authTokenData.identifier,
                            accessToken,
                            authTokenData.tokenType,
                            playUri,
                            IPAddress,
                            localStorageCharacterTextureIds ?? [],
                            localStorageCompanionTextureId,
                            req.header("accept-language"),
                            authTokenData.tags,
                            chatID,
                            inviteToken,
                            authTokenData.guestSessionId
                        );
                    } else {
                        throw err;
                    }
                }

                if (resUserData.status === "error") {
                    res.json(resUserData);
                    return;
                }

                const adminUsername =
                    typeof resUserData.username === "string" ? resUserData.username.trim() : undefined;
                const resolvedUsername =
                    adminUsername && adminUsername.length > 0 ? adminUsername : authTokenData.username;

                if (resolvedUsername !== authTokenData.username) {
                    authTokenData = {
                        ...authTokenData,
                        username: resolvedUsername,
                    };
                    refreshedAuthToken = buildAuthToken(authTokenData, {
                        accessToken,
                        refreshToken,
                    });
                }

                if (accessToken == undefined) {
                    //if not nonce and code, anonymous user connected
                    //get data with identifier and return token
                    res.json({
                        authToken: refreshedAuthToken,
                        locale: authTokenData?.locale,
                        // TODO: replace ... with each property
                        ...resUserData,
                        matrixUserId: authTokenData?.matrixUserId,
                        matrixServerUrl: MATRIX_PUBLIC_URI,
                        username: resolvedUsername,
                    } satisfies MeResponse);
                    return;
                }

                try {
                    let resCheckTokenAuth;
                    try {
                        resCheckTokenAuth = await openIDClient.checkTokenAuth(accessToken);
                    } catch (err) {
                        if (refreshToken) {
                            const refreshedTokens = await refreshAccessToken(refreshToken);
                            accessToken = refreshedTokens.nextAccessToken;
                            refreshToken = refreshedTokens.nextRefreshToken;
                            refreshedAuthToken = refreshedTokens.nextAuthToken;
                            authTokenData = {
                                ...authTokenData,
                                accessToken,
                                refreshToken,
                            };
                            resCheckTokenAuth = await openIDClient.checkTokenAuth(accessToken);
                        } else {
                            throw err;
                        }
                    }
                    res.json({
                        authToken: refreshedAuthToken,
                        locale: authTokenData?.locale,
                        matrixUserId: authTokenData?.matrixUserId,
                        matrixServerUrl: (resCheckTokenAuth.matrix_url as string | undefined) ?? MATRIX_PUBLIC_URI,
                        // TODO: replace ... with each property
                        ...resUserData,
                        ...resCheckTokenAuth,
                        username: resolvedUsername,
                    } satisfies MeResponse);
                } catch (err) {
                    console.warn("Error while checking token auth", err);
                    throw new JsonWebTokenError("Invalid token");
                }
                return;
            } catch (err) {
                if (err instanceof JsonWebTokenError) {
                    res.status(401);
                    res.send("Invalid token");
                    return;
                }

                /*if (isAxiosError(err)) {
                    const errorType = ErrorApiData.safeParse(err?.response?.data);
                    if (errorType.success) {
                        const status = err?.response?.status ?? 500;
                        res.atomic(() => {
                            res.sendStatus(status);
                            res.json(errorType.data);
                        });
                        return;
                    }
                }*/
                throw err;
            }
        });
    }

    private openIDCallback(): void {
        /**
         * @openapi
         * /openid-callback:
         *   get:
         *     description: This endpoint is meant to be called by the OpenID provider after the OpenID provider handles a login attempt. The OpenID provider redirects the browser to this endpoint.
         *     parameters:
         *      - name: "code"
         *        in: "query"
         *        description: "A unique code to be exchanged for an authentication token"
         *        required: false
         *        type: "string"
         *      - name: "nonce"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *     responses:
         *       302:
         *         description: Redirects to play once authentication is done, unless we use an AdminAPI (in this case, we redirect to the AdminAPI with same parameters)
         */

        this.app.get("/openid-callback", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const playUri = req.cookies.playUri;
            if (!playUri) {
                throw new Error("Missing playUri in cookies");
            }

            let userInfo = null;
            try {
                userInfo = await openIDClient.getUserInfo(req, res, playUri);
            } catch (err) {
                //if no access on openid provider, return error
                console.error("An error occurred while connecting to OpenID Provider => ", err);
                res.status(500);
                res.send("An error occurred while connecting to OpenID Provider");
                return;
            }
            const email = userInfo.email || userInfo.sub;
            if (!email) {
                throw new Error("No email in the response");
            }
            const authToken = jwtTokenManager.createAuthToken(
                email,
                userInfo?.access_token,
                userInfo?.username,
                userInfo?.locale,
                userInfo?.tags,
                email ? matrixProvider.getBareMatrixIdFromEmail(email) : undefined,
                userInfo?.refresh_token
            );

            const matrixPublicUri = userInfo.matrix_url ?? MATRIX_PUBLIC_URI;

            // If Matrix is configured, we need to get an access token for the Synapse server
            if (matrixPublicUri) {
                // TODO: check Matrix server login parameters to be sure we can connect

                const matrixCallbackUrl = new URL("/matrix-callback", PUSHER_URL).toString();
                let redirectPath = "/_matrix/client/v3/login/sso/redirect";
                if (userInfo.matrix_identity_provider) {
                    redirectPath += "/" + userInfo.matrix_identity_provider;
                }
                const matrixRedirectUrl = new URL(redirectPath, matrixPublicUri);
                matrixRedirectUrl.searchParams.append("redirectUrl", matrixCallbackUrl);

                // Note: the authToken cannot be saved in a cookie because sometimes, it can be pretty large (>4kB)
                // Therefore, we use localStorage to store it. So we need to render an HTML page with a script that will
                // save the token in localStorage
                const html = Mustache.render(this.redirectToMatrixFile, {
                    authToken,
                    matrixRedirectUrl: matrixRedirectUrl.toString(),
                });

                res.type("html").send(html);

                return;
            }

            res.clearCookie("playUri");
            // FIXME: possibly redirect to Admin instead.
            res.redirect(playUri + "?token=" + encodeURIComponent(authToken));
            return;
        });
    }

    private matrixCallback(): void {
        /**
         * @openapi
         * /matrix-callback:
         *   get:
         *     description: This endpoint is meant to be called by the Matrix server (Synapse) after the OpenID provider connected to Synapse handles a login attempt. Synapse redirects the browser to this endpoint.
         *     parameters:
         *      - name: "loginToken"
         *        in: "query"
         *        description: "A unique token that can be exchanged for a Matrix authentication token"
         *        required: true
         *        type: "string"
         *     responses:
         *       302:
         *         description: Redirects to play once authentication is done.
         */
        this.app.get("/matrix-callback", (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const playUri = req.cookies.playUri;
            if (!playUri) {
                throw new Error("Missing playUri in cookies");
            }

            const query = validateQuery(
                req,
                res,
                z.object({ loginToken: z.string(), chatRoomId: z.string().optional() })
            );
            if (query === undefined) {
                return;
            }

            res.clearCookie("playUri");
            res.clearCookie("authToken");
            const playUriUrl = new URL(req.cookies.playUri);
            playUriUrl.searchParams.append("matrixLoginToken", query.loginToken);

            if (query.chatRoomId) {
                playUriUrl.searchParams.append("chatRoomId", query.chatRoomId);
            }

            const html = Mustache.render(this.redirectToPlayFile, {
                playUri: playUriUrl.toString(),
            });
            res.type("html").send(html);
            return;
        });
    }

    /**
     * @openapi
     * /register:
     *   post:
     *     description: Try to login with an admin token
     *     parameters:
     *      - name: "organizationMemberToken"
     *        in: "body"
     *        description: "A token allowing a user to connect to a given world"
     *        required: true
     *        type: "string"
     *     responses:
     *       200:
     *         description: The details of the logged user
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 authToken:
     *                   type: string
     *                   description: A unique identification JWT token
     *                 userUuid:
     *                   type: string
     *                   description: Unique user ID
     *                 email:
     *                   type: string|null
     *                   description: The email of the user
     *                   example: john.doe@example.com
     *                 roomUrl:
     *                   type: string
     *                   description: The room URL to connect to
     *                   example: https://play.workadventu.re/@/foo/bar/baz
     *                 organizationMemberToken:
     *                   type: string|null
     *                   description: TODO- unclear. It seems to be sent back from the request?
     *                   example: ???
     *                 mapUrlStart:
     *                   type: string
     *                   description: TODO- unclear. I cannot find any use of this
     *                   example: ???
     *                 messages:
     *                   type: array
     *                   description: The list of messages to be displayed when the user logs?
     *                   example: ???
     */
    private register(): void {
        this.app.options("/register", (req, res) => {
            res.status(200).send("");
        });

        this.app.post("/register", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const param = req.body;

            //todo: what to do if the organizationMemberToken is already used?
            const organizationMemberToken: string | null = param.organizationMemberToken;
            const playUri: string | null = param.playUri;

            if (typeof organizationMemberToken != "string") throw new Error("No organization token");
            const data = await adminService.fetchMemberDataByToken(
                organizationMemberToken,
                playUri,
                req.header("accept-language")
            );
            const userUuid = data.userUuid;
            const email = data.email;
            const roomUrl = data.roomUrl;
            const mapUrlStart = data.mapUrlStart;
            const matrixUserId = email ? matrixProvider.getBareMatrixIdFromEmail(email) : undefined;

            const authToken = jwtTokenManager.createAuthToken(
                email || userUuid,
                undefined,
                undefined,
                undefined,
                [],
                matrixUserId
            );

            res.json({
                authToken,
                userUuid,
                email,
                roomUrl,
                mapUrlStart,
                organizationMemberToken,
            } satisfies RegisterData);
        });
    }

    /**
     * @openapi
     * /anonymLogin:
     *   post:
     *     description: Generates an "anonymous" JWT token allowing to connect to WorkAdventure anonymously.
     *     responses:
     *       200:
     *         description: The details of the logged user
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 authToken:
     *                   type: string
     *                   description: A unique identification JWT token
     *                 userUuid:
     *                   type: string
     *                   description: Unique user ID
     *       403:
     *         description: Anonymous login is disabled at the configuration level (environment variable DISABLE_ANONYMOUS = true)
     */
    private anonymLogin(): void {
        this.app.post("/anonymLogin", (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            if (DISABLE_ANONYMOUS || INVITE_ONLY_GUEST_ENABLED) {
                res.status(403).send("");
                return;
            } else {
                const userUuid = v4();
                const authToken = jwtTokenManager.createAuthToken(userUuid);
                res.json({
                    authToken,
                    userUuid,
                });
                return;
            }
        });
    }

    /**
     * @openapi
     * /profile-callback:
     *   get:
     *     description: ???
     *     parameters:
     *      - name: "token"
     *        in: "query"
     *        description: "A JWT authentication token ???"
     *        required: true
     *        type: "string"
     *      - name: "playUri"
     *        in: "query"
     *        description: "Room URL of the current virtual place"
     *        required: true
     *        type: "string"
     *     responses:
     *       302:
     *         description: Redirects the user to the profile screen of the admin
     */
    private profileCallback(): void {
        this.app.get("/profile-callback", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(
                req,
                res,
                z.object({
                    token: z.string(),
                    playUri: z.string(),
                })
            );
            if (query === undefined) {
                return;
            }
            const { token, playUri } = query;
            const authTokenData: AuthTokenData = jwtTokenManager.verifyJWTToken(token, false);
            if (authTokenData.accessToken == undefined) {
                throw Error("Token cannot be checked on OpenID connect provider");
            }
            await openIDClient.checkTokenAuth(authTokenData.accessToken);

            const accessToken = authTokenData.accessToken;
            //get login profile
            res.status(302);
            res.setHeader("Location", adminService.getProfileUrl(accessToken, playUri));
            res.send("");
            return;
        });
    }

    private logoutCallback(): void {
        /**
         * @openapi
         * /logout-callback:
         *   get:
         *     description: TODO
         *     parameters:
         *      - name: "token"
         *        in: "query"
         *        description: "todo"
         *        required: false
         *        type: "string"
         *     responses:
         *       200:
         *         description: TODO
         *
         */
        this.app.get("/logout-callback", (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            // if no playUri, redirect to front
            if (!req.cookies.playUri) {
                res.redirect(FRONT_URL);
                return;
            }

            // when user logout, redirect to playUri saved in cookie
            const logOutAdminUrl = new URL(req.cookies.playUri);
            res.clearCookie("playUri");
            res.redirect(logOutAdminUrl.toString());
            return;
        });
    }

    private logoutUser(): void {
        /**
         * @openapi
         * /logout:
         *   get:
         *     description: TODO
         *     responses:
         *       302:
         *         description: Redirects the user to the OpenID logout screen
         */
        this.app.get("/logout", async (req, res) => {
            debug(`AuthenticateController => [${req.method}] ${req.originalUrl} — IP: ${req.ip} — Time: ${Date.now()}`);
            const query = validateQuery(
                req,
                res,
                z.object({
                    playUri: z.string(),
                    token: z.string(),
                    redirect: z.string().optional(),
                })
            );
            if (query === undefined) {
                return;
            }

            const verifyDomainService_ = VerifyDomainService.get(await adminService.getCapabilities());
            const verifyDomainResult = await verifyDomainService_.verifyDomain(query.playUri);
            if (!verifyDomainResult) {
                res.status(403);
                res.send("Unauthorized domain in playUri");
                return;
            }

            const authTokenData: AuthTokenData = jwtTokenManager.verifyJWTToken(query.token, false);
            if (authTokenData.accessToken == undefined) {
                throw Error("Cannot log out, no access token found.");
            }
            // TODO: change that to use end session endpoint
            // Use post logout redirect and id token hint to redirect on the logut session endpoint of the OpenId provider
            // https://openid.net/specs/openid-connect-session-1_0.html#RPLogout
            await openIDClient.logoutUser(authTokenData.accessToken);

            // if no redirect, redirect to playUri and connect user to the world
            // if the world is with authentication mandatory, the user will be redirected to the login screen
            // if the world is anonymous or with authentication optional, the user will be connected to the world
            if (!query.redirect) {
                res.redirect(query.playUri);
                return;
            }

            // save the playUri in cookie to redirect to the world after logout
            res.cookie("playUri", query.playUri, {
                httpOnly: true, // dont let browser javascript access cookie ever
                secure: req.secure, // only use cookie over https
            });
            res.redirect(query.redirect);
        });
    }
}
