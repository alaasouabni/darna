import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { ContextFields } from "../components/ContextFields";
import { PageHeader } from "../components/PageHeader";
import { copyText } from "../clipboard";
import { useAdminContext } from "../context";

type InviteStatus = "all" | "active" | "expired" | "revoked" | "limit_reached";

type InviteItem = {
  token: string;
  status: Exclude<InviteStatus, "all">;
  inviteUrl: string | null;
  worldSlug: string;
  worldName: string;
  worldDomain: string | null;
  roomUrl: string | null;
  roomSlug: string | null;
  allowedEmail: string | null;
  maxUses: number | null;
  useCount: number;
  remainingUses: number | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type InviteListResponse = {
  total: number;
  items: InviteItem[];
};

type InviteCreateResponse = {
  inviteUrl: string;
};

const STATUS_LABELS: Record<InviteStatus, string> = {
  all: "All",
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
  limit_reached: "Used up",
};

function formatDate(value: string | null) {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }
  return parsed.toLocaleString();
}

function buildFallbackInviteUrl(playUri: string, roomUrl: string | null, token: string): string | null {
  if (!roomUrl) {
    return null;
  }

  try {
    const parsed = new URL(playUri);
    return `${parsed.protocol}//${parsed.host}${roomUrl}?invite=${token}`;
  } catch {
    return null;
  }
}

export function InvitesPage() {
  const { context } = useAdminContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<InviteStatus>("active");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revokeDraft, setRevokeDraft] = useState<InviteItem | null>(null);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);

  const invitesQuery = useQuery({
    queryKey: ["invites", context.worldSlug, context.roomUrl, status],
    queryFn: () =>
      apiRequest<InviteListResponse>(
        buildQuery("/invites", {
          worldSlug: context.worldSlug || undefined,
          roomUrl: context.roomUrl || undefined,
          status,
          take: 200,
        })
      ),
  });

  const invites = invitesQuery.data?.items ?? [];
  const total = invitesQuery.data?.total ?? 0;

  const canGenerate = Boolean(context.playUri);

  const groupedSummary = useMemo(() => {
    const byStatus = {
      active: 0,
      expired: 0,
      revoked: 0,
      limit_reached: 0,
    };
    for (const invite of invites) {
      byStatus[invite.status] += 1;
    }
    return byStatus;
  }, [invites]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["invites"] });
  };

  const handleGenerateInvite = async () => {
    if (!context.playUri) {
      window.alert("Set a Play URL first.");
      return;
    }

    try {
      const response = await apiRequest<InviteCreateResponse>("/invites", {
        method: "POST",
        body: JSON.stringify({ playUri: context.playUri }),
      });
      const copied = await copyText(response.inviteUrl);
      if (!copied) {
        window.prompt("Copy invite link", response.inviteUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["invites"] });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to generate invite.");
    }
  };

  const handleCopyInvite = async (invite: InviteItem) => {
    const inviteUrl =
      invite.inviteUrl || buildFallbackInviteUrl(context.playUri, invite.roomUrl, invite.token);
    if (!inviteUrl) {
      window.alert("No valid URL could be built for this invite.");
      return;
    }

    const copied = await copyText(inviteUrl);
    if (!copied) {
      window.prompt("Copy invite link", inviteUrl);
      return;
    }

    setCopiedToken(invite.token);
    window.setTimeout(() => setCopiedToken((current) => (current === invite.token ? null : current)), 1500);
  };

  const openRevokeModal = (invite: InviteItem) => {
    if (invite.status === "revoked") {
      return;
    }
    setRevokeDraft(invite);
  };

  const closeRevokeModal = () => {
    if (revokeSubmitting) {
      return;
    }
    setRevokeDraft(null);
  };

  const handleConfirmRevoke = async () => {
    if (!revokeDraft) {
      return;
    }

    setRevokeSubmitting(true);

    try {
      await apiRequest(`/invites/${revokeDraft.token}/revoke`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      setRevokeDraft(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to revoke invite.");
    } finally {
      setRevokeSubmitting(false);
    }
  };

  return (
    <section className="page">
      <PageHeader
        title="Invites"
        subtitle="Manage invitation links per room and revoke links when needed."
        actions={
          <>
            <button className="button ghost" type="button" onClick={handleRefresh}>
              Refresh
            </button>
            <button className="button solid" type="button" onClick={handleGenerateInvite} disabled={!canGenerate}>
              Generate invite
            </button>
          </>
        }
      />

      <div className="card">
        <h2 className="section-title">Context</h2>
        <div className="grid-two">
          <ContextFields showWorld showRoom showPlayUri includeInactiveRooms />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="section-title">Invite links</h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span className="muted">Status</span>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value as InviteStatus)}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="muted">
          {invitesQuery.isLoading
            ? "Loading invites..."
            : `${total} invites (active ${groupedSummary.active}, used up ${groupedSummary.limit_reached}, expired ${groupedSummary.expired}, revoked ${groupedSummary.revoked}).`}
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>Room</th>
              <th>Status</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.token}>
                <td>{invite.roomUrl ?? `${invite.worldSlug} (world-level)`}</td>
                <td>
                  <span className={`status-badge ${invite.status === "active" ? "live" : "rejected"}`}>
                    {STATUS_LABELS[invite.status]}
                  </span>
                </td>
                <td>
                  {invite.maxUses === null
                    ? `${invite.useCount} / unlimited`
                    : `${invite.useCount} / ${invite.maxUses}`}
                </td>
                <td>{formatDate(invite.expiresAt)}</td>
                <td>{formatDate(invite.lastUsedAt)}</td>
                <td style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="button ghost" type="button" onClick={() => handleCopyInvite(invite)}>
                    {copiedToken === invite.token ? "Copied" : "Copy"}
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => openRevokeModal(invite)}
                    disabled={invite.status === "revoked"}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
            {!invites.length && !invitesQuery.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  No invites found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {revokeDraft && (
        <div className="modal-backdrop" onClick={closeRevokeModal} role="dialog" aria-modal="true">
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">Revoke invite</h3>
            <p className="muted">
              Revoke invite for <strong>{revokeDraft.roomUrl ?? revokeDraft.worldSlug}</strong>?
            </p>
            <p className="muted">
              People already onboarded will keep access. This only prevents future first-time onboarding with this
              link.
            </p>
            <div className="modal-actions">
              <button className="button ghost" type="button" onClick={closeRevokeModal} disabled={revokeSubmitting}>
                Cancel
              </button>
              <button className="button solid" type="button" onClick={handleConfirmRevoke} disabled={revokeSubmitting}>
                {revokeSubmitting ? "Revoking..." : "Confirm revoke"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
