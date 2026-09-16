import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// تحميل متغيرات بيئة الاختبار قبل أي استيراد داخل الاختبارات
const { parsed } = loadEnv({ path: '.env.test' });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // الاختبارات تشترك في قاعدة بيانات واحدة، لذا نمنع التوازي بين الملفات
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    env: { ...(parsed ?? {}) },
  },
});
