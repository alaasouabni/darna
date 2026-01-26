import { NavItem } from "./NavItem";

const navItems = [
  { to: "/", label: "Dashboard", description: "Live overview" },
  { to: "/rooms", label: "Rooms", description: "Maps and access" },
  { to: "/members", label: "Members", description: "People and tags" },
  { to: "/moderation", label: "Moderation", description: "Reports and bans" },
  { to: "/integrations", label: "Integrations", description: "Livekit, TURN" },
  { to: "/settings", label: "Settings", description: "World defaults" },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img
            className="brand-logo"
            src={new URL("../assets/darna-logo-dark.png", import.meta.url).toString()}
            alt="Darna"
          />
        </div>
        <div>
          <div className="brand-title">Darna</div>
          <div className="brand-subtitle">Admin Console</div>
        </div>
      </div>
      <nav className="nav">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="pill">Connected</div>
        <div className="sidebar-meta">staging</div>
      </div>
    </aside>
  );
}
