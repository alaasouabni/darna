import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { ContextFields } from "../components/ContextFields";
import { PageHeader } from "../components/PageHeader";
import { copyText } from "../clipboard";
import { useAdminContext } from "../context";

type InviteStatus = "all" | "active" | "expired" | "revoked" | "limit_reached";
type InviteMode = "member_onboarding" | "guest_access";
type InviteUsageCountMode = "unique_guest" | "every_claim";

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
  mode: InviteMode;
  usageCountMode: InviteUsageCountMode;
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

const MODE_LABELS: Record<InviteMode, string> = {
  member_onboarding: "Registered user",
  guest_access: "Guest link",
};

const USAGE_MODE_LABELS: Record<InviteUsageCountMode, string> = {
  unique_guest: "Unique guest",
  every_claim: "Every claim",
};

const MODE_HELP_TEXT: Record<InviteMode, string> = {
  guest_access: "Creates guest identities without signup. Best for external attendees.",
  member_onboarding: "Requires normal authenticated onboarding (account/login flow).",
};

function getUseUnit(mode: InviteMode, usageCountMode: InviteUsageCountMode) {
  if (mode === "member_onboarding") {
    return "onboarding claims";
  }
  return usageCountMode === "unique_guest" ? "unique guests" : "claims";
}

function getMaxUsesLabel(mode: InviteMode, usageCountMode: InviteUsageCountMode) {
  if (mode === "member_onboarding") {
    return "Max onboarding claims (0 = unlimited)";
  }
  return usageCountMode === "unique_guest"
    ? "Max guests (0 = unlimited)"
    : "Max claims (0 = unlimited)";
}

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

