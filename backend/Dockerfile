FROM node:20-alpine

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk -U add --no-cache openssl curl

COPY package*.json ./
# Install all dependencies (including devDependencies) so build tools like TypeScript and Prisma are available
RUN npm install

COPY prisma ./prisma/
COPY . .
# Use a build-time ARG for DATABASE_URL so we don't bake a runtime default into the image.
# If no value is provided at build time, fall back to a file-based SQLite DB for generation only.
ARG DATABASE_URL="file:./prisma/dev.db"
# Run prisma generate with the build ARG available as an environment variable for this RUN.
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate
RUN npm run build
# Remove devDependencies to keep the runtime image lean
RUN npm prune --production

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
