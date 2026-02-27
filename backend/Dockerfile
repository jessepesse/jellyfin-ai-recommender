FROM node:25-slim

WORKDIR /app/backend

# Install OpenSSL for Prisma, curl, sqlite3 for migration checks, and build tools for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y openssl curl sqlite3 python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
COPY backend/prisma.config.ts ./

# Copy shared package
COPY shared ../shared

# Install all dependencies (including devDependencies) so build tools like TypeScript and Prisma are available
RUN npm install

# Copy source
COPY backend .

# Make start.sh executable (must be after COPY)
RUN chmod +x start.sh

# Run prisma generate (Prisma 7 uses prisma.config.ts for datasource URL)
RUN DATABASE_URL="file:./prisma/dev.db" npx prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "start.sh"]
