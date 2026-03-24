import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { inferWorldSlug } from "../config";
import { PageHeader } from "../components/PageHeader";

type RoomOption = {
  id: string;
  name?: string;
  roomUrl: string;
  isActive: boolean;
  isDefault: boolean;
  wamUrl?: string;
};

type DefaultRoomResponse = {
  worldId: string;
  worldSlug: string;
  defaultRoom: {
    id: string;
    name?: string;
    roomUrl: string;
    isActive: boolean;
  } | null;
};

type NotetakerConfig = {
  permissionPolicy: "all_users" | "selected_roles";
  allowedTags: string[];
  emailDigestEnabled: boolean;
  starterMustStay: boolean;
  allowAdminReadAll: boolean;
  transcriptRetentionDays: number;
  summaryRetentionDays: number;
};

type NotetakerStatusResponse = {
  enabled: boolean;
  config: NotetakerConfig;
  mistral?: {
    configured: boolean;
  };
};

type NotetakerConfigDraft = {
  permissionPolicy: "all_users" | "selected_roles";
  allowedTagsInput: string;
  emailDigestEnabled: boolean;
  starterMustStay: boolean;
  allowAdminReadAll: boolean;
  transcriptRetentionDays: number;
  summaryRetentionDays: number;
};

export function SettingsPage() {
  const { context } = useAdminContext();
  const worldSlug = context.worldSlug || inferWorldSlug(context.roomUrl);
  const [pendingDefaultRoomId, setPendingDefaultRoomId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [notetakerFeedback, setNotetakerFeedback] = useState<string | null>(
    null
  );
  const [notetakerError, setNotetakerError] = useState<string | null>(null);
  const [isSavingNotetakerConfig, setIsSavingNotetakerConfig] = useState(false);
  const [notetakerConfigDraft, setNotetakerConfigDraft] =
    useState<NotetakerConfigDraft>({
      permissionPolicy: "all_users",
      allowedTagsInput: "",
      emailDigestEnabled: false,
      starterMustStay: false,
      allowAdminReadAll: false,
      transcriptRetentionDays: 90,
      summaryRetentionDays: 180,
    });

  const roomsQuery = useQuery({
    queryKey: ["world-rooms", worldSlug],
    enabled: Boolean(worldSlug),
    queryFn: () =>
      apiRequest<RoomOption[]>(
        buildQuery(`/world/${encodeURIComponent(worldSlug)}/rooms`, {
          includeInactive: 1,
        })
      ),
  });

  const defaultRoomQuery = useQuery({
    queryKey: ["world-default-room", worldSlug],
    enabled: Boolean(worldSlug),
    queryFn: () =>
      apiRequest<DefaultRoomResponse>(
        `/world/${encodeURIComponent(worldSlug)}/default-room`
      ),
  });

  const notetakerStatusQuery = useQuery({
    queryKey: ["notetaker-status"],
    queryFn: () => apiRequest<NotetakerStatusResponse>("/notetaker/status"),
  });

  const notetakerConfigQuery = useQuery({
    queryKey: ["notetaker-config"],
    queryFn: () => apiRequest<{ config: NotetakerConfig }>("/notetaker/config"),
  });

  const rooms = roomsQuery.data ?? [];
  const activeRooms = useMemo(
    () => rooms.filter((room) => room.isActive),
    [rooms]
  );

  useEffect(() => {
    const defaultRoomId = defaultRoomQuery.data?.defaultRoom?.id ?? "";
    setPendingDefaultRoomId(defaultRoomId);
  }, [defaultRoomQuery.data?.defaultRoom?.id]);

  useEffect(() => {
    const config = notetakerConfigQuery.data?.config;
    if (!config) {
      return;
    }

    setNotetakerConfigDraft({
      permissionPolicy: config.permissionPolicy,
      allowedTagsInput: config.allowedTags.join(", "),
      emailDigestEnabled: config.emailDigestEnabled,
      starterMustStay: config.starterMustStay,
      allowAdminReadAll: config.allowAdminReadAll,
      transcriptRetentionDays: config.transcriptRetentionDays,
      summaryRetentionDays: config.summaryRetentionDays,
    });
  }, [notetakerConfigQuery.data?.config]);

  const handleSave = async () => {
    setFeedback(null);
    setError(null);

    if (!worldSlug) {
      setError("Set a world context first (world slug or room URL).");
      return;
    }

    if (!pendingDefaultRoomId) {
      setError("Select a default room.");
      return;
    }

    const selectedRoom = rooms.find((room) => room.id === pendingDefaultRoomId);
    if (!selectedRoom) {
      setError("Selected room does not exist in this world.");
      return;
    }

    if (!selectedRoom.isActive) {
      setError("Default room must be active.");
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest<{ status: string }>(
        `/world/${encodeURIComponent(worldSlug)}/default-room`,
        {
          method: "PUT",
          body: JSON.stringify({ roomId: pendingDefaultRoomId }),
        }
      );
      await Promise.all([roomsQuery.refetch(), defaultRoomQuery.refetch()]);
      setFeedback(`Default room updated to ${selectedRoom.roomUrl}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save default room."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNotetakerConfig = async () => {
    setNotetakerFeedback(null);
    setNotetakerError(null);

    const allowedTags = notetakerConfigDraft.allowedTagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    if (
      notetakerConfigDraft.permissionPolicy === "selected_roles" &&
      allowedTags.length === 0
    ) {
      setNotetakerError(
        "Add at least one role tag when using selected_roles policy."
      );
      return;
    }

    if (
      notetakerConfigDraft.transcriptRetentionDays < 1 ||
      notetakerConfigDraft.summaryRetentionDays < 1
    ) {
      setNotetakerError("Retention days must be at least 1.");
      return;
    }

    setIsSavingNotetakerConfig(true);
    try {
      await apiRequest<{ config: NotetakerConfig }>("/notetaker/config", {
        method: "PUT",
        body: JSON.stringify({
          permissionPolicy: notetakerConfigDraft.permissionPolicy,
          allowedTags,
          emailDigestEnabled: notetakerConfigDraft.emailDigestEnabled,
          starterMustStay: notetakerConfigDraft.starterMustStay,
          allowAdminReadAll: notetakerConfigDraft.allowAdminReadAll,
          transcriptRetentionDays: Math.floor(
            notetakerConfigDraft.transcriptRetentionDays
          ),
          summaryRetentionDays: Math.floor(
            notetakerConfigDraft.summaryRetentionDays
          ),
        }),
      });
      await Promise.all([
        notetakerConfigQuery.refetch(),
        notetakerStatusQuery.refetch(),
      ]);
      setNotetakerFeedback("AI notetaker settings saved.");
    } catch (err) {
      setNotetakerError(
        err instanceof Error
          ? err.message
          : "Unable to save AI notetaker settings."
      );
    } finally {
      setIsSavingNotetakerConfig(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        title="Settings"
        subtitle="World defaults and routing controls."
        actions={
          <button
            className="button solid"
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        }
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">World defaults</h2>
          <label className="field">
            <span>World slug</span>
            <input
              className="input"
              value={worldSlug}
              readOnly
              placeholder="darna"
            />
          </label>

          <label className="field">
            <span>Current default room</span>
            <input
              className="input"
              value={
                defaultRoomQuery.data?.defaultRoom?.roomUrl ??
                "No default configured"
              }
              readOnly
            />
          </label>

          <label className="field">
            <span>Set default room</span>
            <select
              className="input"
              value={pendingDefaultRoomId}
              onChange={(event) => setPendingDefaultRoomId(event.target.value)}
              disabled={
                !worldSlug || defaultRoomQuery.isLoading || roomsQuery.isLoading
              }
            >
              <option value="">Select a room</option>
              {activeRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.roomUrl}
                </option>
              ))}
            </select>
          </label>

          <p className="muted">
            {roomsQuery.isLoading
              ? "Loading rooms..."
              : `${activeRooms.length} active room(s) available for default routing.`}
          </p>

          {roomsQuery.isError && (
            <p className="muted">Unable to load world rooms.</p>
          )}
          {defaultRoomQuery.isError && (
            <p className="muted">Unable to load current default room.</p>
          )}
          {!worldSlug && (
            <p className="muted">
              Set a room URL or world slug in context first.
            </p>
          )}
          {!activeRooms.length && worldSlug && !roomsQuery.isLoading && (
            <p className="muted">No active rooms found for this world.</p>
          )}
          {feedback && <p className="muted">{feedback}</p>}
          {error && <p className="muted">{error}</p>}
        </div>

        <div className="card">
          <h2 className="section-title">Operational notes</h2>
          <ul className="list">
            <li>Default room must be active.</li>
            <li>
              Room lifecycle (activate/deactivate) is managed in the Rooms page.
            </li>
            <li>
              Use reverse-proxy canonicalization to avoid /~/ and /@ split
              instances.
            </li>
          </ul>
        </div>

        <div className="card">
          <h2 className="section-title">AI notetaker</h2>
          <p className="muted">
            Status:{" "}
            {notetakerStatusQuery.isLoading
              ? "Loading..."
              : notetakerStatusQuery.data?.enabled
              ? "Enabled"
              : "Disabled"}
          </p>
          <p className="muted">
            Mistral:{" "}
            {notetakerStatusQuery.data?.mistral?.configured === true
              ? "Configured"
              : notetakerStatusQuery.data?.mistral?.configured === false
              ? "Missing API key"
              : "Unknown"}
          </p>

          <label className="field">
            <span>Start/stop policy</span>
            <select
              className="input"
              value={notetakerConfigDraft.permissionPolicy}
              onChange={(event) =>
                setNotetakerConfigDraft((previous) => ({
                  ...previous,
                  permissionPolicy: event.target.value as
                    | "all_users"
                    | "selected_roles",
                }))
              }
              disabled={notetakerConfigQuery.isLoading}
            >
              <option value="all_users">All users</option>
              <option value="selected_roles">Selected roles</option>
            </select>
          </label>

          <label className="field">
            <span>Allowed role tags (comma-separated)</span>
            <input
              className="input"
              value={notetakerConfigDraft.allowedTagsInput}
              placeholder="manager, hr, facilitator"
              onChange={(event) =>
                setNotetakerConfigDraft((previous) => ({
                  ...previous,
                  allowedTagsInput: event.target.value,
                }))
              }
              disabled={notetakerConfigQuery.isLoading}
            />
          </label>

          <label className="field">
            <span>Transcript retention (days)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={notetakerConfigDraft.transcriptRetentionDays}
              onChange={(event) =>
                setNotetakerConfigDraft((previous) => ({
                  ...previous,
                  transcriptRetentionDays: Number(event.target.value),
                }))
              }
              disabled={notetakerConfigQuery.isLoading}
            />
          </label>

          <label className="field">
            <span>Summary retention (days)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={notetakerConfigDraft.summaryRetentionDays}
              onChange={(event) =>
                setNotetakerConfigDraft((previous) => ({
                  ...previous,
                  summaryRetentionDays: Number(event.target.value),
                }))
              }
              disabled={notetakerConfigQuery.isLoading}
            />
          </label>

          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={notetakerConfigDraft.emailDigestEnabled}
                onChange={(event) =>
                  setNotetakerConfigDraft((previous) => ({
                    ...previous,
                    emailDigestEnabled: event.target.checked,
                  }))
                }
                disabled={notetakerConfigQuery.isLoading}
              />{" "}
              Enable post-meeting digest delivery
            </span>
          </label>

          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={notetakerConfigDraft.starterMustStay}
                onChange={(event) =>
                  setNotetakerConfigDraft((previous) => ({
                    ...previous,
                    starterMustStay: event.target.checked,
                  }))
                }
                disabled={notetakerConfigQuery.isLoading}
              />{" "}
              Stop notes if starter leaves
            </span>
          </label>

          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={notetakerConfigDraft.allowAdminReadAll}
                onChange={(event) =>
                  setNotetakerConfigDraft((previous) => ({
                    ...previous,
                    allowAdminReadAll: event.target.checked,
                  }))
                }
                disabled={notetakerConfigQuery.isLoading}
              />{" "}
              Allow admins to read all transcripts
            </span>
          </label>

          <div className="button-stack">
            <button
              className="button solid"
              type="button"
              onClick={() => void handleSaveNotetakerConfig()}
              disabled={isSavingNotetakerConfig}
            >
              {isSavingNotetakerConfig
                ? "Saving..."
                : "Save AI notetaker settings"}
            </button>
          </div>

          {notetakerConfigQuery.isError && (
            <p className="muted">Unable to load AI notetaker config.</p>
          )}
          {notetakerStatusQuery.isError && (
            <p className="muted">Unable to load AI notetaker status.</p>
          )}
          {notetakerFeedback && <p className="muted">{notetakerFeedback}</p>}
          {notetakerError && <p className="muted">{notetakerError}</p>}
        </div>
      </div>
    </section>
  );
}
