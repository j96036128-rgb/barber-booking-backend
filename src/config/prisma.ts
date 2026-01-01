import { PrismaClient } from '@prisma/client';

// Reuse the Prisma client across hot reloads to avoid exhausting database connections in dev.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// In Prisma 7, connection configuration is handled via prisma.config.ts
// The PrismaClient constructor no longer accepts datasources option
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
