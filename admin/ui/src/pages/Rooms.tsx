import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { inferWorldDomain, inferWorldSlug } from "../config";

type RoomSummary = {
  id: string;
  name?: string;
  roomUrl: string;
  wamUrl?: string;
  tags?: string[];
  isActive: boolean;
  isDefault: boolean;
};

type RoomTagFilter = "all" | "active" | "inactive";

export function RoomsPage() {
  const { context, updateContext } = useAdminContext();
  const [createRoomUrl, setCreateRoomUrl] = useState("");
  const [createWamUrl, setCreateWamUrl] = useState("");
  const [createRoomName, setCreateRoomName] = useState("");
  const [createWorldSlug, setCreateWorldSlug] = useState("");
  const [createWorldName, setCreateWorldName] = useState("");
  const [createWorldDomain, setCreateWorldDomain] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [createIsActive, setCreateIsActive] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [roomFilter, setRoomFilter] = useState<RoomTagFilter>("all");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [deactivationDraft, setDeactivationDraft] = useState<RoomSummary | null>(null);
  const [replacementDefaultRoomId, setReplacementDefaultRoomId] = useState("");

  const worldSlug = context.worldSlug || inferWorldSlug(context.roomUrl);

  const roomsQuery = useQuery({
    queryKey: ["rooms", context.roomUrl],
    enabled: Boolean(context.roomUrl),
    queryFn: () =>
      apiRequest<RoomSummary[]>(
        buildQuery("/room/sameWorld", {
          roomUrl: context.roomUrl,
          bypassTagFilter: 1,
          includeInactive: 1,
        })
      ),
  });

  const worldTagsQuery = useQuery({
    queryKey: ["world-tags", context.playUri],
    enabled: Boolean(context.playUri),
    queryFn: () =>
      apiRequest<string[]>(
        buildQuery("/world/tags", {
          playUri: context.playUri,
        })
      ),
  });

  const rooms = roomsQuery.data ?? [];

  const activeRooms = useMemo(() => rooms.filter((room) => room.isActive), [rooms]);

  const filteredRooms = useMemo(() => {
    if (roomFilter === "active") {
      return rooms.filter((room) => room.isActive);
    }
    if (roomFilter === "inactive") {
      return rooms.filter((room) => !room.isActive);
    }
    return rooms;
  }, [roomFilter, rooms]);

  useEffect(() => {
    if (!createRoomUrl && context.roomUrl) {
      setCreateRoomUrl(context.roomUrl);
    }
  }, [context.roomUrl, createRoomUrl]);

  useEffect(() => {
    if (!createWorldSlug) {
      const inferred = context.worldSlug || inferWorldSlug(context.roomUrl);
      if (inferred) {
        setCreateWorldSlug(inferred);
      }
    }
  }, [context.roomUrl, context.worldSlug, createWorldSlug]);

  useEffect(() => {
    if (!createWorldDomain && context.playUri) {
      const inferred = inferWorldDomain(context.playUri);
      if (inferred) {
        setCreateWorldDomain(inferred);
      }
    }
  }, [context.playUri, createWorldDomain]);

  useEffect(() => {
    if (!deactivationDraft || !deactivationDraft.isDefault) {
      setReplacementDefaultRoomId("");
      return;
    }

    const firstCandidate = activeRooms.find((room) => room.id !== deactivationDraft.id);
    setReplacementDefaultRoomId(firstCandidate?.id ?? "");
  }, [activeRooms, deactivationDraft]);

  const worldTags = worldTagsQuery.data ?? [];

  const clearActionMessages = () => {
    setActionError(null);
    setActionInfo(null);
  };

  const refetchRoomsData = async () => {
    await roomsQuery.refetch();
  };

  const handleNewRoom = () => {
    if (!context.playUri) {
      window.alert("Set a Play URL in the context card first.");
      return;
    }
    window.open(context.playUri, "_blank", "noopener");
  };

  const handleCreateRoom = async () => {
    if (!createRoomUrl) {
      setCreateError("Room URL is required.");
      return;
    }

    setCreateError(null);
    setIsCreating(true);

    const tags = createTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      await apiRequest<{ status: string }>("/room", {
        method: "POST",
        body: JSON.stringify({
          roomUrl: createRoomUrl,
          wamUrl: createWamUrl || undefined,
          name: createRoomName || undefined,
          playUri: context.playUri || undefined,
          worldSlug: createWorldSlug || undefined,
          worldName: createWorldName || undefined,
          worldDomain: createWorldDomain || undefined,
          tags,
          isActive: createIsActive,
        }),
      });
      await roomsQuery.refetch();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create the room.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetDefault = async (room: RoomSummary) => {
    clearActionMessages();

    if (!room.isActive) {
      setActionError("Only active rooms can be set as default.");
      return;
    }

    if (!worldSlug) {
      setActionError("World slug is missing. Set a room URL or world slug in context first.");
      return;
    }

    setIsApplyingAction(true);
    try {
      await apiRequest<{ status: string }>(`/world/${encodeURIComponent(worldSlug)}/default-room`, {
        method: "PUT",
        body: JSON.stringify({ roomId: room.id }),
      });
      await refetchRoomsData();
      setActionInfo(`Default room updated to ${room.roomUrl}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update default room.");
    } finally {
      setIsApplyingAction(false);
    }
  };

  const applyRoomState = async (
    room: RoomSummary,
    nextIsActive: boolean,
    replacementDefaultRoomIdInput?: string
  ) => {
    clearActionMessages();
    setIsApplyingAction(true);

    try {
      await apiRequest<{ status: string }>(`/room/${room.id}/state`, {
        method: "PATCH",
        body: JSON.stringify({
          isActive: nextIsActive,
          replacementDefaultRoomId: replacementDefaultRoomIdInput || undefined,
        }),
      });
      await refetchRoomsData();
      setActionInfo(
        nextIsActive
          ? `Room ${room.roomUrl} reactivated.`
          : `Room ${room.roomUrl} deactivated.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update room state.");
    } finally {
      setIsApplyingAction(false);
    }
  };

  const handleDeactivate = (room: RoomSummary) => {
    setDeactivationDraft(room);
  };

  const handleConfirmDeactivation = async () => {
    if (!deactivationDraft) {
      return;
    }

    if (deactivationDraft.isDefault && !replacementDefaultRoomId) {
      setActionError("Select a replacement default room before deactivating this room.");
      return;
    }

    await applyRoomState(
      deactivationDraft,
      false,
      deactivationDraft.isDefault ? replacementDefaultRoomId : undefined
    );
    setDeactivationDraft(null);
    setReplacementDefaultRoomId("");
  };

  const handleCancelDeactivation = () => {
    setDeactivationDraft(null);
    setReplacementDefaultRoomId("");
  };

  return (
    <section className="page">
      <PageHeader
        title="Rooms & maps"
        subtitle="Manage default routing and room lifecycle per world."
        actions={
          <button className="button solid" type="button" onClick={handleNewRoom}>
            New room
          </button>
        }
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">Context</h2>
          <label className="field">
            <span>Play URL</span>
            <input
              className="input"
              placeholder="https://darna.lightency.io/@/darna/office"
              value={context.playUri}
              onChange={(event) => updateContext({ playUri: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Room URL</span>
            <input
              className="input"
              placeholder="/@/darna/office"
              value={context.roomUrl}
              onChange={(event) => updateContext({ roomUrl: event.target.value })}
            />
          </label>
          <p className="muted">
            {roomsQuery.isLoading
              ? "Loading rooms..."
              : `Found ${rooms.length} rooms in the current world.`}
          </p>
          {roomsQuery.isError && <p className="muted">Unable to load rooms. Check the room URL.</p>}
          {worldSlug && <p className="muted">Resolved world: {worldSlug}</p>}
        </div>

        <div className="card">
          <h2 className="section-title">World tags</h2>
          <p className="muted">
            {worldTagsQuery.isLoading ? "Loading tags..." : `${worldTags.length} tags available.`}
          </p>
          <div className="button-stack">
            {worldTags.map((tag) => (
              <span key={tag} className="pill">
                {tag}
              </span>
            ))}
            {!worldTags.length && !worldTagsQuery.isLoading && (
              <span className="muted">No tags found.</span>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Add room to admin database</h2>
        <div className="grid-two">
          <label className="field">
            <span>Room URL</span>
            <input
              className="input"
              placeholder="/@/darna/conference"
              value={createRoomUrl}
              onChange={(event) => setCreateRoomUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>WAM URL</span>
            <input
              className="input"
              placeholder="https://darna.lightency.io/map-storage/darna/conference.wam"
              value={createWamUrl}
              onChange={(event) => setCreateWamUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Room name (optional)</span>
            <input
              className="input"
              placeholder="Conference"
              value={createRoomName}
              onChange={(event) => setCreateRoomName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>World slug</span>
            <input
              className="input"
              placeholder="darna"
              value={createWorldSlug}
              onChange={(event) => setCreateWorldSlug(event.target.value)}
            />
          </label>
          <label className="field">
            <span>World name</span>
            <input
              className="input"
              placeholder="Darna"
              value={createWorldName}
              onChange={(event) => setCreateWorldName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>World domain</span>
            <input
              className="input"
              placeholder="darna.lightency.io"
              value={createWorldDomain}
              onChange={(event) => setCreateWorldDomain(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Tags (comma-separated)</span>
            <input
              className="input"
              placeholder="viewer,staff"
              value={createTags}
              onChange={(event) => setCreateTags(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Active</span>
            <input
              type="checkbox"
              checked={createIsActive}
              onChange={(event) => setCreateIsActive(event.target.checked)}
            />
          </label>
        </div>
        {createError && <p className="muted">{createError}</p>}
        <div className="button-stack">
          <button className="button solid" type="button" onClick={handleCreateRoom} disabled={isCreating}>
            {isCreating ? "Saving..." : "Add room"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="section-title">Rooms in world</h2>
          <div className="button-stack">
            <button
              className={`button ${roomFilter === "all" ? "solid" : "ghost"}`}
              type="button"
              onClick={() => setRoomFilter("all")}
            >
              All
            </button>
            <button
              className={`button ${roomFilter === "active" ? "solid" : "ghost"}`}
              type="button"
              onClick={() => setRoomFilter("active")}
            >
              Active
            </button>
            <button
              className={`button ${roomFilter === "inactive" ? "solid" : "ghost"}`}
              type="button"
              onClick={() => setRoomFilter("inactive")}
            >
              Inactive
            </button>
          </div>
        </div>

        {actionError && <p className="muted">{actionError}</p>}
        {actionInfo && <p className="muted">{actionInfo}</p>}

        <table className="table table-wrap">
          <thead>
            <tr>
              <th>Room</th>
              <th>Room URL</th>
              <th>Map</th>
              <th>Active</th>
              <th>Default</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {filteredRooms.map((room) => (
              <tr key={room.id}>
                <td>{room.name ?? "--"}</td>
                <td>{room.roomUrl}</td>
                <td>{room.wamUrl ? "WAM" : "--"}</td>
                <td>
                  <button
                    className={`toggle-switch ${room.isActive ? "on" : "off"}`}
                    type="button"
                    role="switch"
                    aria-checked={room.isActive}
                    aria-label={`${room.roomUrl} active state`}
                    disabled={isApplyingAction}
                    onClick={() => {
                      if (room.isActive) {
                        void handleDeactivate(room);
                        return;
                      }
                      void applyRoomState(room, true);
                    }}
                  >
                    <span className="toggle-switch-handle" />
                  </button>
                </td>
                <td>
                  <button
                    className={`toggle-switch ${room.isDefault ? "on" : "off"}`}
                    type="button"
                    role="switch"
                    aria-checked={room.isDefault}
                    aria-label={`${room.roomUrl} default room`}
                    disabled={isApplyingAction || room.isDefault || !room.isActive}
                    onClick={() => {
                      void handleSetDefault(room);
                    }}
                  >
                    <span className="toggle-switch-handle" />
                  </button>
                </td>
                <td>{room.tags?.length ? room.tags.join(", ") : "--"}</td>
              </tr>
            ))}
            {!filteredRooms.length && !roomsQuery.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  No rooms found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deactivationDraft && (
        <div className="modal-backdrop" onClick={handleCancelDeactivation}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">
              {deactivationDraft.isDefault ? "Deactivate default room" : "Deactivate room"}
            </h3>
            <p className="muted">
              {deactivationDraft.isDefault
                ? `${deactivationDraft.roomUrl} is the current default room. Select an active replacement before deactivation.`
                : `Deactivate ${deactivationDraft.roomUrl}? Users will lose access immediately.`}
            </p>
            {deactivationDraft.isDefault && (
              <label className="field">
                <span>Replacement default room</span>
                <select
                  className="input"
                  value={replacementDefaultRoomId}
                  onChange={(event) => setReplacementDefaultRoomId(event.target.value)}
                >
                  <option value="">Select a replacement</option>
                  {activeRooms
                    .filter((room) => room.id !== deactivationDraft.id)
                    .map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.roomUrl}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={handleCancelDeactivation}>
                Cancel
              </button>
              <button
                className="button solid"
                type="button"
                disabled={isApplyingAction || (deactivationDraft.isDefault && !replacementDefaultRoomId)}
                onClick={() => {
                  void handleConfirmDeactivation();
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
