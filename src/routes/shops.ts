import { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';

export async function shopRoutes(server: FastifyInstance) {
  server.get('/shops', async () => {
    const shops = await prisma.shop.findMany({
      include: {
        owner: true,
        barbers: true,
        services: true,
      },
    });

    return shops;
  });
}
