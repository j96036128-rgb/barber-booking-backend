import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';

export async function serviceRoutes(server: FastifyInstance) {
  // GET /services
  server.get('/services', async () => {
    return prisma.service.findMany({
      include: {
        shop: true,
        barber: true,
      },
    });
  });

  // GET /shops/:shopId/services
  server.get('/shops/:shopId/services', async (request) => {
    const { shopId } = request.params as { shopId: string };

    return prisma.service.findMany({
      where: { shopId },
      include: {
        barber: true,
      },
    });
  });

  // GET /barbers/:barberId/services
  server.get('/barbers/:barberId/services', async (request) => {
    const { barberId } = request.params as { barberId: string };

    return prisma.service.findMany({
      where: { barberId },
      include: {
        shop: true,
      },
    });
  });
}
