import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export function Topbar() {
  const { state, login, logout } = useAuth();
  const isAuthed = state.status === "authenticated";
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "light";
    }
    const stored = window.localStorage.getItem("wa-admin-theme");
    if (stored === "dark" || stored === "light") {
      return stored;
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("wa-admin-theme", theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

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
        <button
          className="button ghost"
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
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
