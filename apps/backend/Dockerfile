FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci
COPY apps/backend ./apps/backend
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma
RUN npm run build --workspace apps/backend
EXPOSE 3333
CMD ["node", "apps/backend/dist/main.js"]
