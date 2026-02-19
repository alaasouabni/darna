import { useMemo } from "react";
import { useContextOptionsQuery } from "../api/context";
import { inferWorldSlug } from "../config";
import { useAdminContext } from "../context";

type ContextFieldsProps = {
  showWorld?: boolean;
  showRoom?: boolean;
  showPlayUri?: boolean;
  showUserIdentifier?: boolean;
  allowEmptyWorld?: boolean;
  includeInactiveRooms?: boolean;
};

function buildPlayUriFromRoom(
  roomUrl: string,
  worldDomain: string | null,
  currentPlayUri: string
) {
  const normalizedRoomUrl = roomUrl.startsWith("/") ? roomUrl : `/${roomUrl}`;
  let baseProtocol = "https:";
  let baseHost = "";

  try {
    if (currentPlayUri) {
      const parsed = new URL(currentPlayUri);
      baseProtocol = parsed.protocol;
      baseHost = parsed.host;
    }
  } catch {
    // Keep fallback protocol/host.
  }

  if (!baseHost && typeof window !== "undefined") {
    baseProtocol = window.location.protocol;
    baseHost = window.location.host;
  }

  const nextHost = worldDomain || baseHost;
  if (!nextHost) {
    return currentPlayUri;
  }

  return `${baseProtocol}//${nextHost}${normalizedRoomUrl}`;
}

export function ContextFields({
  showWorld = true,
  showRoom = true,
  showPlayUri = true,
  showUserIdentifier = false,
  allowEmptyWorld = false,
  includeInactiveRooms = true,
}: ContextFieldsProps) {
  const { context, updateContext } = useAdminContext();
  const optionsQuery = useContextOptionsQuery(includeInactiveRooms);
  const worlds = optionsQuery.data?.worlds ?? [];
  const rooms = optionsQuery.data?.rooms ?? [];
  const inferredWorldSlug = inferWorldSlug(context.roomUrl);
  const selectedWorldSlug = context.worldSlug || (allowEmptyWorld ? "" : inferredWorldSlug);

  const availableRooms = useMemo(() => {
    if (!selectedWorldSlug) {
      return rooms;
    }
    return rooms.filter((room) => room.worldSlug === selectedWorldSlug);
  }, [rooms, selectedWorldSlug]);

  const currentRoom = rooms.find((room) => room.roomUrl === context.roomUrl);
  const hasWorldOptions = worlds.length > 0;
  const hasRoomOptions = rooms.length > 0;
  const selectedWorldExists = worlds.some((world) => world.slug === selectedWorldSlug);
  const selectedRoomExists = availableRooms.some((room) => room.roomUrl === context.roomUrl);

  const handleWorldSelection = (value: string) => {
    if (!value) {
      updateContext({ worldSlug: "" });
      return;
    }

    const currentRoomInWorld =
      context.roomUrl &&
      rooms.find((room) => room.roomUrl === context.roomUrl && room.worldSlug === value);
    if (currentRoomInWorld) {
      updateContext({ worldSlug: value });
      return;
    }

    const defaultRoom =
      rooms.find((room) => room.worldSlug === value && room.isDefault) ??
      rooms.find((room) => room.worldSlug === value);

    if (!defaultRoom) {
      updateContext({ worldSlug: value });
      return;
    }

    updateContext({
      worldSlug: value,
      roomUrl: defaultRoom.roomUrl,
      playUri: buildPlayUriFromRoom(defaultRoom.roomUrl, defaultRoom.worldDomain, context.playUri),
    });
  };

  const handleRoomSelection = (value: string) => {
    if (!value) {
      updateContext({ roomUrl: "" });
      return;
    }

    const selectedRoom = rooms.find((room) => room.roomUrl === value);
    if (!selectedRoom) {
      updateContext({ roomUrl: value });
      return;
    }

    updateContext({
      roomUrl: selectedRoom.roomUrl,
      worldSlug: selectedRoom.worldSlug,
      playUri: buildPlayUriFromRoom(selectedRoom.roomUrl, selectedRoom.worldDomain, context.playUri),
    });
  };

  return (
    <>
      {(showWorld || showRoom) && optionsQuery.isLoading && <p className="muted">Loading context options...</p>}
      {(showWorld || showRoom) && optionsQuery.isError && (
        <p className="muted">Unable to load saved worlds/rooms. Manual input is still available.</p>
      )}

      {showWorld && (
        <label className="field">
          <span>World</span>
          {hasWorldOptions ? (
            <select
              className="input"
              value={selectedWorldSlug}
              onChange={(event) => handleWorldSelection(event.target.value)}
            >
              <option value="">{allowEmptyWorld ? "All worlds" : "Select world"}</option>
              {!selectedWorldExists && selectedWorldSlug && (
                <option value={selectedWorldSlug}>{selectedWorldSlug} (custom)</option>
              )}
              {worlds.map((world) => (
                <option key={world.id} value={world.slug}>
                  {world.name} ({world.slug})
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              placeholder="darna"
              value={context.worldSlug}
              onChange={(event) => updateContext({ worldSlug: event.target.value })}
            />
          )}
        </label>
      )}

      {showRoom && (
        <label className="field">
          <span>Room</span>
          {hasRoomOptions ? (
            <select
              className="input"
              value={context.roomUrl}
              onChange={(event) => handleRoomSelection(event.target.value)}
            >
              <option value="">Select room</option>
              {!selectedRoomExists && context.roomUrl && (
                <option value={context.roomUrl}>{context.roomUrl} (custom)</option>
              )}
              {availableRooms.map((room) => (
                <option key={room.id} value={room.roomUrl}>
                  {selectedWorldSlug ? room.roomUrl : `${room.worldSlug} - ${room.roomUrl}`}
                  {room.isDefault ? " (default)" : ""}
                  {!room.isActive ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              placeholder="/@/darna/office"
              value={context.roomUrl}
              onChange={(event) => updateContext({ roomUrl: event.target.value })}
            />
          )}
        </label>
      )}

      {showPlayUri && (
        <label className="field">
          <span>Play URL</span>
          <input
            className="input"
            placeholder={
              currentRoom
                ? buildPlayUriFromRoom(currentRoom.roomUrl, currentRoom.worldDomain, context.playUri)
                : "https://darna.lightency.io/@/darna/office"
            }
            value={context.playUri}
            onChange={(event) => updateContext({ playUri: event.target.value })}
          />
        </label>
      )}

      {showUserIdentifier && (
        <label className="field">
          <span>User identifier</span>
          <input
            className="input"
            placeholder="admin@example.com"
            value={context.userIdentifier}
            onChange={(event) => updateContext({ userIdentifier: event.target.value })}
          />
        </label>
      )}
    </>
  );
}
