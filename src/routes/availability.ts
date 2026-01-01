import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/prisma';
import { getBookableSlots } from '../services/availability.service';
import { ErrorCode } from '../services/types';
import { requireAuth, requireBarberAccess, requireShopAccess } from '../middleware/auth';

function getStatusCodeForError(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.BARBER_NOT_FOUND:
      return 404;
    case ErrorCode.BARBER_NOT_ACTIVE:
    case ErrorCode.INVALID_DATE_RANGE:
      return 400;
    default:
      return 500;
  }
}

interface SlotsQuerystring {
  startDate: string;
  endDate: string;
  serviceId: string;
}

export const availabilityRoutes: FastifyPluginAsync = async (server) => {
  // GET /barbers/:barberId/availability - Get barber's availability (barber or shop owner)
  server.get<{ Params: { barberId: string } }>(
    '/barbers/:barberId/availability',
    { preHandler: [requireAuth, requireBarberAccess] },
    async (request) => {
      const { barberId } = request.params;
      return prisma.availability.findMany({
        where: { barberId },
      });
    }
  );

  // GET /shops/:shopId/availability - Get all availability for a shop (shop owner)
  server.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/availability',
    { preHandler: [requireAuth, requireShopAccess] },
    async (request) => {
      const { shopId } = request.params;
      return prisma.availability.findMany({
        where: {
          barber: {
            shopId,
          },
        },
      });
    }
  );

  // GET /barbers/:barberId/slots - Get bookable time slots
  server.get<{ Params: { barberId: string }; Querystring: SlotsQuerystring }>(
    '/barbers/:barberId/slots',
    async (request, reply) => {
      const { barberId } = request.params;
      const { startDate, endDate, serviceId } = request.query;

      // Validate required query params
      if (!startDate || !endDate || !serviceId) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required query parameters: startDate, endDate, serviceId',
          },
        });
      }

      // Parse dates
      const parsedStartDate = new Date(startDate);
      const parsedEndDate = new Date(endDate);

      if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid date format. Expected ISO 8601 date strings.',
          },
        });
      }

      // Fetch service to get duration
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
      });

      if (!service) {
        return reply.status(404).send({
          error: {
            code: 'SERVICE_NOT_FOUND',
            message: `Service with ID ${serviceId} not found`,
          },
        });
      }

      const result = await getBookableSlots(
        prisma,
        {
          barberId,
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          serviceDurationMinutes: service.durationMinutes,
        },
        15 // 15-minute slot intervals
      );

      if (!result.success) {
        const statusCode = getStatusCodeForError(result.error.code);
        return reply.status(statusCode).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
      }

      return result.data;
    }
  );
};
