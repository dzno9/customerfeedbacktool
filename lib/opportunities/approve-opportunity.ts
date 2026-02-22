import { createAuditLog } from "../audit/audit-log";

export class OpportunityApprovalError extends Error {
  code: "NOT_FOUND" | "ZERO_EVIDENCE";

  constructor(code: "NOT_FOUND" | "ZERO_EVIDENCE", message: string) {
    super(message);
    this.code = code;
    this.name = "OpportunityApprovalError";
  }
}

type ApproveOpportunityDb = {
  opportunity: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        evidenceCount: true;
      };
    }): Promise<{
      id: string;
      evidenceCount: number;
    } | null>;
    update(args: {
      where: { id: string };
      data: {
        status: "approved";
      };
      select: {
        id: true;
        status: true;
        evidenceCount: true;
      };
    }): Promise<{
      id: string;
      status: "suggested" | "approved" | "rejected";
      evidenceCount: number;
    }>;
  };
  reviewAction: {
    create(args: {
      data: {
        opportunityId: string;
        action: "approve";
        actorId: string;
        payloadJson: { reason: string };
      };
    }): Promise<unknown>;
  };
  auditLog: {
    create(args: unknown): Promise<unknown>;
  };
};

export async function approveOpportunity(
  opportunityId: string,
  actorId: string,
  db: ApproveOpportunityDb
) {
  const opportunity = await db.opportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      evidenceCount: true
    }
  });

  if (!opportunity) {
    throw new OpportunityApprovalError("NOT_FOUND", "Opportunity not found.");
  }

  if (opportunity.evidenceCount < 1) {
    throw new OpportunityApprovalError(
      "ZERO_EVIDENCE",
      "Cannot approve opportunity without linked evidence snippets."
    );
  }

  const updated = await db.opportunity.update({
    where: { id: opportunityId },
    data: {
      status: "approved"
    },
    select: {
      id: true,
      status: true,
      evidenceCount: true
    }
  });

  await db.reviewAction.create({
    data: {
      opportunityId,
      action: "approve",
      actorId,
      payloadJson: {
        reason: "approved_via_api"
      }
    }
  });
  await createAuditLog(db, {
    action: "review.approve",
    actorId,
    entityType: "opportunity",
    entityId: opportunityId,
    metadataJson: {
      reason: "approved_via_api"
    }
  });

  return updated;
}
