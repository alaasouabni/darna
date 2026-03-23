import type { Capabilities, SpaceUser } from "@workadventure/messages";
import { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_HOST, MAX_USERS_FOR_WEBRTC } from "../Enum/EnvironmentVariable";
import type { ICommunicationSpace } from "./Interfaces/ICommunicationSpace";
import type { ICommunicationManager } from "./Interfaces/ICommunicationManager";
import type { ICommunicationState } from "./Interfaces/ICommunicationState";
import { CommunicationType } from "./Types/CommunicationTypes";
import { WebRTCState } from "./States/WebRTCState";
import { LivekitState } from "./States/LivekitState";
import { VoidState } from "./States/VoidState";
import { UserRegistry } from "./Services/UserRegistry";
import { TransitionPolicy } from "./Policies/TransitionPolicy";
import { TransitionOrchestrator } from "./Services/TransitionOrchestrator";
import { StateLifecycleManager } from "./Services/StateLifecycleManager";
import { LivekitAvailabilityService } from "./Services/LivekitAvailabilityService";
import { getCapability } from "../Services/Capabilities";
import type { IUserRegistry } from "./Interfaces/IUserRegistry";
import type { ITransitionPolicy } from "./Interfaces/ITransitionPolicy";
import type { ITransitionOrchestrator, TransitionContext } from "./Interfaces/ITransitionOrchestrator";
import type { IStateLifecycleManager } from "./Interfaces/IStateLifecycleManager";

/**
 * Factory interface for creating the initial communication state.
 * Used for dependency injection in tests.
 */
export interface InitialStateFactory {
    createInitialState(
        space: ICommunicationSpace,
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>
    ): ICommunicationState;
}

/**
 * Default implementation of InitialStateFactory.
 * Creates WebRTCState or VoidState based on media properties.
 */
export class DefaultInitialStateFactory implements InitialStateFactory {
    private static readonly LIVEKIT_CREDENTIALS_CAPABILITY: keyof Capabilities = "api/livekit/credentials";
    private static readonly LIVEKIT_CREDENTIALS_VERSION = "v1";

    private canUseSynchronousLivekitInitialization(): boolean {
        const hasEnvCredentials = Boolean(LIVEKIT_HOST && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);
        if (!hasEnvCredentials) {
            return false;
        }

        try {
            const capability = getCapability(DefaultInitialStateFactory.LIVEKIT_CREDENTIALS_CAPABILITY);
            return capability !== DefaultInitialStateFactory.LIVEKIT_CREDENTIALS_VERSION;
        } catch {
            // Capabilities may not be initialized yet during startup/tests.
            // If env credentials exist, allow synchronous LiveKit initialization.
            return true;
        }
    }

    createInitialState(
        space: ICommunicationSpace,
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>
    ): ICommunicationState {
        const propertiesToSync = space.getPropertiesToSync();
        const isLivekitRequiredSpace = propertiesToSync.includes("livekitRequired");

        if (isLivekitRequiredSpace && this.canUseSynchronousLivekitInitialization()) {
            try {
                return new LivekitState(space, undefined, users, usersToNotify);
            } catch (error) {
                console.error(
                    "[CommunicationManager] failed to initialize LiveKit-required space in LiveKit, falling back to WebRTC",
                    {
                        spaceName: space.getSpaceName(),
                        error,
                    }
                );
            }
        }

        const hasMediaProperties = propertiesToSync.some((prop) =>
            ["cameraState", "microphoneState", "screenSharingState"].includes(prop)
        );

        return hasMediaProperties ? new WebRTCState(space, users, usersToNotify) : new VoidState();
    }
}

/**
 * Dependencies for CommunicationManager.
 * All fields are optional - defaults will be used if not provided.
 */
export interface CommunicationManagerDependencies {
    userRegistry?: IUserRegistry;
    policy?: ITransitionPolicy;
    orchestrator?: ITransitionOrchestrator;
    lifecycleManager?: IStateLifecycleManager;
    initialStateFactory?: InitialStateFactory;
    livekitToWebRTCDelayMs?: number;
}

/**
 * Facade for managing communication states in a space.
 *
 * This class coordinates multiple specialized services:
 * - UserRegistry: manages user collections
 * - TransitionPolicy: decides when transitions should occur (pure logic)
 * - TransitionOrchestrator: executes transitions with proper timing and cancellation
 * - StateLifecycleManager: manages state initialization and finalization
 *
 * Single Responsibility: Coordinate the services and expose a simple API.
 */
export class CommunicationManager implements ICommunicationManager {
    private readonly userRegistry: IUserRegistry;
    private readonly policy: ITransitionPolicy;
    private readonly orchestrator: ITransitionOrchestrator;
    private readonly lifecycleManager: IStateLifecycleManager;
    private readonly space: ICommunicationSpace;
    private eventProcessingQueue: Promise<void> = Promise.resolve();

