import { useAuth } from "../auth/AuthContext";

export function Topbar() {
  const { state, login, logout } = useAuth();
  const isAuthed = state.status === "authenticated";

  return (
    <header className="topbar">
      <div>
        <div className="topbar-title">Admin Dashboard</div>
        <div className="topbar-subtitle">Operations and world management</div>
      </div>
      <div className="topbar-actions">
        <button className="button ghost">Broadcast</button>
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
