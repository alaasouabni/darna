import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";

type ReportItem = {
  id: string;
  worldSlug: string;
  status: string;
  comment: string;
  createdAt: string;
  reportedMember: { id: string; email: string | null };
  reporterMember: { id: string; email: string | null };
};

type ReportsResponse = {
  total: number;
  reports: ReportItem[];
};

type BanItem = {
  id: string;
  worldSlug: string;
  targetIdentifier: string;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdBy: { id: string; email: string | null } | null;
};

type BansResponse = {
  total: number;
  bans: BanItem[];
};

export function ModerationPage() {
  const { context, updateContext } = useAdminContext();

  const reportsQuery = useQuery({
    queryKey: ["reports", context.worldSlug],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "open",
          worldSlug: context.worldSlug || undefined,
          take: 20,
          skip: 0,
        })
      ),
  });

  const bansQuery = useQuery({
    queryKey: ["bans", context.worldSlug],
    queryFn: () =>
      apiRequest<BansResponse>(
        buildQuery("/bans", {
          worldSlug: context.worldSlug || undefined,
          activeOnly: true,
          take: 20,
          skip: 0,
        })
      ),
  });

  const reports = reportsQuery.data?.reports ?? [];
  const bans = bansQuery.data?.bans ?? [];

  const handleReviewQueue = () => {
    reportsQuery.refetch();
    bansQuery.refetch();
  };

  return (
    <section className="page">
      <PageHeader
        title="Moderation"
        subtitle="Reports, bans, and safety workflows."
        actions={
          <button className="button solid" type="button" onClick={handleReviewQueue}>
            Review queue
          </button>
        }
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">Context</h2>
          <label className="field">
            <span>World slug</span>
            <input
              className="input"
              placeholder="darna"
              value={context.worldSlug}
              onChange={(event) => updateContext({ worldSlug: event.target.value })}
            />
          </label>
        </div>

        <div className="card">
          <h2 className="section-title">Open reports</h2>
          <p className="muted">
            {reportsQuery.isLoading
              ? "Loading reports..."
              : `Showing ${reports.length} of ${reportsQuery.data?.total ?? 0} open reports.`}
          </p>
          {reportsQuery.isError && (
            <p className="muted">Unable to load reports.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>World</th>
                <th>Reported</th>
                <th>Reporter</th>
                <th>Comment</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.worldSlug}</td>
                  <td>{report.reportedMember.email ?? report.reportedMember.id}</td>
                  <td>{report.reporterMember.email ?? report.reporterMember.id}</td>
                  <td>{report.comment}</td>
                  <td>{new Date(report.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {!reports.length && !reportsQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No open reports.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="section-title">Active bans</h2>
          <p className="muted">
            {bansQuery.isLoading
              ? "Loading bans..."
              : `Showing ${bans.length} of ${bansQuery.data?.total ?? 0} active bans.`}
          </p>
          {bansQuery.isError && (
            <p className="muted">Unable to load bans.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Reason</th>
                <th>Created by</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {bans.map((ban) => (
                <tr key={ban.id}>
                  <td>{ban.targetIdentifier}</td>
                  <td>{ban.reason ?? "—"}</td>
                  <td>{ban.createdBy?.email ?? ban.createdBy?.id ?? "—"}</td>
                  <td>{ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : "Never"}</td>
                </tr>
              ))}
              {!bans.length && !bansQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="muted">
                    No active bans.
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
