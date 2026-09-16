import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

/**
 * قُفّة — إعداد Prisma CLI (Prisma 7)
 * Prisma 7 لا يحتاج محركات Rust؛ المخطط والاستعلامات تُبنى عبر WASM + driver adapter (pg).
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
