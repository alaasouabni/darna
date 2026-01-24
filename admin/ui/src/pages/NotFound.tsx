import { PageHeader } from "../components/PageHeader";

export function NotFoundPage() {
  return (
    <section className="page">
      <PageHeader title="Page not found" subtitle="The page you requested does not exist." />
      <div className="card">
        <p className="muted">Check the navigation or return to the dashboard.</p>
      </div>
    </section>
  );
}