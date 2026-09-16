import type { AdminAction } from '../generated/prisma/enums.js';
import { prisma, type Prisma } from '../lib/prisma.js';

interface AuditInput {
  actorId: string;
  action: AdminAction;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * يسجّل كل عملية إدارية حساسة.
 * يُكتب من الخادم فقط ولا يُعدَّل أو يُحذف عبر أي API.
 */
export async function audit(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  return client.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? undefined) as never,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
