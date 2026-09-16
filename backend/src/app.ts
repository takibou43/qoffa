import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { apiRouter } from './routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // الواجهات تُخدَّم من نطاقات منفصلة، لا نحتاج CSP هنا
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // طلبات بدون origin (curl، تطبيقات الجوال، health checks)
        if (!origin) return callback(null, true);
        if (env.corsOrigins.length === 0 || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error('CORS: النطاق غير مسموح به'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(generalLimiter);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'qoffa-api', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
