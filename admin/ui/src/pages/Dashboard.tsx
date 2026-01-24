import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
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

  return (
    <section className="page">
      <PageHeader
        title="Operational overview"
        subtitle="Live rooms, active members, and system status."
        actions={<button className="button ghost">Refresh</button>}
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
            <button className="button solid">Send broadcast</button>
            <button className="button ghost">Open reports</button>
            <button className="button ghost">Generate invite</button>
          </div>
        </div>
      </div>
    </section>
  );
}
