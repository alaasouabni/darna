import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { buildQuery } from "../api/query";
import { PageHeader } from "../components/PageHeader";
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

export function MembersActivePage() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const [activeSearch, setActiveSearch] = useState(initialSearch);

  const activeQuery = useQuery({
    queryKey: ["members", "active", "all", activeSearch],
    queryFn: () =>
      apiRequest<ActiveMembersResponse>(
        buildQuery("/members/active", {
          minutes: 120,
          limit: 100,
          searchText: activeSearch.trim() || undefined,
        })
      ),
  });

  const activeMembers = activeQuery.data?.members ?? [];

  return (
    <section className="page">
      <PageHeader
        title="Recent activity"
        subtitle="Full list of active members."
        actions={
          <Link className="button ghost" to="/members">
            Back to members
          </Link>
        }
      />

      <div className="card">
        <h2 className="section-title">Filters</h2>
        <label className="field">
          <span>Search seen users</span>
          <input
            className="input"
            placeholder="Search by name, email, or id"
            value={activeSearch}
            onChange={(event) => setActiveSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="card">
        <h2 className="section-title">Active members</h2>
        <p className="muted">
          {activeQuery.isLoading
            ? "Loading active members..."
            : `Showing ${activeMembers.length} of ${activeQuery.data?.total ?? 0} active in the last 2 hours.`}
        </p>
        {activeQuery.isError && <p className="muted">Unable to load recent activity.</p>}
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
            {activeMembers.map((member) => (
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
            {!activeMembers.length && !activeQuery.isLoading && (
              <tr>
                <td colSpan={5} className="muted">
                  No recent activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
