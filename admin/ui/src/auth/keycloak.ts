import Keycloak from "keycloak-js";
import type { KeycloakConfig, KeycloakInstance } from "keycloak-js";

type KeycloakEnv = {
  VITE_KEYCLOAK_URL?: string;
  VITE_KEYCLOAK_REALM?: string;
  VITE_KEYCLOAK_CLIENT_ID?: string;
};

const env = import.meta.env as KeycloakEnv;

function buildConfig(): KeycloakConfig | null {
  const url = env.VITE_KEYCLOAK_URL;
  const realm = env.VITE_KEYCLOAK_REALM;
  const clientId = env.VITE_KEYCLOAK_CLIENT_ID;

  if (!url || !realm || !clientId) {
    return null;
  }

  return { url, realm, clientId };
}

let cachedConfig: KeycloakConfig | null | undefined;
let client: KeycloakInstance | null = null;

export function getKeycloakConfig(): KeycloakConfig | null {
  if (cachedConfig === undefined) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
}

export function isKeycloakConfigured(): boolean {
  return Boolean(getKeycloakConfig());
}

export function getKeycloakClient(): KeycloakInstance | null {
  const config = getKeycloakConfig();
  if (!config) {
    return null;
  }

  if (!client) {
    client = new Keycloak(config);
  }

  return client;
}
