import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { copyText } from "../clipboard";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";

type ActiveMembersResponse = {
  total: number;
};

type ReportsResponse = {
  total: number;
};

export function DashboardPage() {
  const { context, updateContext } = useAdminContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [inviteCopied, setInviteCopied] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const liveUsersRef = useRef<Set<string>>(new Set());

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

  const activeMembersQuery = useQuery({
    queryKey: ["members", "active", "summary"],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(
        buildQuery("/members/active", { minutes: 60, limit: 1 })
      ),
  });

  const directoryQuery = useQuery({
    queryKey: ["keycloak", "users", "summary"],
    queryFn: () =>
      apiRequest<{ total: number }>(
        buildQuery("/keycloak/users", { first: 0, max: 1 })
      ),
  });

  const roomsQuery = useQuery({
    queryKey: ["rooms", "summary", context.roomUrl],
    enabled: Boolean(context.roomUrl),
    queryFn: () =>
      apiRequest<unknown[]>(
        buildQuery("/room/sameWorld", {
          roomUrl: context.roomUrl,
          bypassTagFilter: 1,
        })
      ),
  });

  const reportsQuery = useQuery({
    queryKey: ["reports", "summary", context.worldSlug],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "open",
          worldSlug: context.worldSlug || undefined,
          take: 1,
          skip: 0,
        })
      ),
  });

  const livekitQuery = useQuery({
    queryKey: ["livekit", "summary", context.playUri],
    enabled: Boolean(context.playUri),
    queryFn: () =>
      apiRequest<{ livekitHost: string | null }>(
        buildQuery("/livekit/credentials", { playUri: context.playUri })
      ),
  });

  const activeCount = activeMembersQuery.data?.total ?? 0;
  const directoryCount = directoryQuery.data?.total ?? 0;
  const roomsCount = roomsQuery.data?.length ?? 0;
  const reportsCount = reportsQuery.data?.total ?? 0;
  const livekitStatus = livekitQuery.data?.livekitHost ? "Connected" : "Missing";
  const inviteLabel = inviteCopied ? "Invite copied" : "Generate invite";

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
            const type = payload.type;
            if (!payload.data?.uuid) {
              return;
            }
            const userId = payload.data.uuid;
            if (type === "MemberJoin") {
              liveUsersRef.current.add(userId);
              setLiveCount(liveUsersRef.current.size);
            } else if (type === "MemberLeave") {
              liveUsersRef.current.delete(userId);
              setLiveCount(liveUsersRef.current.size);
            }
          } catch {
            // Ignore malformed admin socket payloads.
          }
        };

        socket.onerror = () => {
          if (!mounted) {
            return;
          }
          setLiveStatus("error");
        };

        socket.onclose = () => {
          if (!mounted) {
            return;
          }
          setLiveStatus("idle");
        };
      } catch {
        if (!mounted) {
          return;
        }
        setLiveStatus("error");
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
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["keycloak"] });
    queryClient.invalidateQueries({ queryKey: ["rooms"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    queryClient.invalidateQueries({ queryKey: ["livekit"] });
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
        subtitle="Live rooms, active members, and system status."
        actions={
          <button className="button ghost" type="button" onClick={handleRefresh}>
            Refresh
          </button>
        }
      />

      <div className="card">
        <h2 className="section-title">Context</h2>
        <div className="grid-two">
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
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          label="Rooms in world"
          value={roomsQuery.isLoading ? "—" : String(roomsCount)}
          trend={context.roomUrl ? "Based on room URL" : "Set a room URL"}
        />
        <StatCard
          label="Live users"
          value={
            liveStatus === "live"
              ? String(liveCount ?? 0)
              : context.roomUrl || context.playUri
              ? "—"
              : "—"
          }
          trend={
            liveStatus === "live"
              ? "Live via admin socket"
              : context.roomUrl || context.playUri
              ? "Connecting…"
              : "Set a play or room URL"
          }
          status={liveStatus === "live" ? "Live" : "Offline"}
          statusTone={liveStatus === "live" ? "live" : "muted"}
        />
        <StatCard
          label="Open reports"
          value={reportsQuery.isLoading ? "—" : String(reportsCount)}
          trend={context.worldSlug ? `World: ${context.worldSlug}` : "All worlds"}
        />
        <StatCard
          label="Livekit"
          value={livekitQuery.isLoading ? "—" : livekitStatus}
          trend={context.playUri ? "Configured per world" : "Set play URL"}
        />
      </div>

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">Live activity</h2>
          <ul className="list">
            <li>{directoryQuery.isLoading ? "Loading directory..." : `${directoryCount} users in Keycloak.`}</li>
            <li>
              {liveStatus === "live"
                ? `${liveCount ?? 0} live right now.`
                : "Live users unavailable. Set a play or room URL."}
            </li>
            <li>{activeMembersQuery.isLoading ? "Loading members..." : `${activeCount} active in last hour.`}</li>
            <li>{reportsQuery.isLoading ? "Loading reports..." : `${reportsCount} open reports.`}</li>
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
