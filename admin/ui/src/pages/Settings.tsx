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

export function SettingsPage() {
  const { context } = useAdminContext();
  const worldSlug = context.worldSlug || inferWorldSlug(context.roomUrl);
  const [pendingDefaultRoomId, setPendingDefaultRoomId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    queryFn: () => apiRequest<DefaultRoomResponse>(`/world/${encodeURIComponent(worldSlug)}/default-room`),
  });

  const rooms = roomsQuery.data ?? [];

  const activeRooms = useMemo(() => rooms.filter((room) => room.isActive), [rooms]);

  useEffect(() => {
    const defaultRoomId = defaultRoomQuery.data?.defaultRoom?.id ?? "";
    setPendingDefaultRoomId(defaultRoomId);
  }, [defaultRoomQuery.data?.defaultRoom?.id]);

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
      await apiRequest<{ status: string }>(`/world/${encodeURIComponent(worldSlug)}/default-room`, {
        method: "PUT",
        body: JSON.stringify({ roomId: pendingDefaultRoomId }),
      });
      await Promise.all([roomsQuery.refetch(), defaultRoomQuery.refetch()]);
      setFeedback(`Default room updated to ${selectedRoom.roomUrl}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save default room.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        title="Settings"
        subtitle="World defaults and routing controls."
        actions={
          <button className="button solid" type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </button>
        }
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">World defaults</h2>
          <label className="field">
            <span>World slug</span>
            <input className="input" value={worldSlug} readOnly placeholder="darna" />
          </label>

          <label className="field">
            <span>Current default room</span>
            <input
              className="input"
              value={defaultRoomQuery.data?.defaultRoom?.roomUrl ?? "No default configured"}
              readOnly
            />
          </label>

          <label className="field">
            <span>Set default room</span>
            <select
              className="input"
              value={pendingDefaultRoomId}
              onChange={(event) => setPendingDefaultRoomId(event.target.value)}
              disabled={!worldSlug || defaultRoomQuery.isLoading || roomsQuery.isLoading}
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

          {roomsQuery.isError && <p className="muted">Unable to load world rooms.</p>}
          {defaultRoomQuery.isError && <p className="muted">Unable to load current default room.</p>}
          {!worldSlug && <p className="muted">Set a room URL or world slug in context first.</p>}
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
            <li>Room lifecycle (activate/deactivate) is managed in the Rooms page.</li>
            <li>Use reverse-proxy canonicalization to avoid /~/ and /@ split instances.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
