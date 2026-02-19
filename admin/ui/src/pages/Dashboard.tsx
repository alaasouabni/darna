import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useContextOptionsQuery } from "../api/context";
import { buildQuery } from "../api/query";
import { copyText } from "../clipboard";
import { ContextFields } from "../components/ContextFields";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { inferWorldSlug } from "../config";
import { useAdminContext } from "../context";

type ActiveMembersResponse = {
  total: number;
};

type ReportsResponse = {
  total: number;
};

type BansResponse = {
  total: number;
};

type LiveUsersStatsResponse = {
  available: boolean;
  reason: string | null;
  totalConnectedUsers: number;
  knownRoomsConnectedUsers: number;
  roomsWithUsers: number;
  trackedRooms: number;
  domainsChecked: number;
  domainsFailed: number;
};

export function DashboardPage() {
  const { context } = useAdminContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [inviteCopied, setInviteCopied] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const liveUsersRef = useRef<Set<string>>(new Set());

  const selectedWorldSlug = context.worldSlug || inferWorldSlug(context.roomUrl);
  const contextOptionsQuery = useContextOptionsQuery(true);
  const rooms = contextOptionsQuery.data?.rooms ?? [];
  const roomsInSelectedWorld = selectedWorldSlug
    ? rooms.filter((room) => room.worldSlug === selectedWorldSlug).length
    : 0;

  const resolvedRoomId = useMemo(() => {
    const playTarget = context.roomUrl || context.playUri;
    if (!playTarget) {
      return "";
    }

    if (context.playUri) {
      try {
        const playHost = new URL(context.playUri).host;
        const targetUrl = new URL(playTarget, context.playUri);
        if (targetUrl.host === window.location.host && playHost !== window.location.host) {
          const suffix = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
          return new URL(suffix, context.playUri).toString();
        }
        return targetUrl.toString();
      } catch {
        return "";
      }
    }

    try {
      return new URL(playTarget).toString();
    } catch {
      return "";
    }
  }, [context.playUri, context.roomUrl]);

  const adminSocketUrl = useMemo(() => {
    if (!resolvedRoomId) {
      return "";
    }
    try {
      const url = new URL(resolvedRoomId);
      const protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${url.host}/ws/admin/rooms`;
    } catch {
      return "";
    }
  }, [resolvedRoomId]);

  const connectedMembersQuery = useQuery({
    queryKey: ["members", "active", "connected-now"],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(buildQuery("/members/active", { minutes: 5, limit: 1 })),
  });

  const liveUsersTotalQuery = useQuery({
    queryKey: ["stats", "live-users"],
    queryFn: () =>
      apiRequest<LiveUsersStatsResponse>(buildQuery("/stats/live-users", { includeInactive: 1 })),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  const activeMembersHourQuery = useQuery({
    queryKey: ["members", "active", "last-hour"],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(buildQuery("/members/active", { minutes: 60, limit: 1 })),
  });

  const directoryQuery = useQuery({
    queryKey: ["keycloak", "users", "summary"],
    queryFn: () => apiRequest<{ total: number }>(buildQuery("/keycloak/users", { first: 0, max: 1 })),
  });

  const globalReportsQuery = useQuery({
    queryKey: ["reports", "summary", "global"],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "open",
          take: 1,
          skip: 0,
        })
      ),
  });

  const contextReportsQuery = useQuery({
    queryKey: ["reports", "summary", selectedWorldSlug],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "open",
          worldSlug: selectedWorldSlug || undefined,
          take: 1,
          skip: 0,
        })
      ),
  });

  const globalBansQuery = useQuery({
    queryKey: ["bans", "summary", "global"],
    queryFn: () =>
      apiRequest<BansResponse>(
        buildQuery("/bans", {
          activeOnly: 1,
          take: 1,
          skip: 0,
        })
      ),
  });

  const contextBansQuery = useQuery({
    queryKey: ["bans", "summary", selectedWorldSlug],
    queryFn: () =>
      apiRequest<BansResponse>(
        buildQuery("/bans", {
          worldSlug: selectedWorldSlug || undefined,
          activeOnly: 1,
          take: 1,
          skip: 0,
        })
      ),
  });

  const livekitQuery = useQuery({
    queryKey: ["livekit", "summary", context.playUri],
    enabled: Boolean(context.playUri),
    queryFn: () =>
      apiRequest<{ livekitHost: string | null }>(buildQuery("/livekit/credentials", { playUri: context.playUri })),
  });

  const connectedUsersTotal = connectedMembersQuery.data?.total ?? 0;
  const liveUsersTotal = liveUsersTotalQuery.data?.totalConnectedUsers ?? 0;
  const liveUsersKnownRooms = liveUsersTotalQuery.data?.knownRoomsConnectedUsers ?? 0;
  const activeHourTotal = activeMembersHourQuery.data?.total ?? 0;
  const directoryCount = directoryQuery.data?.total ?? 0;
  const globalOpenReports = globalReportsQuery.data?.total ?? 0;
  const globalActiveBans = globalBansQuery.data?.total ?? 0;
  const contextOpenReports = contextReportsQuery.data?.total ?? 0;
  const contextActiveBans = contextBansQuery.data?.total ?? 0;
  const totalWorlds = contextOptionsQuery.data?.summary.totalWorlds ?? 0;
  const totalRooms = contextOptionsQuery.data?.summary.totalRooms ?? 0;
  const activeRooms = contextOptionsQuery.data?.summary.totalActiveRooms ?? 0;
  const livekitStatus = livekitQuery.data?.livekitHost ? "Connected" : "Missing";
  const inviteLabel = inviteCopied ? "Invite copied" : "Generate invite";
  const hasLiveUsersTotal = liveUsersTotalQuery.data?.available ?? false;
  const connectedUsersCardValue = hasLiveUsersTotal
    ? String(liveUsersTotal)
    : connectedMembersQuery.isLoading
    ? "--"
    : String(connectedUsersTotal);
  let connectedUsersCardTrend = "Fallback: active in the last 5 minutes";
  if (hasLiveUsersTotal) {
    connectedUsersCardTrend =
      liveUsersTotalQuery.data?.domainsFailed && liveUsersTotalQuery.data.domainsChecked > 0
        ? `Live now (${liveUsersTotalQuery.data.domainsChecked - liveUsersTotalQuery.data.domainsFailed}/${liveUsersTotalQuery.data.domainsChecked} domains reachable)`
        : `Live now across ${liveUsersTotalQuery.data?.domainsChecked ?? 0} domains`;
  } else if (liveUsersTotalQuery.isLoading) {
    connectedUsersCardTrend = "Loading live totals...";
  } else if (liveUsersTotalQuery.isError) {
    connectedUsersCardTrend = "Live source unavailable, fallback in use";
  }

  useEffect(() => {
    if (!resolvedRoomId || !adminSocketUrl) {
      setLiveCount(null);
      setLiveStatus("idle");
      return;
    }

    let socket: WebSocket | null = null;
    let mounted = true;

    const connect = async () => {
      setLiveStatus("connecting");
      liveUsersRef.current = new Set();
      setLiveCount(0);

      try {
        const tokenResponse = await apiRequest<{ token: string }>(
          buildQuery("/admin-sockets/token", { roomId: resolvedRoomId })
        );

        if (!mounted) {
          return;
        }

        socket = new WebSocket(adminSocketUrl);

        socket.onopen = () => {
          if (!socket) {
            return;
          }
          socket.send(
            JSON.stringify({
              event: "listen",
              roomIds: [resolvedRoomId],
              jwt: tokenResponse.token,
            })
          );
          setLiveStatus("live");
        };

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data as string) as {
              type?: string;
              data?: { uuid?: string; roomId?: string };
            };
            if (!payload.data?.uuid) {
              return;
            }
            if (payload.type === "MemberJoin") {
              liveUsersRef.current.add(payload.data.uuid);
              setLiveCount(liveUsersRef.current.size);
            } else if (payload.type === "MemberLeave") {
              liveUsersRef.current.delete(payload.data.uuid);
              setLiveCount(liveUsersRef.current.size);
            }
          } catch {
            // Ignore malformed payloads.
          }
        };

        socket.onerror = () => {
          if (mounted) {
            setLiveStatus("error");
          }
        };

        socket.onclose = () => {
          if (mounted) {
            setLiveStatus("idle");
          }
        };
      } catch {
        if (mounted) {
          setLiveStatus("error");
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [adminSocketUrl, resolvedRoomId]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["context", "options"] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["keycloak"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["bans"] });
    queryClient.invalidateQueries({ queryKey: ["livekit"] });
    queryClient.invalidateQueries({ queryKey: ["stats", "live-users"] });
  };

  const handleBroadcast = () => {
    window.alert("Broadcast from the admin console is not wired yet.");
  };

  const handleOpenReports = () => {
    navigate("/moderation");
  };

  const handleGenerateInvite = async () => {
    if (!context.playUri) {
      window.alert("Set a Play URL in the context card first.");
      return;
    }
    const copied = await copyText(context.playUri);
    if (!copied) {
      window.prompt("Copy invite link", context.playUri);
      return;
    }
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <section className="page">
      <PageHeader
        title="Operational overview"
        subtitle="Global metrics and context-specific room activity."
        actions={
          <button className="button ghost" type="button" onClick={handleRefresh}>
            Refresh
          </button>
        }
      />

      <div className="card">
        <h2 className="section-title">Context</h2>
        <div className="grid-two">
          <ContextFields showWorld showRoom showPlayUri includeInactiveRooms />
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Global platform stats</h2>
        <div className="stats-grid">
          <StatCard
            label="Connected users"
            value={connectedUsersCardValue}
            trend={connectedUsersCardTrend}
          />
          <StatCard
            label="Worlds"
            value={contextOptionsQuery.isLoading ? "--" : String(totalWorlds)}
            trend="Configured in admin database"
          />
          <StatCard
            label="Rooms"
            value={contextOptionsQuery.isLoading ? "--" : String(totalRooms)}
            trend={contextOptionsQuery.isLoading ? "Loading..." : `${activeRooms} active`}
          />
          <StatCard
            label="Open reports"
            value={globalReportsQuery.isLoading ? "--" : String(globalOpenReports)}
            trend={globalBansQuery.isLoading ? "Loading bans..." : `${globalActiveBans} active bans`}
          />
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Context stats</h2>
        <div className="stats-grid">
          <StatCard
            label="Rooms in world"
            value={selectedWorldSlug ? String(roomsInSelectedWorld) : "--"}
            trend={selectedWorldSlug ? `World: ${selectedWorldSlug}` : "Select a world"}
          />
          <StatCard
            label="Live users in room"
            value={liveStatus === "live" ? String(liveCount ?? 0) : "--"}
            trend={
              liveStatus === "live"
                ? "Live via admin socket"
                : context.roomUrl || context.playUri
                ? "Connecting..."
                : "Select a room"
            }
            status={liveStatus === "live" ? "Live" : "Offline"}
            statusTone={liveStatus === "live" ? "live" : "muted"}
          />
          <StatCard
            label="Open reports in world"
            value={selectedWorldSlug ? String(contextOpenReports) : "--"}
            trend={selectedWorldSlug ? "Filtered by selected world" : "Select a world"}
          />
          <StatCard
            label="Livekit"
            value={livekitQuery.isLoading ? "--" : livekitStatus}
            trend={context.playUri ? "Resolved from selected play URL" : "Select a room/play URL"}
          />
        </div>
      </div>

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">Live activity</h2>
          <ul className="list">
            <li>{directoryQuery.isLoading ? "Loading directory..." : `${directoryCount} users in Keycloak.`}</li>
            <li>
              {hasLiveUsersTotal
                ? `${liveUsersKnownRooms} users currently in configured admin rooms.`
                : "Live total source unavailable, showing fallback activity metric."}
            </li>
            <li>
              {liveStatus === "live"
                ? `${liveCount ?? 0} users currently in selected room.`
                : "Room live stream unavailable. Select a room and wait for socket sync."}
            </li>
            <li>{activeMembersHourQuery.isLoading ? "Loading..." : `${activeHourTotal} active in last hour.`}</li>
            <li>
              {selectedWorldSlug
                ? `${contextActiveBans} active bans in ${selectedWorldSlug}.`
                : "Select a world to display scoped bans."}
            </li>
          </ul>
        </div>
        <div className="card">
          <h2 className="section-title">Quick actions</h2>
          <div className="button-stack">
            <button className="button solid" type="button" onClick={handleBroadcast}>
              Send broadcast
            </button>
            <button className="button ghost" type="button" onClick={handleOpenReports}>
              Open reports
            </button>
            <button className="button ghost" type="button" onClick={handleGenerateInvite}>
              {inviteLabel}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
