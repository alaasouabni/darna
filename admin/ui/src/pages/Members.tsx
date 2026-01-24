import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { PageHeader } from "../components/PageHeader";

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
  const [activeSearch, setActiveSearch] = useState("");
  const [directorySearch, setDirectorySearch] = useState("");

  const activeQuery = useQuery({
    queryKey: ["members", "active", activeSearch],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(
        buildQuery("/members/active", {
          minutes: 120,
          limit: 25,
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

  return (
    <section className="page">
      <PageHeader
        title="Members"
        subtitle="Search users, manage tags, and view activity."
        actions={<button className="button ghost">Invite</button>}
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">Recent activity</h2>
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
              : `Showing ${activeMembers.length} of ${activeQuery.data?.total ?? 0} active in the last 2 hours.`}
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
              </tr>
            </thead>
            <tbody>
              {activeMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.name ?? "—"}</td>
                  <td>{member.email ?? "—"}</td>
                  <td>{member.lastRoomUrl ?? "—"}</td>
                  <td>{formatRelativeTime(member.lastSeenAt)}</td>
                </tr>
              ))}
              {!activeMembers.length && !activeQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="muted">
                    No recent activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2 className="section-title">Keycloak directory</h2>
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
              : `Showing ${directoryUsers.length} of ${directoryQuery.data?.total ?? 0} users.`}
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
              </tr>
            </thead>
            <tbody>
              {directoryUsers.map((user) => (
                <tr key={user.id}>
                  <td>{formatDisplayName(user)}</td>
                  <td>{user.email ?? "—"}</td>
                  <td>
                    <span className={`pill ${user.enabled ? "" : "muted"}`}>
                      {user.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {!directoryUsers.length && !directoryQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="muted">
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
