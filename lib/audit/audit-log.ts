export type CreateAuditLogInput = {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string;
  metadataJson?: Record<string, unknown> | null;
};

type AuditDb = {
  auditLog: {
    create(args: unknown): Promise<unknown>;
  };
};

function normalizeRequired(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

export async function createAuditLog(db: AuditDb, input: CreateAuditLogInput): Promise<void> {
  const metadataJson =
    input.metadataJson === null
      ? null
      : input.metadataJson === undefined
        ? undefined
        : input.metadataJson;

  await db.auditLog.create({
    data: {
      action: normalizeRequired(input.action, "action"),
      entityType: normalizeRequired(input.entityType, "entityType"),
      entityId: normalizeRequired(input.entityId, "entityId"),
      actorId: normalizeRequired(input.actorId, "actorId"),
      metadataJson
    }
  });
}
