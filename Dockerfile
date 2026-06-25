FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci && npm cache clean --force

COPY . .

RUN npm run prisma:generate --workspace agenda-metalique-backend
RUN npm run build:backend

EXPOSE 3333
CMD ["node", "apps/backend/dist/src/main.js"]
