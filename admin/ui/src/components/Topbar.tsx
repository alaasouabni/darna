import { useAuth } from "../auth/AuthContext";

export function Topbar() {
  const { state, login, logout } = useAuth();
  const isAuthed = state.status === "authenticated";

  const handleBroadcast = () => {
    window.alert("Broadcast from the admin console is not wired yet.");
  };

  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">Admin Dashboard</div>
        <div className="topbar-subtitle">Operations and world management</div>
      </div>
      <div className="topbar-actions">
        <button className="button ghost" type="button" onClick={handleBroadcast}>
          Broadcast
        </button>
        <button
          className="button solid"
          onClick={isAuthed ? logout : login}
          type="button"
        >
          {isAuthed ? state.displayName ?? "Account" : "Sign in"}
        </button>
      </div>
    </header>
  );
}
