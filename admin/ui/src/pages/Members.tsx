import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useContextOptionsQuery } from "../api/context";
import { buildQuery } from "../api/query";
import { copyText } from "../clipboard";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { EyeIcon } from "../components/icons";

type LiveMember = {
  uuid: string;
  name: string | null;
  roomIds: Set<string>;
  ipAddress: string | null;
  lastEventAt: number;
};

type LiveMemberRow = {
  uuid: string;
  name: string | null;
  roomCount: number;
  roomPreview: string;
  ipAddress: string | null;
  lastEventAt: number;
};

type KeycloakUser = {
  id: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean | null;
  createdAt: string | null;
};

type KeycloakUsersResponse = {
  total: number;
  users: KeycloakUser[];
};

type AdminSocketTokenResponse = {
  token: string;
};

type InviteCreateResponse = {
  token: string;
  inviteUrl: string;
  expiresAt: string;
  maxUses: number | null;
  roomUrl: string;
  worldSlug: string;
  worldName: string;
};

type DomainRoomGroup = {
  domain: string;
  roomIds: string[];
};

type LiveConnectionState = {
  totalDomains: number;
  connectedDomains: number;
  failedDomains: number;
};

type AdminSocketEventPayload = {
  type?: "MemberJoin" | "MemberLeave" | "Error";
  data?: {
    uuid?: string;
    name?: string;
    roomId?: string;
    ipAddress?: string;
    message?: string;
  };
};

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "--";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "--";
  }
  const deltaSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (deltaSeconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimestampAgo(timestamp: number) {
  const deltaSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (deltaSeconds < 0) {
    return "just now";
  }
  if (deltaSeconds < 5) {
    return "just now";
  }
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s ago`;
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDisplayName(user: KeycloakUser) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.username || user.email || "--";
}

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) {
    return null;
  }

  const trimmed = domain.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).host;
    }
    return new URL(`https://${trimmed}`).host;
  } catch {
    return null;
  }
}

function buildRoomId(roomUrl: string, domain: string): string {
  const normalizedPath = roomUrl.startsWith("/") ? roomUrl : `/${roomUrl}`;
  return `https://${domain}${normalizedPath}`;
}

function toSocketUrl(domain: string): string {
  const useSecure = !(domain.startsWith("localhost") || domain.startsWith("127.0.0.1"));
  return `${useSecure ? "wss" : "ws"}://${domain}/ws/admin/rooms`;
}

function toRoomLabel(roomId: string): string {
  try {
    const parsed = new URL(roomId);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return roomId;
  }
}

function toLiveMemberRows(source: Map<string, LiveMember>): LiveMemberRow[] {
  return Array.from(source.values())
    .map((member) => {
      const roomIds = Array.from(member.roomIds);
      const firstRoom = roomIds[0] ? toRoomLabel(roomIds[0]) : "--";
      return {
        uuid: member.uuid,
        name: member.name,
        roomCount: roomIds.length,
        roomPreview: roomIds.length <= 1 ? firstRoom : `${firstRoom} (+${roomIds.length - 1})`,
        ipAddress: member.ipAddress,
        lastEventAt: member.lastEventAt,
      };
    })
    .sort((left, right) => right.lastEventAt - left.lastEventAt);
}