    private static readonly DEFAULT_LIVEKIT_TO_WEBRTC_DELAY_MS = 20_000; // 20 seconds

    /**
     * Creates a new CommunicationManager.
     *
     * @param space - The communication space to manage
     * @param dependencies - Optional dependencies for dependency injection (useful for testing)
     */
    constructor(space: ICommunicationSpace, dependencies: CommunicationManagerDependencies = {}) {
        this.space = space;

        const delayMs = dependencies.livekitToWebRTCDelayMs ?? CommunicationManager.DEFAULT_LIVEKIT_TO_WEBRTC_DELAY_MS;

        // Initialize user registry
        this.userRegistry = dependencies.userRegistry ?? new UserRegistry();

        // Initialize transition policy with LiveKit availability checker
        this.policy =
            dependencies.policy ?? new TransitionPolicy(MAX_USERS_FOR_WEBRTC, new LivekitAvailabilityService());

        // Initialize transition orchestrator
        this.orchestrator = dependencies.orchestrator ?? new TransitionOrchestrator(delayMs);

        // Create initial state using factory or default
        if (dependencies.lifecycleManager) {
            this.lifecycleManager = dependencies.lifecycleManager;
        } else {
            const stateFactory = dependencies.initialStateFactory ?? new DefaultInitialStateFactory();
            const initialState = stateFactory.createInitialState(
                this.space,
                this.userRegistry.getUsers(),
                this.userRegistry.getUsersToNotify()
            );
            this.lifecycleManager = new StateLifecycleManager(initialState);
            initialState.init();
        }
    }

    public async handleUserAdded(user: SpaceUser): Promise<void> {
        await this.runSerialized(async () => {
            this.userRegistry.addUser(user);
            this.cancelPendingTransitionIfNeeded();

            await this.lifecycleManager.getCurrentState().handleUserAdded(user);
            await this.evaluateAndHandleTransition(user);
        });
    }

    public async handleUserDeleted(user: SpaceUser): Promise<void> {
        await this.runSerialized(async () => {
            this.userRegistry.deleteUser(user.spaceUserId);
            this.cancelPendingTransitionIfNeeded();

            await this.lifecycleManager.getCurrentState().handleUserDeleted(user);
            await this.evaluateAndHandleTransition(user);
        });
    }

    public async handleUserUpdated(
        user: SpaceUser,
        options?: {
            screenSharingStopped?: boolean;
        }
    ): Promise<void> {
        await this.runSerialized(async () => {
            if (this.userRegistry.hasUser(user.spaceUserId)) {
                this.userRegistry.addUser(user);
            }
            if (this.userRegistry.hasUserToNotify(user.spaceUserId)) {
                this.userRegistry.addUserToNotify(user);
            }

            if (user.screenSharingState || options?.screenSharingStopped) {
                this.logTransitionDebug("user_updated_media", user, {
                    screenSharingState: user.screenSharingState,
                    screenSharingStopped: options?.screenSharingStopped === true,
                });
            }

            await this.lifecycleManager.getCurrentState().handleUserUpdated(user);
            await this.tryTransitionToLivekitForScreenShare(user);

            // When screen sharing stops, try an immediate downgrade path so users can
            // quickly reconnect to nearby WebRTC conversations after leaving meetings.
            if (options?.screenSharingStopped === true) {
                await this.tryFastTransitionToWebRTCAfterScreenShareStop(user);
            }
        });
    }

    public async handleUserToNotifyAdded(user: SpaceUser): Promise<void> {
        await this.runSerialized(async () => {
            this.userRegistry.addUserToNotify(user);
            this.cancelPendingTransitionIfNeeded();

            await this.lifecycleManager.getCurrentState().handleUserToNotifyAdded(user);
            await this.evaluateAndHandleTransition(user);
        });
    }

    public async handleUserToNotifyDeleted(user: SpaceUser): Promise<void> {
        await this.runSerialized(async () => {
            this.userRegistry.deleteUserToNotify(user.spaceUserId);
            this.cancelPendingTransitionIfNeeded();

            await this.lifecycleManager.getCurrentState().handleUserToNotifyDeleted(user);
            await this.evaluateAndHandleTransition(user);
        });
    }

