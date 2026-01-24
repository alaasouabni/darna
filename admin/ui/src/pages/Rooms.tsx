import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";

type RoomSummary = {
  name?: string;
  roomUrl: string;
  wamUrl?: string;
};

export function RoomsPage() {
  const { context, updateContext } = useAdminContext();
  const [selectedRoomUrl, setSelectedRoomUrl] = useState("");

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

  return (
    <section className="page">
      <PageHeader
        title="Rooms & maps"
        subtitle="Manage access, tags, and map sources across worlds."
        actions={<button className="button solid">New room</button>}
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
