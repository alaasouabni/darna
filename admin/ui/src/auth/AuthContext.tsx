import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getKeycloakClient } from "./keycloak";
import { setAccessToken, setRefreshTokenHandler } from "./session";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export type AuthState = {
  status: AuthStatus;
  displayName?: string;
  email?: string;
  roles?: string[];
};

export type AuthContextValue = {
  state: AuthState;
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type Props = {
  children: ReactNode;
};

export function AuthProvider({ children }: Props) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const client = getKeycloakClient();

    if (!client) {
      setState({ status: "anonymous" });
      return;
    }

    let disposed = false;

    const syncState = () => {
      if (!client.authenticated || !client.token) {
        setAccessToken(undefined);
        if (!disposed) {
          setState({ status: "anonymous" });
        }
        return;
      }

      const parsed = (client.tokenParsed ?? {}) as Record<string, unknown>;
      const displayName =
        (parsed.name as string | undefined) ??
        (parsed.preferred_username as string | undefined) ??
        (parsed.email as string | undefined);
      const email = parsed.email as string | undefined;

      const realmAccess = parsed.realm_access as { roles?: string[] } | undefined;
      const roles = Array.isArray(realmAccess?.roles) ? realmAccess?.roles : undefined;

      setAccessToken(client.token);

      if (!disposed) {
        setState({
          status: "authenticated",
          displayName,
          email,
          roles,
        });
      }
    };

    const refreshToken = async () => {
      if (!client.authenticated) {
        return;
      }
      try {
        const refreshed = await client.updateToken(30);
        if (refreshed) {
          setAccessToken(client.token ?? undefined);
          syncState();
        }
      } catch {
        setAccessToken(undefined);
        if (!disposed) {
          setState({ status: "anonymous" });
        }
      }
    };

    setRefreshTokenHandler(() => refreshToken);

    client.onTokenExpired = () => {
      void refreshToken();
    };

    client
      .init({
        onLoad: "login-required",
        pkceMethod: "S256",
        checkLoginIframe: false,
      })
      .then(() => {
        if (!disposed) {
          syncState();
        }
      })
      .catch(() => {
        if (!disposed) {
          setState({ status: "anonymous" });
        }
      });

    return () => {
      disposed = true;
      setRefreshTokenHandler(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login: () => {
        const client = getKeycloakClient();
        if (client) {
          client.login({ redirectUri: window.location.href });
          return;
        }
        window.location.assign("/login");
      },
      logout: () => {
        const client = getKeycloakClient();
        setAccessToken(undefined);
        if (client) {
          client.logout({ redirectUri: window.location.origin });
          return;
        }
        window.location.assign("/logout");
      },
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