    private async runSerialized<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.eventProcessingQueue.then(operation, operation);
        this.eventProcessingQueue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    /**
     * Evaluates if a transition is needed and handles it accordingly.
     */
    private async evaluateAndHandleTransition(user: SpaceUser): Promise<void> {
        const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
        if (this.isLivekitMandatorySpace()) {
            if (currentType === CommunicationType.WEBRTC) {
                this.logTransitionDebug("mandatory_livekit_transition", user, {
                    currentType,
                    reason: "livekit_required_space",
                });
                await this.forceImmediateTransitionToLivekit(user);
            }
            return;
        }

        const userCount = this.getTransitionUserCount();

        // Check if transition is needed
        if (!this.policy.shouldTransition(currentType, userCount)) {
            return;
        }

        const nextStateType = this.policy.getNextStateType(currentType, userCount);
        if (!nextStateType) {
            return;
        }

        if (nextStateType === CommunicationType.WEBRTC && this.hasActiveScreenShare()) {
            this.orchestrator.cancelPendingTransition();
            this.logTransitionDebug("cancel_threshold_downgrade_active_screen_share", user, {
                currentType,
                nextStateType,
            });
            return;
        }

        this.logTransitionDebug("threshold_transition", user, {
            currentType,
            nextStateType,
        });

        // Execute transition with lock
        await this.executeTransition(nextStateType, user);
    }

    /**
     * Forces a WebRTC -> LiveKit transition when a user requests screen sharing.
     * This enables automatic handover even when the room is below MAX_USERS_FOR_WEBRTC.
     */
    private async tryTransitionToLivekitForScreenShare(user: SpaceUser): Promise<void> {
        if (!this.isLivekitMandatorySpace()) {
            return;
        }

        if (!user.screenSharingState) {
            return;
        }

        if (this.orchestrator.hasPendingTransition()) {
            this.orchestrator.cancelPendingTransition();
        }

        const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
        if (currentType !== CommunicationType.WEBRTC) {
            return;
        }

        this.logTransitionDebug("force_livekit_screen_share", user, {
            currentType,
            fromUsers: this.userRegistry.hasUser(user.spaceUserId),
            fromUsersToNotify: this.userRegistry.hasUserToNotify(user.spaceUserId),
        });

        await this.forceImmediateTransitionToLivekit(user);
    }

    private async tryFastTransitionToWebRTCAfterScreenShareStop(user: SpaceUser): Promise<void> {
        if (this.isLivekitMandatorySpace()) {
            return;
        }

        const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
        if (currentType !== CommunicationType.LIVEKIT) {
            return;
        }

        if (this.hasActiveScreenShare()) {
            return;
        }

        const userCount = this.getTransitionUserCount();
        if (!this.policy.shouldTransition(currentType, userCount)) {
            return;
        }

        const nextStateType = this.policy.getNextStateType(currentType, userCount);
        if (nextStateType !== CommunicationType.WEBRTC) {
            return;
        }

        this.logTransitionDebug("fast_downgrade_after_screen_share_stop", user, {
            currentType,
            nextStateType,
        });

        this.orchestrator.cancelPendingTransition();
        const context: TransitionContext = {
            space: this.space,
            users: this.userRegistry.getUsers(),
            usersToNotify: this.userRegistry.getUsersToNotify(),
            playUri: user.playUri,
        };

        await this.executeImmediateTransitionWithValidation(CommunicationType.WEBRTC, context);
    }

    /**
     * Executes a state transition to the specified type.
     */
    private async executeTransition(nextStateType: CommunicationType, user: SpaceUser): Promise<void> {
        // Cancel any existing pending transition
        this.orchestrator.cancelPendingTransition();

        const context: TransitionContext = {
            space: this.space,
            users: this.userRegistry.getUsers(),
            usersToNotify: this.userRegistry.getUsersToNotify(),
            playUri: user.playUri,
        };

        // Handle different transition types
        if (nextStateType === CommunicationType.LIVEKIT) {
            // Immediate transition to LiveKit
            await this.executeImmediateTransitionWithValidation(nextStateType, context);
        } else if (nextStateType === CommunicationType.WEBRTC) {
            // Delayed transition to WebRTC
            this.logTransitionDebug("schedule_delayed_webrtc_transition", user, {
                nextStateType,
            });
            this.scheduleDelayedTransitionWithValidation(nextStateType, context);
        }
    }

    private async forceImmediateTransitionToLivekit(user: SpaceUser): Promise<void> {
        this.orchestrator.cancelPendingTransition();
        const context: TransitionContext = {
            space: this.space,
            users: this.userRegistry.getUsers(),
            usersToNotify: this.userRegistry.getUsersToNotify(),
            playUri: user.playUri,
        };
        await this.executeImmediateTransitionWithValidation(CommunicationType.LIVEKIT, context, true);
    }

