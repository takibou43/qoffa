import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';
import { parseDatabaseUrl } from './dbConfig.js';

// يُحلَّل الرابط بأنفسنا (لا نمرّر connectionString) كي:
//  - تعمل كلمات المرور ذات الرموز الخاصة غير المرمَّزة؛
//  - لا يتجاوز sslmode في الرابط إعداد ssl الصريح.
// عند توفر DATABASE_CA_CERT: اتصال مشفّر مع تحقق كامل من الشهادة واسم الخادم.
function poolConfig(): PoolConfig {
  const { params, ...conn } = parseDatabaseUrl(env.DATABASE_URL);
  const schema = params.get('schema');
  const options = schema ? `-c search_path=${schema}` : undefined;
  if (env.databaseCaCert) {
    return { ...conn, options, ssl: { ca: env.databaseCaCert, rejectUnauthorized: true, servername: conn.host } };
  }
  const sslmode = params.get('sslmode');
  if (sslmode && sslmode !== 'disable') return { ...conn, options, ssl: true };
  return { ...conn, options };
}

const adapter = new PrismaPg(poolConfig());

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type { Prisma } from '../generated/prisma/client.js';
