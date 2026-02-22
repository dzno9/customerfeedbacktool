import { z } from "zod";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const intercomConnectSchema = z.object({
  accessToken: z
    .string()
    .trim()
    .min(1, "Intercom access token is required.")
});

const INTERCOM_PROVIDER = "intercom";
const CONNECTION_STATUSES = {
  connected: "connected",
  disconnected: "disconnected",
  error: "error"
} as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[keyof typeof CONNECTION_STATUSES];

type IntercomValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

type IntegrationConnectionRecord = {
  provider: string;
  status: string;
  encryptedCredentials: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
};

export type IntercomStatusResponse = {
  provider: typeof INTERCOM_PROVIDER;
  status: ConnectionStatus;
  connected: boolean;
  lastCheckedAt: string | null;
  error: string | null;
};

function encodeCredentials(accessToken: string): string {
  const rawKey = process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("Intercom credentials encryption key is not configured.");
  }

  const parsedBase64Key = Buffer.from(rawKey, "base64");
  const keyBuffer =
    parsedBase64Key.length === 32 ? parsedBase64Key : Buffer.from(rawKey, "utf8");

  if (keyBuffer.length !== 32) {
    throw new Error(
      "Intercom credentials encryption key must be 32 bytes (base64 or raw text)."
    );
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ accessToken }), "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function resolveEncryptionKey(): Buffer {
  const rawKey = process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("Intercom credentials encryption key is not configured.");
  }

  const parsedBase64Key = Buffer.from(rawKey, "base64");
  const keyBuffer =
    parsedBase64Key.length === 32 ? parsedBase64Key : Buffer.from(rawKey, "utf8");

  if (keyBuffer.length !== 32) {
    throw new Error(
      "Intercom credentials encryption key must be 32 bytes (base64 or raw text)."
    );
  }

  return keyBuffer;
}

export function decodeIntercomCredentials(encryptedCredentials: string): {
  accessToken: string;
} {
  const parts = encryptedCredentials.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Stored Intercom credentials are malformed.");
  }

  const [, ivBase64, authTagBase64, encryptedBase64] = parts;
  const keyBuffer = resolveEncryptionKey();

  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyBuffer,
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final()
  ]);

  const parsed = JSON.parse(decrypted.toString("utf8")) as { accessToken?: unknown };
  if (typeof parsed.accessToken !== "string" || parsed.accessToken.trim().length === 0) {
    throw new Error("Stored Intercom credentials are invalid.");
  }

  return {
    accessToken: parsed.accessToken
  };
}

function normalizeStatus(status: string): ConnectionStatus {
  if (status === CONNECTION_STATUSES.connected) {
    return CONNECTION_STATUSES.connected;
  }

  if (status === CONNECTION_STATUSES.error) {
    return CONNECTION_STATUSES.error;
  }

  return CONNECTION_STATUSES.disconnected;
}

export async function validateIntercomAccessToken(
  accessToken: string
): Promise<IntercomValidationResult> {
  const response = await fetch("https://api.intercom.io/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: "Intercom credentials are invalid. Verify the access token and try again."
    };
  }

  return {
    ok: false,
    error: "Unable to validate Intercom credentials right now. Please retry in a moment."
  };
}

export async function connectIntercom(
  input: unknown,
  deps: {
    db: unknown;
    validateCredentials?: (accessToken: string) => Promise<IntercomValidationResult>;
    now?: () => Date;
  }
): Promise<
  | {
      ok: true;
      status: IntercomStatusResponse;
    }
  | {
      ok: false;
      error: string;
      status: IntercomStatusResponse;
    }
> {
  const integrationConnection = (deps.db as {
    integrationConnection: {
      upsert: (args: unknown) => Promise<IntegrationConnectionRecord>;
    };
  }).integrationConnection;

  const parsed = intercomConnectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid Intercom connection payload.",
      status: {
        provider: INTERCOM_PROVIDER,
        status: CONNECTION_STATUSES.disconnected,
        connected: false,
        lastCheckedAt: null,
        error: null
      }
    };
  }

  const now = deps.now?.() ?? new Date();
  const validateCredentials = deps.validateCredentials ?? validateIntercomAccessToken;
  const validationResult = await validateCredentials(parsed.data.accessToken);

  if (!validationResult.ok) {
    const record = await integrationConnection.upsert({
      where: {
        provider: INTERCOM_PROVIDER
      },
      create: {
        provider: INTERCOM_PROVIDER,
        status: CONNECTION_STATUSES.error,
        encryptedCredentials: "",
        lastError: validationResult.error,
        lastCheckedAt: now
      },
      update: {
        status: CONNECTION_STATUSES.error,
        encryptedCredentials: "",
        lastError: validationResult.error,
        lastCheckedAt: now
      }
    });

    return {
      ok: false,
      error: validationResult.error,
      status: {
        provider: INTERCOM_PROVIDER,
        status: normalizeStatus(record.status),
        connected: false,
        lastCheckedAt: (record.lastCheckedAt ?? now).toISOString(),
        error: validationResult.error
      }
    };
  }

  let encryptedCredentials: string;
  try {
    encryptedCredentials = encodeCredentials(parsed.data.accessToken);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to encrypt credentials.",
      status: {
        provider: INTERCOM_PROVIDER,
        status: CONNECTION_STATUSES.disconnected,
        connected: false,
        lastCheckedAt: now.toISOString(),
        error: error instanceof Error ? error.message : "Failed to encrypt credentials."
      }
    };
  }

  const record = await integrationConnection.upsert({
    where: {
      provider: INTERCOM_PROVIDER
    },
    create: {
      provider: INTERCOM_PROVIDER,
      status: CONNECTION_STATUSES.connected,
      encryptedCredentials,
      lastError: null,
      lastCheckedAt: now
    },
    update: {
      status: CONNECTION_STATUSES.connected,
      encryptedCredentials,
      lastError: null,
      lastCheckedAt: now
    }
  });

  return {
    ok: true,
    status: {
      provider: INTERCOM_PROVIDER,
      status: normalizeStatus(record.status),
      connected: true,
      lastCheckedAt: (record.lastCheckedAt ?? now).toISOString(),
      error: null
    }
  };
}

export async function getIntercomStatus(deps: {
  db: unknown;
}): Promise<IntercomStatusResponse> {
  const integrationConnection = (deps.db as {
    integrationConnection: {
      findFirst: (args: unknown) => Promise<IntegrationConnectionRecord | null>;
    };
  }).integrationConnection;

  const record = await integrationConnection.findFirst({
    where: {
      provider: INTERCOM_PROVIDER
    }
  });

  if (!record) {
    return {
      provider: INTERCOM_PROVIDER,
      status: CONNECTION_STATUSES.disconnected,
      connected: false,
      lastCheckedAt: null,
      error: null
    };
  }

  const status = normalizeStatus(record.status);

  return {
    provider: INTERCOM_PROVIDER,
    status,
    connected: status === CONNECTION_STATUSES.connected,
    lastCheckedAt: (record.lastCheckedAt ?? record.updatedAt).toISOString(),
    error: record.lastError
  };
}
