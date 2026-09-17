/**
 * قُفّة — نقطة دخول Serverless (Vercel).
 *
 * الخادم الطويل الأمد (Render/Docker/VPS) يستعمل src/index.ts ومعه مؤقّت المطابقة.
 * هنا لا يوجد مؤقّت، لذا تُشغَّل دورة المطابقة انتهازيًا عند طلبات الموصّلين والمحلات
 * (انظر maybeRunDispatchTick في services/driverAssignment.ts).
 */
import { createApp } from '../src/app.js';

const app = createApp();

export default app;
