import { useMemo, useState } from "react";
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
  updatedAt: string;
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
  const [banDraft, setBanDraft] = useState<ReportItem | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banError, setBanError] = useState<string | null>(null);
  const [banSubmitting, setBanSubmitting] = useState(false);
  const [reportActionError, setReportActionError] = useState<string | null>(null);
  const [reportActionSubmitting, setReportActionSubmitting] = useState(false);
  const [reportDetails, setReportDetails] = useState<ReportItem | null>(null);
  const [banDetails, setBanDetails] = useState<BanItem | null>(null);
  const [banActionError, setBanActionError] = useState<string | null>(null);
  const [banActionSubmitting, setBanActionSubmitting] = useState(false);

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

  const resolvedReportsQuery = useQuery({
    queryKey: ["reports", "resolved", context.worldSlug],
    queryFn: () =>
      apiRequest<ReportsResponse>(
        buildQuery("/reports", {
          status: "banned,rejected",
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
  const resolvedReports = resolvedReportsQuery.data?.reports ?? [];
  const bans = bansQuery.data?.bans ?? [];
  const banPlayTarget = context.roomUrl || context.playUri;
  const bannedTargets = useMemo(() => {
    const set = new Set<string>();
    bans.forEach((ban) => {
      set.add(`${ban.worldSlug}:${ban.targetIdentifier}`);
    });
    return set;
  }, [bans]);

  const handleReviewQueue = () => {
    setBanError(null);
    setReportActionError(null);
    setBanActionError(null);
    reportsQuery.refetch();
    resolvedReportsQuery.refetch();
    bansQuery.refetch();
  };

  const openBanModal = (report: ReportItem) => {
    setBanDraft(report);
    setBanReason(report.comment?.trim() || "Banned via report review.");
    setBanError(null);
  };

  const closeBanModal = () => {
    if (banSubmitting) {
      return;
    }
    setBanDraft(null);
  };

  const openReportDetails = (report: ReportItem) => {
    setReportDetails(report);
    setReportActionError(null);
  };

  const closeReportDetails = () => {
    if (reportActionSubmitting) {
      return;
    }
    setReportDetails(null);
  };

  const openBanDetails = (ban: BanItem) => {
    setBanDetails(ban);
    setBanActionError(null);
  };

  const closeBanDetails = () => {
    if (banActionSubmitting) {
      return;
    }
    setBanDetails(null);
  };

  const resolveRoomId = (playTarget: string) => {
    try {
      return new URL(playTarget, window.location.origin).toString();
    } catch {
      return "";
    }
  };

  const resolveSocketWorldKey = (roomId: string) => {
    const parts = roomId.split("/");
    return parts[5] ?? roomId.split("/").filter(Boolean).at(-1) ?? "";
  };

  const resolveAdminSocketUrl = (roomId: string) => {
    const url = new URL(roomId);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws/admin/rooms`;
  };

  const sendLiveBan = async (roomId: string, worldKey: string, targetUuid: string, message: string) => {
    const tokenResponse = await apiRequest<{ token: string }>("/admin-sockets/token", {
      method: "POST",
      body: JSON.stringify({ roomIds: [roomId] }),
    });

    const socketUrl = resolveAdminSocketUrl(roomId);

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Admin socket timeout."));
      }, 5000);

      const ws = new WebSocket(socketUrl);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            event: "user-message",
            world: worldKey,
            jwt: tokenResponse.token,
            message: {
              type: "banned",
              message,
              userUuid: targetUuid,
            },
          })
        );
        ws.close();
        window.clearTimeout(timeout);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Admin socket error."));
      };
    });
  };

  const confirmBan = async () => {
    if (!banDraft) {
      return;
    }
    if (!banPlayTarget) {
      setBanError("Set a play URL or room URL before issuing bans.");
      return;
    }

    setBanSubmitting(true);
    setBanError(null);

    try {
      const targetLabel = banDraft.reportedMember.email ?? banDraft.reportedMember.id;
      const byUserUuid = context.userIdentifier || "admin";
      const reason = banReason.trim() || "Banned via report review.";
      const roomId = resolveRoomId(banPlayTarget);
      const worldKey = resolveSocketWorldKey(roomId);

      await apiRequest<boolean>("/ban", {
        method: "POST",
        body: JSON.stringify({
          uuidToBan: banDraft.reportedMember.id,
          playUri: banPlayTarget,
          name: targetLabel,
          message: reason,
          byUserUuid,
        }),
      });

      if (roomId && worldKey) {
        try {
          await sendLiveBan(roomId, worldKey, banDraft.reportedMember.id, reason);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          setBanError(`Ban saved, but live kick failed. ${message}`);
        }
      }

      await apiRequest<{ status: string }>(`/report/${banDraft.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "banned" }),
      });

      await Promise.all([
        reportsQuery.refetch(),
        resolvedReportsQuery.refetch(),
        bansQuery.refetch(),
      ]);
      setBanDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setBanError(`Unable to ban user. ${message}`);
    } finally {
      setBanSubmitting(false);
    }
  };

  const rejectReport = async (report: ReportItem) => {
    if (reportActionSubmitting) {
      return;
    }
    const target = report.reportedMember.email ?? report.reportedMember.id;
    if (!window.confirm(`Reject report for ${target}?`)) {
      return;
    }
    setReportActionSubmitting(true);
    setReportActionError(null);
    try {
      await apiRequest<{ status: string }>(`/report/${report.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected" }),
      });
      await Promise.all([reportsQuery.refetch(), resolvedReportsQuery.refetch()]);
      setReportDetails(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setReportActionError(`Unable to reject report. ${message}`);
    } finally {
      setReportActionSubmitting(false);
    }
  };

  const unbanUser = async (ban: BanItem) => {
    if (banActionSubmitting) {
      return;
    }
    if (!window.confirm(`Unban ${ban.targetIdentifier}?`)) {
      return;
    }
    setBanActionSubmitting(true);
    setBanActionError(null);
    try {
      await apiRequest<{ status: string }>(`/ban/${ban.id}`, { method: "DELETE" });
      await bansQuery.refetch();
      setBanDetails(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setBanActionError(`Unable to unban user. ${message}`);
    } finally {
      setBanActionSubmitting(false);
    }
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
          {banError && <p className="muted">{banError}</p>}
          {reportActionError && <p className="muted">{reportActionError}</p>}
          {reportsQuery.isError && (
            <p className="muted">Unable to load reports.</p>
          )}
          <table className="table table-wrap">
            <thead>
              <tr>
                <th>Reported</th>
                <th>Reporter</th>
                <th>World</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const targetKey = `${report.worldSlug}:${report.reportedMember.id}`;
                const isAlreadyBanned = bannedTargets.has(targetKey);
                return (
                  <tr key={report.id}>
                    <td>{report.reportedMember.email ?? report.reportedMember.id}</td>
                    <td>{report.reporterMember.email ?? report.reporterMember.id}</td>
                    <td>{report.worldSlug}</td>
                    <td>{new Date(report.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="button-stack">
                        <button className="button ghost" type="button" onClick={() => openReportDetails(report)}>
                          View
                        </button>
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => openBanModal(report)}
                          disabled={!banPlayTarget || banSubmitting || isAlreadyBanned}
                          title={
                            !banPlayTarget
                              ? "Set a play URL or room URL first"
                              : isAlreadyBanned
                              ? "User already banned"
                              : "Ban user"
                          }
                        >
                          Ban user
                        </button>
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => rejectReport(report)}
                          disabled={reportActionSubmitting}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
          <h2 className="section-title">Resolved reports</h2>
          <p className="muted">
            {resolvedReportsQuery.isLoading
              ? "Loading resolved reports..."
              : `Showing ${resolvedReports.length} of ${resolvedReportsQuery.data?.total ?? 0} resolved reports.`}
          </p>
          {resolvedReportsQuery.isError && (
            <p className="muted">Unable to load resolved reports.</p>
          )}
          <table className="table table-wrap">
            <thead>
              <tr>
                <th>Reported</th>
                <th>World</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resolvedReports.map((report) => (
                <tr key={report.id}>
                  <td>{report.reportedMember.email ?? report.reportedMember.id}</td>
                  <td>{report.worldSlug}</td>
                  <td>{report.status}</td>
                  <td>{new Date(report.updatedAt).toLocaleString()}</td>
                  <td>
                    <button className="button ghost" type="button" onClick={() => openReportDetails(report)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {!resolvedReports.length && !resolvedReportsQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No resolved reports.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

      <div className="card">
        <h2 className="section-title">Active bans</h2>
        <p className="muted">
          {bansQuery.isLoading
            ? "Loading bans..."
            : `Showing ${bans.length} of ${bansQuery.data?.total ?? 0} active bans.`}
        </p>
        {banActionError && <p className="muted">{banActionError}</p>}
        {bansQuery.isError && <p className="muted">Unable to load bans.</p>}
        <table className="table table-wrap">
          <thead>
            <tr>
              <th>Target</th>
              <th>World</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bans.map((ban) => (
              <tr key={ban.id}>
                <td>{ban.targetIdentifier}</td>
                <td>{ban.worldSlug}</td>
                <td>{new Date(ban.createdAt).toLocaleString()}</td>
                <td>{ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : "Never"}</td>
                <td>
                  <div className="button-stack">
                    <button className="button ghost" type="button" onClick={() => openBanDetails(ban)}>
                      View
                    </button>
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => unbanUser(ban)}
                      disabled={banActionSubmitting}
                    >
                      Unban
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!bans.length && !bansQuery.isLoading && (
              <tr>
                <td colSpan={5} className="muted">
                  No active bans.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {banDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Confirm ban</h3>
            <p className="muted">
              You are about to ban{" "}
              <strong>{banDraft.reportedMember.email ?? banDraft.reportedMember.id}</strong> in{" "}
              <strong>{banDraft.worldSlug}</strong>.
            </p>
            <label className="field">
              <span>Reason</span>
              <textarea
                className="input textarea"
                rows={4}
                value={banReason}
                onChange={(event) => setBanReason(event.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={closeBanModal} disabled={banSubmitting}>
                Cancel
              </button>
              <button className="button solid" type="button" onClick={confirmBan} disabled={banSubmitting}>
                {banSubmitting ? "Banning..." : "Confirm ban"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <button className="button ghost" type="button" onClick={closeReportDetails}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {banDetails && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Ban details</h3>
            <p className="muted">
              Target: <strong>{banDetails.targetIdentifier}</strong>
            </p>
            <p className="muted">World: {banDetails.worldSlug}</p>
            <p className="muted">
              Created by: {banDetails.createdBy?.email ?? banDetails.createdBy?.id ?? "N/A"}
            </p>
            <p className="muted">Created: {new Date(banDetails.createdAt).toLocaleString()}</p>
            <p className="muted">
              Expires: {banDetails.expiresAt ? new Date(banDetails.expiresAt).toLocaleString() : "Never"}
            </p>
            <label className="field">
              <span>Reason</span>
              <textarea className="input textarea" readOnly rows={4} value={banDetails.reason ?? ""} />
            </label>
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={closeBanDetails} disabled={banActionSubmitting}>
                Close
              </button>
              <button
                className="button solid"
                type="button"
                onClick={() => unbanUser(banDetails)}
                disabled={banActionSubmitting}
              >
                {banActionSubmitting ? "Unbanning..." : "Unban"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