export function MembersPage() {
  const { context } = useAdminContext();
  const queryClient = useQueryClient();

  const [connectedSearch, setConnectedSearch] = useState("");
  const [directorySearch, setDirectorySearch] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [liveReloadVersion, setLiveReloadVersion] = useState(0);
  const [liveMembers, setLiveMembers] = useState<LiveMemberRow[]>([]);
  const [liveConnection, setLiveConnection] = useState<LiveConnectionState>({
    totalDomains: 0,
    connectedDomains: 0,
    failedDomains: 0,
  });

  const liveMembersRef = useRef<Map<string, LiveMember>>(new Map());

  const contextOptionsQuery = useContextOptionsQuery(false);

  const directoryQuery = useQuery({
    queryKey: ["keycloak", "users", directorySearch],
    queryFn: () =>
      apiRequest<KeycloakUsersResponse>(
        buildQuery("/keycloak/users", {
          searchText: directorySearch.trim() || undefined,
          first: 0,
          max: 25,
        })
      ),
  });

  const liveRoomGroups = useMemo<DomainRoomGroup[]>(() => {
    const rooms = contextOptionsQuery.data?.rooms ?? [];
    const grouped = new Map<string, Set<string>>();

    for (const room of rooms) {
      if (!room.isActive) {
        continue;
      }
      const domain = normalizeDomain(room.worldDomain);
      if (!domain) {
        continue;
      }
      let roomSet = grouped.get(domain);
      if (!roomSet) {
        roomSet = new Set<string>();
        grouped.set(domain, roomSet);
      }
      roomSet.add(buildRoomId(room.roomUrl, domain));
    }

    return Array.from(grouped.entries())
      .map(([domain, roomIds]) => ({
        domain,
        roomIds: Array.from(roomIds).sort(),
      }))
      .sort((left, right) => left.domain.localeCompare(right.domain));
  }, [contextOptionsQuery.data?.rooms]);

  const liveGroupsKey = useMemo(() => {
    return liveRoomGroups.map((group) => `${group.domain}:${group.roomIds.join(",")}`).join("|");
  }, [liveRoomGroups]);

  useEffect(() => {
    const sockets: WebSocket[] = [];
    let isDisposed = false;

    const resetPresence = () => {
      liveMembersRef.current = new Map();
      setLiveMembers([]);
    };

    const refreshRows = () => {
      setLiveMembers(toLiveMemberRows(liveMembersRef.current));
    };

    const applyJoin = (payload: { uuid: string; name?: string; roomId?: string; ipAddress?: string }) => {
      const current = liveMembersRef.current.get(payload.uuid) ?? {
        uuid: payload.uuid,
        name: null,
        roomIds: new Set<string>(),
        ipAddress: null,
        lastEventAt: Date.now(),
      };

      if (payload.name) {
        current.name = payload.name;
      }
      if (payload.ipAddress) {
        current.ipAddress = payload.ipAddress;
      }

      if (payload.roomId) {
        current.roomIds.add(payload.roomId);
      } else {
        current.roomIds.add("unknown-room");
      }

      current.lastEventAt = Date.now();
      liveMembersRef.current.set(payload.uuid, current);
      refreshRows();
    };

    const applyLeave = (payload: { uuid: string; roomId?: string }) => {
      const current = liveMembersRef.current.get(payload.uuid);
      if (!current) {
        return;
      }

      if (payload.roomId) {
        current.roomIds.delete(payload.roomId);
      } else {
        current.roomIds.clear();
      }

      current.lastEventAt = Date.now();

      if (current.roomIds.size === 0) {
        liveMembersRef.current.delete(payload.uuid);
      } else {
        liveMembersRef.current.set(payload.uuid, current);
      }

      refreshRows();
    };

    const connectAllDomains = async () => {
      if (!liveRoomGroups.length) {
        setLiveConnection({ totalDomains: 0, connectedDomains: 0, failedDomains: 0 });
        resetPresence();
        return;
      }

      resetPresence();
      const totalDomains = liveRoomGroups.length;
      let connectedDomains = 0;
      let failedDomains = 0;

      setLiveConnection({ totalDomains, connectedDomains: 0, failedDomains: 0 });

      await Promise.all(
        liveRoomGroups.map(async (group) => {
          try {
            const tokenResponse = await apiRequest<AdminSocketTokenResponse>("/admin-sockets/token", {
              method: "POST",
              body: JSON.stringify({ roomIds: group.roomIds }),
            });

            if (isDisposed) {
              return;
            }

            const socket = new WebSocket(toSocketUrl(group.domain));
            sockets.push(socket);

            socket.onopen = () => {
              socket.send(
                JSON.stringify({
                  event: "listen",
                  roomIds: group.roomIds,
                  jwt: tokenResponse.token,
                })
              );
              connectedDomains += 1;
              setLiveConnection({ totalDomains, connectedDomains, failedDomains });
            };

            socket.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data as string) as AdminSocketEventPayload;
                if (!message.data?.uuid) {
                  return;
                }

                if (message.type === "MemberJoin") {
                  applyJoin({
                    uuid: message.data.uuid,
                    name: message.data.name,
                    roomId: message.data.roomId,
                    ipAddress: message.data.ipAddress,
                  });
                } else if (message.type === "MemberLeave") {
                  applyLeave({
                    uuid: message.data.uuid,
                    roomId: message.data.roomId,
                  });
                }
              } catch {
                // Ignore malformed messages.
              }
            };

            socket.onerror = () => {
              // Error is reflected by close event in browsers.
            };

            socket.onclose = () => {
              if (isDisposed) {
                return;
              }
              connectedDomains = Math.max(connectedDomains - 1, 0);
              failedDomains += 1;
              setLiveConnection({ totalDomains, connectedDomains, failedDomains });
            };
          } catch {
            failedDomains += 1;
            setLiveConnection({ totalDomains, connectedDomains, failedDomains });
          }
        })
      );
    };

    void connectAllDomains();

    return () => {
      isDisposed = true;
      sockets.forEach((socket) => {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      });
    };
  }, [liveGroupsKey, liveReloadVersion, liveRoomGroups]);

  const filteredLiveMembers = useMemo(() => {
    const searchText = connectedSearch.trim().toLowerCase();
    if (!searchText) {
      return liveMembers;
    }

    return liveMembers.filter((member) => {
      return (
        member.uuid.toLowerCase().includes(searchText) ||
        member.name?.toLowerCase().includes(searchText) ||
        member.roomPreview.toLowerCase().includes(searchText)
      );
    });
  }, [connectedSearch, liveMembers]);

  const connectedPreview = filteredLiveMembers.slice(0, 100);
  const connectedUsersTotal = liveMembers.length;

  const directoryUsers = directoryQuery.data?.users ?? [];
  const directoryTotal = directoryQuery.data?.total ?? 0;
  const directoryPreview = directoryUsers.slice(0, 6);
  const inviteLabel = inviteCopied ? "Invite copied" : "Invite";
  const directoryViewAllUrl = `/members/directory?search=${encodeURIComponent(
    directorySearch.trim()
  )}`;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["context", "options"] });
    queryClient.invalidateQueries({ queryKey: ["keycloak", "users"] });
    setLiveReloadVersion((value) => value + 1);
  };

  const handleInvite = async () => {
    if (!context.playUri) {
      window.alert("Set a Play URL in the context card first.");
      return;
    }
    let inviteUrl = "";
    try {
      const response = await apiRequest<InviteCreateResponse>("/invites", {
        method: "POST",
        body: JSON.stringify({
          playUri: context.playUri,
        }),
      });
      inviteUrl = response.inviteUrl;
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to generate invite.");
      return;
    }

    const copied = await copyText(inviteUrl);
    if (!copied) {
      window.prompt("Copy invite link", inviteUrl);
      return;
    }
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2000);
  };

  const liveTrend =
    liveConnection.totalDomains === 0
      ? "No active room domains configured"
      : `${liveConnection.connectedDomains}/${liveConnection.totalDomains} domains connected`;

  return (
    <section className="page">
      <PageHeader
        title="Members"
        subtitle="Real-time connected users and directory data."
        actions={
          <>
            <button className="button ghost" type="button" onClick={handleRefresh}>
              Refresh
            </button>
            <button className="button solid" type="button" onClick={handleInvite}>
              {inviteLabel}
            </button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Connected users"
          value={contextOptionsQuery.isLoading ? "--" : String(connectedUsersTotal)}
          trend={liveTrend}
          status={liveConnection.failedDomains > 0 ? "Partial" : "Live"}
          statusTone={liveConnection.failedDomains > 0 ? "muted" : "live"}
        />
        <StatCard
          label="Keycloak directory"
          value={directoryQuery.isLoading ? "--" : String(directoryTotal)}
          trend="Users synced from Keycloak"
        />
      </div>

      <div className="grid-two">
        <div className="card">
          <div className="card-header">
            <h2 className="section-title">Connected users</h2>
          </div>
          <label className="field">
            <span>Search connected users</span>
            <input
              className="input"
              placeholder="Search by UUID, name, or room"
              value={connectedSearch}
              onChange={(event) => setConnectedSearch(event.target.value)}
            />
          </label>
          <p className="muted">
            {contextOptionsQuery.isLoading
              ? "Loading room context..."
              : `Showing ${connectedPreview.length} of ${filteredLiveMembers.length} connected users.`}
          </p>
          {filteredLiveMembers.length > connectedPreview.length && (
            <p className="muted">Only the first 100 rows are shown. Use search to narrow results.</p>
          )}
          {liveConnection.failedDomains > 0 && (
            <p className="muted">Some domains failed to stream live users. Counts may be partial.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>UUID</th>
                <th>Room</th>
                <th>Last event</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {connectedPreview.map((member) => (
                <tr key={member.uuid}>
                  <td>{member.name ?? "--"}</td>
                  <td>{member.uuid}</td>
                  <td>{member.roomPreview}</td>
                  <td>{formatTimestampAgo(member.lastEventAt)}</td>
                  <td>
                    <Link
                      className="button ghost icon-button"
                      to={`/members/${encodeURIComponent(member.uuid)}`}
                      title="View member"
                      aria-label="View member"
                    >
                      <EyeIcon aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
              {!connectedPreview.length && !contextOptionsQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No connected users detected.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="section-title">Keycloak directory</h2>
            {directoryTotal > 6 && (
              <Link className="button ghost" to={directoryViewAllUrl}>
                View all
              </Link>
            )}
          </div>
          <label className="field">
            <span>Search Keycloak</span>
            <input
              className="input"
              placeholder="Search by username, email, or name"
              value={directorySearch}
              onChange={(event) => setDirectorySearch(event.target.value)}
            />
          </label>
          <p className="muted">
            {directoryQuery.isLoading
              ? "Loading directory..."
              : `Showing ${directoryPreview.length} of ${directoryQuery.data?.total ?? 0} users.`}
          </p>
          {directoryQuery.isError && (
            <p className="muted">Directory unavailable. Check Keycloak admin access.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Status</th>
                <th>Created</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {directoryPreview.map((user) => (
                <tr key={user.id}>
                  <td>{formatDisplayName(user)}</td>
                  <td>{user.email ?? "--"}</td>
                  <td>
                    <span className={`status-badge ${user.enabled ? "live" : "rejected"}`}>
                      {user.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "--"}</td>
                  <td>
                    {user.email ? (
                      <Link
                        className="button ghost icon-button"
                        to={`/members/${encodeURIComponent(user.email)}`}
                        title="View member"
                        aria-label="View member"
                      >
                        <EyeIcon aria-hidden="true" />
                      </Link>
                    ) : (
                      "--"
                    )}
                  </td>
                </tr>
              ))}
              {!directoryPreview.length && !directoryQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No directory results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
