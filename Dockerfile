# منظومة المستفيدين - صورة إنتاج (Next.js standalone + SQLite مدمجة في Node).
# البيانات والصور لا تدخل الصورة أبدا: تُربط كمجلدات خارجية /data و /storage.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    STORAGE_DIR=/storage
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/lib ./lib
RUN mkdir -p /data /storage && chown node:node /data /storage
USER node
VOLUME ["/data", "/storage"]
EXPOSE 3000
CMD ["node", "server.js"]
