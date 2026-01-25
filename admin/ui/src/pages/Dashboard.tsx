import { useState } from "react";
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
          label="Active users (60m)"
          value={activeMembersQuery.isLoading ? "—" : String(activeCount)}
          trend="Last hour"
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
