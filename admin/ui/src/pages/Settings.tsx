import { PageHeader } from "../components/PageHeader";

export function SettingsPage() {
  return (
    <section className="page">
      <PageHeader
        title="Settings"
        subtitle="World defaults and branding."
        actions={<button className="button solid">Save</button>}
      />

      <div className="grid-two">
        <div className="card">
          <h2 className="section-title">World defaults</h2>
          <label className="field">
            <span>Default room</span>
            <input className="input" placeholder="/worlds/main/lobby" />
          </label>
          <label className="field">
            <span>Primary color</span>
            <input className="input" placeholder="#0f766e" />
          </label>
        </div>
        <div className="card">
          <h2 className="section-title">Legal links</h2>
          <label className="field">
            <span>Privacy policy</span>
            <input className="input" placeholder="https://example.com/privacy" />
          </label>
          <label className="field">
            <span>Terms of use</span>
            <input className="input" placeholder="https://example.com/terms" />
          </label>
        </div>
      </div>
    </section>
  );
}