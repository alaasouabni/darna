type Props = {
  label: string;
  value: string;
  trend?: string;
  status?: string;
  statusTone?: "live" | "muted";
};

export function StatCard({ label, value, trend, status, statusTone = "live" }: Props) {
  return (
    <div className="card stat-card">
      <div className="stat-header">
        <div className="stat-label">{label}</div>
        {status ? <span className={`stat-badge ${statusTone}`}>{status}</span> : null}
      </div>
      <div className="stat-value">{value}</div>
      {trend ? <div className="stat-trend">{trend}</div> : null}
    </div>
  );
}
