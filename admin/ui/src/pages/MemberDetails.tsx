import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";

type MemberDetails = {
  id: string;
  name: string | null;
  email: string | null;
  visitCardUrl: string | null;
  chatID: string | null;
  lastSeenAt: string | null;
  lastRoomUrl: string | null;
  externalId: string;
  tags: string[];
  characterTextureIds: string[];
  companionTextureId: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "N/A";
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "N/A";
  }
  return new Date(parsed).toLocaleString();
}

function formatValue(value: string | null) {
  return value || "N/A";
}

function formatList(values: string[]) {
  if (!values.length) {
    return "N/A";
  }
  return values.join(", ");
}

export function MemberDetailsPage() {
  const { memberUUID } = useParams();

  const memberQuery = useQuery({
    queryKey: ["members", "detail", memberUUID],
    enabled: Boolean(memberUUID),
    queryFn: () => apiRequest<MemberDetails>(`/members/${memberUUID}`),
  });

  if (!memberUUID) {
    return (
      <section className="page">
        <PageHeader
          title="Member details"
          actions={
            <Link className="button ghost" to="/members">
              Back to members
            </Link>
          }
        />
        <div className="card">Missing member identifier.</div>
      </section>
    );
  }

  const member = memberQuery.data;
  const title = member?.name || member?.email || "Member details";
  const subtitle = member?.email ?? "Member profile";

  return (
    <section className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Link className="button ghost" to="/members">
            Back to members
          </Link>
        }
      />

      {memberQuery.isLoading && (
        <div className="card">Loading member details...</div>
      )}
      {memberQuery.isError && (
        <div className="card">Unable to load member details.</div>
      )}

      {member && (
        <>
          <div className="stats-grid">
            <StatCard
              label="Last seen"
              value={formatDateTime(member.lastSeenAt)}
              trend={member.lastRoomUrl ? `Room: ${member.lastRoomUrl}` : "Room: N/A"}
            />
            <StatCard
              label="Chat ID"
              value={member.chatID ? "Set" : "Missing"}
              trend={member.chatID ?? "N/A"}
            />
            <StatCard
              label="Tags"
              value={String(member.tags.length)}
              trend={member.tags.length ? member.tags.join(", ") : "No tags"}
            />
            <StatCard
              label="Created"
              value={formatDateTime(member.createdAt)}
              trend={`Updated ${formatDateTime(member.updatedAt)}`}
            />
          </div>

          <div className="grid-two">
            <div className="card">
              <h2 className="section-title">Profile</h2>
              <table className="table">
                <tbody>
                  <tr>
                    <th>Name</th>
                    <td>{formatValue(member.name)}</td>
                  </tr>
                  <tr>
                    <th>Email</th>
                    <td>{formatValue(member.email)}</td>
                  </tr>
                  <tr>
                    <th>External ID</th>
                    <td>{formatValue(member.externalId)}</td>
                  </tr>
                  <tr>
                    <th>Visit card</th>
                    <td>
                      {member.visitCardUrl ? (
                        <a href={member.visitCardUrl} target="_blank" rel="noreferrer">
                          {member.visitCardUrl}
                        </a>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Chat ID</th>
                    <td>{formatValue(member.chatID)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2 className="section-title">Activity</h2>
              <table className="table">
                <tbody>
                  <tr>
                    <th>Last room</th>
                    <td>{formatValue(member.lastRoomUrl)}</td>
                  </tr>
                  <tr>
                    <th>Last seen</th>
                    <td>{formatDateTime(member.lastSeenAt)}</td>
                  </tr>
                  <tr>
                    <th>Created</th>
                    <td>{formatDateTime(member.createdAt)}</td>
                  </tr>
                  <tr>
                    <th>Updated</th>
                    <td>{formatDateTime(member.updatedAt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid-two">
            <div className="card">
              <h2 className="section-title">Tags</h2>
              <div className="button-stack">
                {member.tags.map((tag) => (
                  <span className="pill" key={tag}>
                    {tag}
                  </span>
                ))}
                {!member.tags.length && (
                  <span className="muted">No tags assigned.</span>
                )}
              </div>
            </div>

            <div className="card">
              <h2 className="section-title">Appearance</h2>
              <table className="table">
                <tbody>
                  <tr>
                    <th>Character textures</th>
                    <td>{formatList(member.characterTextureIds)}</td>
                  </tr>
                  <tr>
                    <th>Companion</th>
                    <td>{formatValue(member.companionTextureId)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
