# قُفّة — صورة خادم الـAPI (تعمل على Railway / Fly.io / VPS / أي منصة تدعم Docker)
FROM node:22-slim AS build
WORKDIR /app

# طبقة الاعتماديات أولًا للاستفادة من الكاش
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm install --workspace backend --include-workspace-root

COPY backend ./backend
RUN npm run db:generate -w backend && npm run build -w backend

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/scripts ./backend/scripts
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/package.json ./

EXPOSE 4000
# الهجرات تُطبَّق في خطوة منفصلة قبل النشر، لا عند كل إقلاع
CMD ["node", "backend/dist/index.js"]
