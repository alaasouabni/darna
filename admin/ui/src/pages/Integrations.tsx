import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";

type LivekitCredentials = {
  livekitHost: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
};

type IceServer = {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: string;
};

function maskValue(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function IntegrationsPage() {
  const { context, updateContext } = useAdminContext();

  const livekitQuery = useQuery({
    queryKey: ["livekit", context.playUri],
    enabled: Boolean(context.playUri),
    queryFn: () =>
      apiRequest<LivekitCredentials>(
        buildQuery("/livekit/credentials", { playUri: context.playUri })
      ),
  });

  const iceQuery = useQuery({
    queryKey: ["ice", context.roomUrl, context.userIdentifier],
    enabled: Boolean(context.roomUrl && context.userIdentifier),
    queryFn: () =>
      apiRequest<IceServer[]>(
        buildQuery("/ice-servers", {
          roomUrl: context.roomUrl,
          userIdentifier: context.userIdentifier,
        })
      ),
  });

  const livekit = livekitQuery.data;
  const iceServers = iceQuery.data ?? [];

  const handleSyncStatus = () => {
    livekitQuery.refetch();
    iceQuery.refetch();
  };

  return (
    <section className="page">
      <PageHeader
        title="Integrations"
        subtitle="Livekit, TURN, and external services."
        actions={
          <button className="button ghost" type="button" onClick={handleSyncStatus}>
            Sync status
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
          <label className="field">
            <span>User identifier</span>
            <input
              className="input"
              placeholder="admin@example.com"
              value={context.userIdentifier}
              onChange={(event) => updateContext({ userIdentifier: event.target.value })}
            />
          </label>
        </div>

        <div className="card">
          <h2 className="section-title">Livekit</h2>
          <p className="muted">
            {livekitQuery.isLoading
              ? "Loading Livekit..."
              : livekit?.livekitHost
              ? `Host: ${livekit.livekitHost}`
              : "Livekit not configured."}
          </p>
          <div className="pill">
            {livekit?.livekitHost ? "Configured" : "Missing"}
          </div>
          {livekitQuery.isError && (
            <p className="muted">Unable to load Livekit credentials.</p>
          )}
          <div className="list">
            <div>API key: {maskValue(livekit?.livekitApiKey)}</div>
            <div>API secret: {maskValue(livekit?.livekitApiSecret)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">ICE / TURN servers</h2>
        <p className="muted">
          {iceQuery.isLoading
            ? "Loading ICE servers..."
            : `${iceServers.length} server entries resolved.`}
        </p>
        {iceQuery.isError && (
          <p className="muted">Unable to load ICE servers. Check the room URL.</p>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>URLs</th>
              <th>Username</th>
              <th>Credential</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {iceServers.map((server, index) => (
              <tr key={`${server.urls.join(",")}-${index}`}>
                <td>{server.urls.join(", ")}</td>
                <td>{server.username ?? "—"}</td>
                <td>{maskValue(server.credential)}</td>
                <td>{server.credentialType ?? "—"}</td>
              </tr>
            ))}
            {!iceServers.length && !iceQuery.isLoading && (
              <tr>
                <td colSpan={4} className="muted">
                  No ICE servers returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
