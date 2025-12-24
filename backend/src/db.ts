/**
 * Centralized Prisma Client with Prisma 7 driver adapter
 * 
 * Prisma 7 requires a driver adapter for database connections.
 * This file creates a single shared PrismaClient instance.
 */

import { PrismaClient } from './generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

// Create the driver adapter with the database URL
const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || 'file:./dev.db'
})

// Create the PrismaClient with the adapter
export const prisma = new PrismaClient({ adapter })

// Export as default for convenience
export default prisma
