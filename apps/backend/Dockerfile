FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate --schema prisma/schema.prisma
RUN npm run build
EXPOSE 3333
CMD ["node", "dist/src/main.js"]
