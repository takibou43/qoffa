/**
 * يهيّئ قاعدة بيانات الاختبارات مرة واحدة: يطبّق كل الهجرات.
 * يعتمد على DATABASE_URL من .env.test.
 */
import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

export default function setup() {
  const { parsed } = loadEnv({ path: '.env.test' });
  const dbUrl = parsed?.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL غير محدد في .env.test');

  execFileSync('node', ['scripts/migrate-apply.mjs'], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });
}
