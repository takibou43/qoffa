import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { startDispatcher, stopDispatcher } from './services/driverAssignment.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`قُفّة API يعمل على http://localhost:${env.PORT} (${env.NODE_ENV})`);
  // مؤقّت مطابقة الموصّلين: ينهي العروض المنتهية وينتقل للموصّل التالي
  startDispatcher();
  console.log('مُشغّل مطابقة الموصّلين يعمل.');
});

async function shutdown(signal: string) {
  console.log(`\n${signal} — إيقاف الخادم...`);
  stopDispatcher();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
