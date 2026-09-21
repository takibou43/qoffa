import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

// عند توفر شهادة CA: اتصال مشفّر مع تحقق كامل من الشهادة واسم الخادم.
// sslmode في الرابط يتجاوز إعداد ssl في pg، لذلك يُزال حين نمرّر الشهادة صراحة.
function poolConfig() {
  if (!env.databaseCaCert) return { connectionString: env.DATABASE_URL };
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: { ca: env.databaseCaCert, rejectUnauthorized: true },
  };
}

const adapter = new PrismaPg(poolConfig());

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type { Prisma } from '../generated/prisma/client.js';
