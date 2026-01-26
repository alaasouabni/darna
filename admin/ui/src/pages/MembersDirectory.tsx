import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { PageHeader } from "../components/PageHeader";
import { EyeIcon } from "../components/icons";

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

function formatDisplayName(user: KeycloakUser) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return fullName || user.username || user.email || "—";
}

export function MembersDirectoryPage() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const initialStatus = searchParams.get("enabled") ?? "all";
  const [directorySearch, setDirectorySearch] = useState(initialSearch);
  const [enabledFilter, setEnabledFilter] = useState(initialStatus);

  const statusOptions = useMemo(
    () => [
      { label: "All", value: "all" },
      { label: "Enabled", value: "true" },
      { label: "Disabled", value: "false" },
    ],
    []
  );

  const directoryQuery = useQuery({
    queryKey: ["keycloak", "users", "all", directorySearch, enabledFilter],
    queryFn: () =>
      apiRequest<KeycloakUsersResponse>(
        buildQuery("/keycloak/users", {
          searchText: directorySearch.trim() || undefined,
          first: 0,
          max: 100,
          enabled: enabledFilter === "all" ? undefined : enabledFilter,
        })
      ),
  });

  const directoryUsers = directoryQuery.data?.users ?? [];

  return (
    <section className="page">
      <PageHeader
        title="Keycloak directory"
        subtitle="Full directory results."
        actions={
          <Link className="button ghost" to="/members">
            Back to members
          </Link>
        }
      />

      <div className="card">
        <h2 className="section-title">Filters</h2>
        <label className="field">
          <span>Search Keycloak</span>
          <input
            className="input"
            placeholder="Search by username, email, or name"
            value={directorySearch}
            onChange={(event) => setDirectorySearch(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            className="input"
            value={enabledFilter}
            onChange={(event) => setEnabledFilter(event.target.value)}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card">
        <h2 className="section-title">Users</h2>
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
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {directoryUsers.map((user) => (
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
            {!directoryUsers.length && !directoryQuery.isLoading && (
              <tr>
                <td colSpan={5} className="muted">
                  No directory results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
