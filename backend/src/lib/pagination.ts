import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const toSkipTake = ({ page, limit }: Pagination) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export function paginated<T>(items: T[], total: number, { page, limit }: Pagination) {
  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
    },
  };
}
