import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { ContextFields } from "../components/ContextFields";
import { EyeIcon } from "../components/icons";

type ReportItem = {
  id: string;
  worldSlug: string;
  status: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  reportedMember: { id: string; email: string | null };
  reporterMember: { id: string; email: string | null };
};

type ReportsResponse = {
  total: number;
  reports: ReportItem[];
};

export function ResolvedReportsPage() {
  const { context } = useAdminContext();
  const [reportDetails, setReportDetails] = useState<ReportItem | null>(null);

  const formatStatusLabel = (status: string) =>
    status ? `${status.charAt(0).toUpperCase()}${status.slice(1).toLowerCase()}` : "Unknown";

  const resolvedReportsQuery = useQuery({
    queryKey: ["reports", "resolved", context.worldSlug, "all"],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "banned,rejected",
          worldSlug: context.worldSlug || undefined,
          take: 100,
          skip: 0,
        })
      ),
  });

  const resolvedReports = resolvedReportsQuery.data?.reports ?? [];

  return (
    <section className="page">
      <PageHeader
        title="Resolved reports"
        subtitle="Review the most recent closed reports."
        actions={
          <a className="button ghost" href="/moderation">
            Back to moderation
          </a>
        }
      />

      <div className="card">
        <h2 className="section-title">Context</h2>
        <ContextFields showWorld allowEmptyWorld />
      </div>

      <div className="card">
        <h2 className="section-title">Resolved queue</h2>
        <p className="muted">
          {resolvedReportsQuery.isLoading
            ? "Loading resolved reports..."
            : `Showing ${resolvedReports.length} of ${resolvedReportsQuery.data?.total ?? 0} resolved reports.`}
        </p>
        {resolvedReportsQuery.isError && <p className="muted">Unable to load resolved reports.</p>}
        <table className="table table-wrap">
          <thead>
            <tr>
              <th>Reported</th>
              <th>Reporter</th>
              <th>World</th>
              <th>Status</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {resolvedReports.map((report) => {
              const statusKey = report.status?.toLowerCase() ?? "unknown";
              const statusLabel = formatStatusLabel(report.status);
              return (
                <tr key={report.id}>
                  <td>{report.reportedMember.email ?? report.reportedMember.id}</td>
                  <td>{report.reporterMember.email ?? report.reporterMember.id}</td>
                  <td>{report.worldSlug}</td>
                  <td>
                    <span className={`status-badge ${statusKey}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td>{new Date(report.updatedAt).toLocaleString()}</td>
                  <td>
                    <button
                      className="button ghost icon-button"
                      type="button"
                      onClick={() => setReportDetails(report)}
                      title="View report"
                      aria-label="View report"
                    >
                      <EyeIcon aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!resolvedReports.length && !resolvedReportsQuery.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  No resolved reports.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {reportDetails && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Report details</h3>
            <p className="muted">
              Reported: <strong>{reportDetails.reportedMember.email ?? reportDetails.reportedMember.id}</strong>
            </p>
            <p className="muted">
              Reporter: <strong>{reportDetails.reporterMember.email ?? reportDetails.reporterMember.id}</strong>
            </p>
            <p className="muted">World: {reportDetails.worldSlug}</p>
            <p className="muted">Status: {reportDetails.status}</p>
            <p className="muted">Created: {new Date(reportDetails.createdAt).toLocaleString()}</p>
            <p className="muted">Updated: {new Date(reportDetails.updatedAt).toLocaleString()}</p>
            <label className="field">
              <span>Comment</span>
              <textarea className="input textarea" readOnly rows={6} value={reportDetails.comment} />
            </label>
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={() => setReportDetails(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
