FROM node:20-alpine

WORKDIR /app/backend

# Install OpenSSL for Prisma and ts-node for backup script
RUN apk -U add --no-cache openssl curl

# Copy package files
COPY backend/package*.json ./
COPY backend/prisma ./prisma/

# Copy shared package
COPY shared ../shared

# Install all dependencies (including devDependencies) so build tools like TypeScript and Prisma are available
RUN npm install

# Copy source
COPY backend .

# Make start.sh executable (must be after COPY)
RUN chmod +x start.sh

# Use a build-time ARG for DATABASE_URL
ARG DATABASE_URL="file:./prisma/dev.db"
# Run prisma generate
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate
RUN npm run build

EXPOSE 3001
CMD ["sh", "start.sh"]
