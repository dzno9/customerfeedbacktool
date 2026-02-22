import { describe, expect, it } from "vitest";

import { connectIntercom, getIntercomStatus } from "./intercom-connection";

type StoredConnection = {
  provider: string;
  status: string;
  encryptedCredentials: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
};

function createFakeDb() {
  let row: StoredConnection | null = null;

  return {
    integrationConnection: {
      async findFirst() {
        return row;
      },
      async upsert(args: {
        create: Omit<StoredConnection, "updatedAt">;
        update: Omit<StoredConnection, "provider" | "updatedAt">;
      }) {
        const updatedAt = new Date("2026-02-17T18:30:00.000Z");

        if (!row) {
          row = {
            ...args.create,
            updatedAt
          };

          return row;
        }

        row = {
          ...row,
          ...args.update,
          updatedAt
        };

        return row;
      }
    }
  };
}

describe("intercom connection", () => {
  process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY = "12345678901234567890123456789012";

  it("saves valid credentials and returns connected status", async () => {
    const db = createFakeDb();
    const now = new Date("2026-02-17T18:00:00.000Z");

    const result = await connectIntercom(
      { accessToken: "valid-token" },
      {
        db,
        now: () => now,
        validateCredentials: async () => ({ ok: true })
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected successful connection result");
    }

    expect(result.status).toEqual({
      provider: "intercom",
      status: "connected",
      connected: true,
      lastCheckedAt: now.toISOString(),
      error: null
    });

    const stored = await db.integrationConnection.findFirst();
    expect(stored?.encryptedCredentials.startsWith("v1:")).toBe(true);
    expect(stored?.encryptedCredentials.includes("valid-token")).toBe(false);

    const status = await getIntercomStatus({ db });
    expect(status.status).toBe("connected");
    expect(status.connected).toBe(true);
  });

  it("rejects invalid credentials and keeps connection inactive", async () => {
    const db = createFakeDb();
    const now = new Date("2026-02-17T18:10:00.000Z");

    const result = await connectIntercom(
      { accessToken: "bad-token" },
      {
        db,
        now: () => now,
        validateCredentials: async () => ({
          ok: false,
          error: "Intercom credentials are invalid. Verify the access token and try again."
        })
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failed connection result");
    }

    expect(result.error).toContain("invalid");
    expect(result.status).toEqual({
      provider: "intercom",
      status: "error",
      connected: false,
      lastCheckedAt: now.toISOString(),
      error: "Intercom credentials are invalid. Verify the access token and try again."
    });

    const status = await getIntercomStatus({ db });
    expect(status.connected).toBe(false);
    expect(status.status).toBe("error");
    expect(status.error).toContain("invalid");
  });

  it("returns disconnected payload shape when no connection exists", async () => {
    const db = createFakeDb();

    const status = await getIntercomStatus({ db });

    expect(status).toEqual({
      provider: "intercom",
      status: "disconnected",
      connected: false,
      lastCheckedAt: null,
      error: null
    });
    expect(Object.keys(status).sort()).toEqual(
      ["connected", "error", "lastCheckedAt", "provider", "status"].sort()
    );
  });

  it("fails safely when encryption key is missing", async () => {
    const db = createFakeDb();
    const previousKey = process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY;

    const result = await connectIntercom(
      { accessToken: "valid-token" },
      {
        db,
        validateCredentials: async () => ({ ok: true })
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("encryption key");
      expect(result.status.status).toBe("disconnected");
    }

    process.env.INTERCOM_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  });
});
