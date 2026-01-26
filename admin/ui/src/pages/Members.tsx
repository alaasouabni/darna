import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { copyText } from "../clipboard";
import { useAdminContext } from "../context";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { EyeIcon } from "../components/icons";

type ActiveMember = {
  id: string;
  name: string | null;
  email: string | null;
  visitCardUrl: string | null;
  chatID: string | null;
  lastSeenAt: string | null;
  lastRoomUrl: string | null;
};

type ActiveMembersResponse = {
  total: number;
  members: ActiveMember[];
};

type KeycloakUser = {
  id: string;
  username: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean | null;
  createdAt: string | null;
};

type KeycloakUsersResponse = {
  total: number;
  users: KeycloakUser[];
};

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "—";
  }
  const deltaSeconds = Math.floor((Date.now() - timestamp) / 1000);
  if (deltaSeconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDisplayName(user: KeycloakUser) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.username || user.email || "—";
}

export function MembersPage() {
  const { context } = useAdminContext();
  const queryClient = useQueryClient();
  const [activeSearch, setActiveSearch] = useState("");
  const [directorySearch, setDirectorySearch] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);

  const activeQuery = useQuery({
    queryKey: ["members", "active", activeSearch],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(
        buildQuery("/members/active", {
          minutes: 120,
          limit: 50,
          searchText: activeSearch.trim() || undefined,
        })
      ),
  });

  const directoryQuery = useQuery({
    queryKey: ["keycloak", "users", directorySearch],
    queryFn: () =>
      apiRequest<KeycloakUsersResponse>(
        buildQuery("/keycloak/users", {
          searchText: directorySearch.trim() || undefined,
          first: 0,
          max: 25,
        })
      ),
  });

  const activeMembers = activeQuery.data?.members ?? [];
  const directoryUsers = directoryQuery.data?.users ?? [];
  const activeTotal = activeQuery.data?.total ?? 0;
  const directoryTotal = directoryQuery.data?.total ?? 0;
  const activeWithChat = activeMembers.filter((member) => member.chatID).length;
  const activePreview = activeMembers.slice(0, 6);
  const directoryPreview = directoryUsers.slice(0, 6);
  const inviteLabel = inviteCopied ? "Invite copied" : "Invite";
  const activeViewAllUrl = `/members/active?search=${encodeURIComponent(activeSearch.trim())}`;
  const directoryViewAllUrl = `/members/directory?search=${encodeURIComponent(
    directorySearch.trim()
  )}`;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["members", "active"] });
    queryClient.invalidateQueries({ queryKey: ["keycloak", "users"] });
  };

  const handleInvite = async () => {
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
        title="Members"
        subtitle="Search users, manage tags, and view activity."
        actions={
          <>
            <button className="button ghost" type="button" onClick={handleRefresh}>
              Refresh
            </button>
            <button className="button solid" type="button" onClick={handleInvite}>
              {inviteLabel}
            </button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Active (2h)"
          value={activeQuery.isLoading ? "â€”" : String(activeTotal)}
          trend={`${activeWithChat} with chat ID`}
          status="Recent"
          statusTone="muted"
        />
        <StatCard
          label="Keycloak directory"
          value={directoryQuery.isLoading ? "â€”" : String(directoryTotal)}
          trend="Users synced from Keycloak"
        />
      </div>

      <div className="grid-two">
        <div className="card">
          <div className="card-header">
            <h2 className="section-title">Recent activity</h2>
            {activeTotal > 6 && (
              <Link className="button ghost" to={activeViewAllUrl}>
                View all
              </Link>
            )}
          </div>
          <label className="field">
            <span>Search seen users</span>
            <input
              className="input"
              placeholder="Search by name, email, or id"
              value={activeSearch}
              onChange={(event) => setActiveSearch(event.target.value)}
            />
          </label>
          <p className="muted">
            {activeQuery.isLoading
              ? "Loading active members..."
              : `Showing ${activePreview.length} of ${activeQuery.data?.total ?? 0} active in the last 2 hours.`}
          </p>
          {activeQuery.isError && (
            <p className="muted">Unable to load recent activity.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Last room</th>
                <th>Last seen</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activePreview.map((member) => (
                <tr key={member.id}>
                  <td>{member.name ?? "—"}</td>
                  <td>{member.email ?? "—"}</td>
                  <td>{member.lastRoomUrl ?? "—"}</td>
                  <td>{formatRelativeTime(member.lastSeenAt)}</td>
                  <td>
                    <Link
                      className="button ghost icon-button"
                      to={`/members/${encodeURIComponent(member.id)}`}
                      title="View member"
                      aria-label="View member"
                    >
                      <EyeIcon aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
              {!activePreview.length && !activeQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No recent activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="section-title">Keycloak directory</h2>
            {directoryTotal > 6 && (
              <Link className="button ghost" to={directoryViewAllUrl}>
                View all
              </Link>
            )}
          </div>
          <label className="field">
            <span>Search Keycloak</span>
            <input
              className="input"
              placeholder="Search by username, email, or name"
              value={directorySearch}
              onChange={(event) => setDirectorySearch(event.target.value)}
            />
          </label>
          <p className="muted">
            {directoryQuery.isLoading
              ? "Loading directory..."
              : `Showing ${directoryPreview.length} of ${directoryQuery.data?.total ?? 0} users.`}
          </p>
          {directoryQuery.isError && (
            <p className="muted">Directory unavailable. Check Keycloak admin access.</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Status</th>
                <th>Created</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {directoryPreview.map((user) => (
                <tr key={user.id}>
                  <td>{formatDisplayName(user)}</td>
                  <td>{user.email ?? "—"}</td>
                  <td>
                    <span className={`status-badge ${user.enabled ? "live" : "rejected"}`}>
                      {user.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</td>
                  <td>
                    {user.email ? (
                      <Link
                        className="button ghost icon-button"
                        to={`/members/${encodeURIComponent(user.email)}`}
                        title="View member"
                        aria-label="View member"
                      >
                        <EyeIcon aria-hidden="true" />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!directoryPreview.length && !directoryQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No directory results.
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
