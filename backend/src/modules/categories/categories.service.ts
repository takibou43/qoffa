import { prisma } from '../../lib/prisma.js';
import type { CategoryKind } from '../../generated/prisma/enums.js';

export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  iconKey: true,
  sortOrder: true,
} as const;

export function listCategories(kind?: CategoryKind) {
  return prisma.category.findMany({
    where: kind ? { kind } : undefined,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: categorySelect,
  });
}
