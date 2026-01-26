import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { isKeycloakConfigured } from "./keycloak";

type Props = {
  children: ReactNode;
};

export function AuthGate({ children }: Props) {
  const { state, login, logout } = useAuth();
  const isAdmin = state.roles?.includes("wa-admin");

  if (state.status === "loading") {
    return (
      <section className="page">
        <div className="card">
          <h2 className="section-title">Checking your session</h2>
          <p className="muted">Waiting for authentication status.</p>
        </div>
      </section>
    );
  }

  if (state.status === "anonymous") {
    return (
      <section className="page">
        <div className="card">
          <h2 className="section-title">Sign in required</h2>
          <p className="muted">
            {isKeycloakConfigured()
              ? "Connect with Keycloak to access the admin console."
              : "Keycloak is not configured for this environment."}
          </p>
          {isKeycloakConfigured() && (
            <button className="button solid" onClick={login} type="button">
              Sign in
            </button>
          )}
        </div>
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="page">
        <div className="card">
          <h2 className="section-title">Access denied</h2>
          <p className="muted">
            Your account does not have the <strong>wa-admin</strong> role required to access this console.
          </p>
          <div className="button-stack">
            <button className="button solid" onClick={logout} type="button">
              Sign out
            </button>
            <button className="button ghost" onClick={login} type="button">
              Sign in with another account
            </button>
          </div>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