    /**
     * Executes an immediate transition with validation.
     */
    private async executeImmediateTransitionWithValidation(
        type: CommunicationType,
        context: TransitionContext,
        force = false
    ): Promise<void> {
        const nextState = await this.orchestrator.executeImmediateTransition(type, context);

        if (!nextState) {
            return;
        }

        if (!force) {
            // Final validation before setting state
            const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
            const userCount = this.getTransitionUserCount();

            if (!this.policy.shouldTransition(currentType, userCount)) {
                return;
            }

            const expectedNextType = this.policy.getNextStateType(currentType, userCount);
            if (expectedNextType && nextState.communicationType !== expectedNextType) {
                return;
            }
        }

        this.lifecycleManager.transitionTo(nextState);
        console.log("[CommunicationManager] transition_applied", {
            spaceName: this.space.getSpaceName(),
            to: nextState.communicationType,
            force,
            userCount: this.space.getAllUsers().length,
            transitionUserCount: this.getTransitionUserCount(),
            usersInFilterCount: this.space.getUsersInFilter().length,
            usersToNotifyCount: this.space.getUsersToNotify().length,
        });
    }

    /**
     * Schedules a delayed transition with validation.
     */
    private scheduleDelayedTransitionWithValidation(type: CommunicationType, context: TransitionContext): void {
        this.orchestrator.scheduleDelayedTransition(
            type,
            context,
            (nextState) => {
                if (nextState.communicationType === CommunicationType.WEBRTC && this.hasActiveScreenShare()) {
                    return;
                }

                // Final validation before setting state
                const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
                const userCount = this.getTransitionUserCount();

                if (!this.policy.shouldTransition(currentType, userCount)) {
                    return;
                }

                const expectedNextType = this.policy.getNextStateType(currentType, userCount);
                if (!expectedNextType || nextState.communicationType === expectedNextType) {
                    this.lifecycleManager.transitionTo(nextState);
                }
            },
            (error) => {
                console.error("Error during scheduled transition:", error);
            }
        );
    }

    /**
     * Cancels pending transition if conditions no longer allow switching.
     */
    private cancelPendingTransitionIfNeeded(): void {
        if (!this.orchestrator.hasPendingTransition()) {
            return;
        }

        if (this.hasActiveScreenShare()) {
            this.orchestrator.cancelPendingTransition();
            return;
        }

        const currentType = this.lifecycleManager.getCurrentState().communicationType as CommunicationType;
        const userCount = this.getTransitionUserCount();

        if (!this.policy.shouldTransition(currentType, userCount)) {
            this.orchestrator.cancelPendingTransition();
        }
    }

    private hasActiveScreenShare(): boolean {
        for (const user of this.userRegistry.getUsers().values()) {
            if (user.screenSharingState) {
                return true;
            }
        }

        for (const user of this.userRegistry.getUsersToNotify().values()) {
            if (user.screenSharingState) {
                return true;
            }
        }

        return false;
    }

    private getTransitionUserCount(): number {
        const usersInFilterCount = this.space.getUsersInFilter().length;
        const usersToNotifyCount = this.space.getUsersToNotify().length;

        // In streaming/listener spaces, usersToNotify can be populated while there are
        // no active publishers in filter. Avoid promoting to LiveKit from listener-only state.
        if (usersInFilterCount === 0 && usersToNotifyCount > 0) {
            return 0;
        }

        // Transition decisions should reflect active communication graph size
        // (participants in filter/notify), not raw space occupancy.
        return Math.max(usersInFilterCount, usersToNotifyCount);
    }

    private logTransitionDebug(
        reason:
            | "user_updated_media"
            | "threshold_transition"
            | "cancel_threshold_downgrade_active_screen_share"
            | "force_livekit_screen_share"
            | "fast_downgrade_after_screen_share_stop"
            | "schedule_delayed_webrtc_transition"
            | "mandatory_livekit_transition",
        user: SpaceUser,
        details: Record<string, unknown> = {}
    ): void {
        console.log("[CommunicationManager] transition_debug", {
            reason,
            spaceName: this.space.getSpaceName(),
            userId: user.spaceUserId,
            playUri: user.playUri,
            userScreenSharingState: user.screenSharingState,
            userCount: this.space.getAllUsers().length,
            transitionUserCount: this.getTransitionUserCount(),
            usersInFilterCount: this.space.getUsersInFilter().length,
            usersToNotifyCount: this.space.getUsersToNotify().length,
            currentType: this.lifecycleManager.getCurrentState().communicationType,
            hasPendingTransition: this.orchestrator.hasPendingTransition(),
            hasActiveScreenShare: this.hasActiveScreenShare(),
            ...details,
        });
    }

    private isLivekitMandatorySpace(): boolean {
        const propertiesToSync = this.space.getPropertiesToSync();
        if (propertiesToSync.includes("livekitRequired")) {
            return true;
        }

        // Backward-compatible fallback for existing personal-area rooms.
        return this.space.getSpaceName().includes("personal-area-");
    }
}

/**
 * Export configuration for backward compatibility.
 */
export const CommunicationConfig = {
    MAX_USERS_FOR_WEBRTC,
};
