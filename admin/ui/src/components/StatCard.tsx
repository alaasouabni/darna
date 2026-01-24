type Props = {
  label: string;
  value: string;
  trend?: string;
};

export function StatCard({ label, value, trend }: Props) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {trend ? <div className="stat-trend">{trend}</div> : null}
    </div>
  );
}