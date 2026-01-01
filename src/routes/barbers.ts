import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';

export async function barberRoutes(server: FastifyInstance) {
  // GET /barbers
  server.get('/barbers', async () => {
    return prisma.barber.findMany({
      include: {
        user: true,
        shop: true,
        services: true,
      },
    });
  });

  // GET /shops/:shopId/barbers
  server.get('/shops/:shopId/barbers', async (request) => {
    const { shopId } = request.params as { shopId: string };

    return prisma.barber.findMany({
      where: { shopId },
      include: {
        user: true,
        services: true,
      },
    });
  });
}
