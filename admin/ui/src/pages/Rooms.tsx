import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { inferWorldDomain, inferWorldSlug } from "../config";

type RoomSummary = {
  name?: string;
  roomUrl: string;
  wamUrl?: string;
};

export function RoomsPage() {
  const { context, updateContext } = useAdminContext();
  const [selectedRoomUrl, setSelectedRoomUrl] = useState("");
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

  const roomsQuery = useQuery({
    queryKey: ["rooms", context.roomUrl],
    enabled: Boolean(context.roomUrl),
    queryFn: () =>
      apiRequest<RoomSummary[]>(
        buildQuery("/room/sameWorld", {
          roomUrl: context.roomUrl,
          bypassTagFilter: 1,
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

  useEffect(() => {
    if (!selectedRoomUrl && roomsQuery.data?.length) {
      setSelectedRoomUrl(roomsQuery.data[0].roomUrl);
    }
  }, [roomsQuery.data, selectedRoomUrl]);

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

  const roomTagsQuery = useQuery({
    queryKey: ["room-tags", selectedRoomUrl],
    enabled: Boolean(selectedRoomUrl),
    queryFn: () =>
      apiRequest<string[]>(
        buildQuery("/room/tags", {
          roomUrl: selectedRoomUrl,
        })
      ),
  });

  const rooms = roomsQuery.data ?? [];
  const worldTags = worldTagsQuery.data ?? [];
  const roomTags = roomTagsQuery.data ?? [];

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
      setSelectedRoomUrl(createRoomUrl);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to create the room.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        title="Rooms & maps"
        subtitle="Manage access, tags, and map sources across worlds."
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
          {roomsQuery.isError && (
            <p className="muted">Unable to load rooms. Check the room URL.</p>
          )}
        </div>

        <div className="card">
          <h2 className="section-title">World tags</h2>
          <p className="muted">
            {worldTagsQuery.isLoading
              ? "Loading tags..."
              : `${worldTags.length} tags available.`}
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
              placeholder="/~/darna/conference"
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
        <h2 className="section-title">Rooms in world</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Room URL</th>
              <th>Map</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr
                key={room.roomUrl}
                onClick={() => setSelectedRoomUrl(room.roomUrl)}
                style={{ cursor: "pointer" }}
              >
                <td>{room.name ?? "—"}</td>
                <td>{room.roomUrl}</td>
                <td>{room.wamUrl ? "WAM" : "—"}</td>
                <td>
                  {selectedRoomUrl === room.roomUrl
                    ? roomTags.join(", ") || "—"
                    : "Click to load"}
                </td>
              </tr>
            ))}
            {!rooms.length && !roomsQuery.isLoading && (
              <tr>
                <td colSpan={4} className="muted">
                  No rooms found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {roomTagsQuery.isError && (
          <p className="muted">Unable to load tags for the selected room.</p>
        )}
      </div>
    </section>
  );
}