function toDateTimeLocalValue(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocalValue(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createMode, setCreateMode] = useState<InviteMode>("guest_access");
  const [createUsageCountMode, setCreateUsageCountMode] = useState<InviteUsageCountMode>("unique_guest");
  const [createMaxUses, setCreateMaxUses] = useState("1");
  const [createExpiresAt, setCreateExpiresAt] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [createAllowedEmail, setCreateAllowedEmail] = useState("");
  const [createRevokeExisting, setCreateRevokeExisting] = useState(false);
  const [createShowAdvanced, setCreateShowAdvanced] = useState(false);

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
  const isGuestCreateMode = createMode === "guest_access";
  const selectedExpiresAt = parseDateTimeLocalValue(createExpiresAt) ?? new Date(Date.now() + 24 * 60 * 60 * 1000);

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

  const handleOpenCreateModal = () => {
    if (!context.playUri) {
      window.alert("Set a Play URL first.");
      return;
    }
    setCreateShowAdvanced(false);
    setCreateModalOpen(true);
  };

  const handleCreateInvite = async () => {
    if (!context.playUri) {
      window.alert("Set a Play URL first.");
      return;
    }

    const maxUses = createMaxUses.trim() === "" ? undefined : Number.parseInt(createMaxUses, 10);
    if (maxUses !== undefined && (Number.isNaN(maxUses) || maxUses < 0)) {
      window.alert("Max uses must be a positive number or 0 for unlimited.");
      return;
    }

    const expiresDate = new Date(createExpiresAt);
    if (Number.isNaN(expiresDate.getTime()) || expiresDate <= new Date()) {
      window.alert("Please select a future expiration date.");
      return;
    }

    setCreateSubmitting(true);
    try {
      const response = await apiRequest<InviteCreateResponse>("/invites", {
        method: "POST",
        body: JSON.stringify({
          playUri: context.playUri,
          expiresAt: expiresDate.toISOString(),
          maxUses,
          mode: createMode,
          usageCountMode: createUsageCountMode,
          allowedEmail: createMode === "member_onboarding" && createAllowedEmail.trim() ? createAllowedEmail.trim() : undefined,
          revokeExisting: createRevokeExisting,
        }),
      });
      const copied = await copyText(response.inviteUrl);
      if (!copied) {
        window.prompt("Copy invite link", response.inviteUrl);
      }
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      setCreateModalOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to generate invite.");
    } finally {
      setCreateSubmitting(false);
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
            <button className="button solid" type="button" onClick={handleOpenCreateModal} disabled={!canGenerate}>
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
              <th>Mode</th>
              <th>Status</th>
              <th>Usage</th>
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
                  <div>{MODE_LABELS[invite.mode]}</div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {invite.mode === "guest_access"
                      ? `Counting: ${USAGE_MODE_LABELS[invite.usageCountMode]}`
                      : invite.allowedEmail
                        ? `Email lock: ${invite.allowedEmail}`
                        : "Any authenticated user"}
                  </div>
                </td>
                <td>
                  <span className={`status-badge ${invite.status === "active" ? "live" : "rejected"}`}>
                    {STATUS_LABELS[invite.status]}
                  </span>
                </td>
                <td>
                  <div>
                    {invite.maxUses === null
                      ? `${invite.useCount} / unlimited`
                      : `${invite.useCount} / ${invite.maxUses}`}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {getUseUnit(invite.mode, invite.usageCountMode)}
                  </div>
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
                <td colSpan={7} className="muted">
                  No invites found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createModalOpen && (
        <div className="modal-backdrop" onClick={() => (createSubmitting ? undefined : setCreateModalOpen(false))} role="dialog" aria-modal="true">
          <div className="modal-card invite-create-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">Generate invite</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: "0.9rem" }}>
              Configure how this invite is consumed and when it expires.
            </p>

            <div className="invite-mode-summary">
              <div className="invite-mode-summary-title">{MODE_LABELS[createMode]}</div>
              <div className="invite-mode-summary-text">{MODE_HELP_TEXT[createMode]}</div>
            </div>

            <div className="grid-two">
              <label className="field">
                <span className="muted">Mode</span>
                <select
                  className="input"
                  value={createMode}
                  onChange={(event) => setCreateMode(event.target.value as InviteMode)}
                >
                  <option value="guest_access">Guest link</option>
                  <option value="member_onboarding">Registered user</option>
                </select>
              </label>
              <label className="field">
                <span className="muted">Expires at</span>
                <DatePicker
                  selected={selectedExpiresAt}
                  onChange={(date) => {
                    if (date) {
                      setCreateExpiresAt(toDateTimeLocalValue(date));
                    }
                  }}
                  showMonthDropdown
                  showYearDropdown
                  yearItemNumber={30}
                  dropdownMode="select"
                  showTimeInput
                  timeInputLabel="Time"
                  dateFormat="MM/dd/yyyy h:mm aa"
                  className="input"
                  calendarClassName="wa-datepicker"
                  popperClassName="wa-datepicker-popper"
                  popperPlacement="bottom-start"
                  popperProps={{ strategy: "fixed" }}
                  showPopperArrow={false}
                />
              </label>
            </div>

            <div className="grid-two">
              <label className="field">
                <span className="muted">{getMaxUsesLabel(createMode, createUsageCountMode)}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={createMaxUses}
                  onChange={(event) => setCreateMaxUses(event.target.value)}
                />
              </label>
              {createMode === "member_onboarding" ? (
                <label className="field">
                  <span className="muted">Allowed email (optional)</span>
                  <input
                    className="input"
                    type="email"
                    value={createAllowedEmail}
                    onChange={(event) => setCreateAllowedEmail(event.target.value)}
                    placeholder="name@example.com"
                  />
                </label>
              ) : null}
            </div>

            <button className="button ghost" type="button" onClick={() => setCreateShowAdvanced((value) => !value)}>
              {createShowAdvanced ? "Hide advanced" : "Show advanced"}
            </button>

            {createShowAdvanced && (
              <div className="invite-advanced">
                <h4 className="section-title" style={{ margin: 0 }}>
                  Advanced
                </h4>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span className="muted">Revoke existing active invites</span>
                  <select
                    className="input"
                    value={createRevokeExisting ? "yes" : "no"}
                    onChange={(event) => setCreateRevokeExisting(event.target.value === "yes")}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                {isGuestCreateMode ? (
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span className="muted">Usage counting policy</span>
                    <select
                      className="input"
                      value={createUsageCountMode}
                      onChange={(event) => setCreateUsageCountMode(event.target.value as InviteUsageCountMode)}
                    >
                      <option value="unique_guest">Unique guest (recommended)</option>
                      <option value="every_claim">Every claim</option>
                    </select>
                  </label>
                ) : null}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => setCreateModalOpen(false)}
                disabled={createSubmitting}
              >
                Cancel
              </button>
              <button className="button solid" type="button" onClick={handleCreateInvite} disabled={createSubmitting}>
                {createSubmitting ? "Generating..." : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

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
