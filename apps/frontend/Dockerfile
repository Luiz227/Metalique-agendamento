FROM node:20-bookworm-slim AS deps
WORKDIR /app/apps/frontend
COPY package*.json ./
RUN npm install

FROM node:20-bookworm-slim AS builder
WORKDIR /app/apps/frontend
COPY --from=deps /app/apps/frontend/node_modules ./node_modules
COPY . ./
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./.next/static
EXPOSE 3010
CMD ["node", "server.js"]
