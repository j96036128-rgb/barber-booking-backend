import { FastifyPluginAsync } from 'fastify';
import { AppointmentStatus, PaymentStatus, UserRole } from '@prisma/client';
import { differenceInHours, isAfter } from 'date-fns';
import { prisma } from '../db/prisma';
import { createAppointment } from '../services/appointment.service';
import { markNoShow, completeAppointment } from '../services/cancellation.service';
import { refundPayment } from '../services/payment.service';
import { CANCELLATION_POLICY } from '../config/cancellation';
import { ErrorCode } from '../services/types';
import { requireAuth, requireRole, requireBarberOwnsAppointment, requireBarberAccess, requireShopAccess } from '../middleware/auth';

function getStatusCodeForError(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.BARBER_NOT_FOUND:
    case ErrorCode.SERVICE_NOT_FOUND:
    case ErrorCode.CUSTOMER_NOT_FOUND:
    case ErrorCode.APPOINTMENT_NOT_FOUND:
      return 404;
    case ErrorCode.OVERLAPPING_APPOINTMENT:
    case ErrorCode.CONCURRENT_MODIFICATION:
      return 409;
    case ErrorCode.BOOKING_IN_PAST:
    case ErrorCode.BARBER_UNAVAILABLE:
    case ErrorCode.BARBER_NOT_ACTIVE:
    case ErrorCode.INVALID_DATE_RANGE:
    case ErrorCode.APPOINTMENT_ALREADY_CANCELLED:
    case ErrorCode.APPOINTMENT_ALREADY_COMPLETED:
    case ErrorCode.CANNOT_CANCEL_PAST_APPOINTMENT:
    case ErrorCode.CUSTOMER_BLOCKED:
      return 400;
    default:
      return 500;
  }
}

interface CreateAppointmentBody {
  barberId: string;
  customerId: string;
  serviceId: string;
  startTime: string;
}

export const appointmentRoutes: FastifyPluginAsync = async (server) => {
  // POST /appointments - Create a new appointment (authenticated users only)
  server.post<{ Body: CreateAppointmentBody }>(
    '/appointments',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { barberId, customerId, serviceId, startTime } = request.body;

      // Validate required fields
      if (!barberId || !customerId || !serviceId || !startTime) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: barberId, customerId, serviceId, startTime',
          },
        });
      }

      // Parse ISO date string
      const parsedStartTime = new Date(startTime);
      if (isNaN(parsedStartTime.getTime())) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid startTime format. Expected ISO 8601 date string.',
          },
        });
      }

      const result = await createAppointment(prisma, {
        barberId,
        customerId,
        serviceId,
        startTime: parsedStartTime,
      });

      if (!result.success) {
        const statusCode = getStatusCodeForError(result.error.code);
        return reply.status(statusCode).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
      }

      // Fetch the fully hydrated appointment to match GET response shape
      const hydratedAppointment = await prisma.appointment.findUnique({
        where: { id: result.data.id },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
        },
      });

      return reply.status(201).send(hydratedAppointment);
    }
  );

  // GET /appointments/me - Get appointments for the authenticated customer
  server.get(
    '/appointments/me',
    { preHandler: [requireAuth, requireRole(UserRole.CUSTOMER)] },
    async (request, reply) => {
      if (!request.user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const now = new Date();

      // Fetch upcoming appointments (startTime >= now, ordered ASC)
      const upcomingAppointments = await prisma.appointment.findMany({
        where: {
          customerId: request.user.userId,
          startTime: { gte: now },
        },
        orderBy: { startTime: 'asc' },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
          payment: true,
        },
      });

      // Fetch past appointments (startTime < now, ordered DESC)
      const pastAppointments = await prisma.appointment.findMany({
        where: {
          customerId: request.user.userId,
          startTime: { lt: now },
        },
        orderBy: { startTime: 'desc' },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
          payment: true,
        },
      });

      // Return upcoming first, then past
      return [...upcomingAppointments, ...pastAppointments];
    }
  );

  // GET /barbers/:barberId/appointments - Get appointments for a barber (barber or shop owner only)
  server.get<{ Params: { barberId: string } }>(
    '/barbers/:barberId/appointments',
    { preHandler: [requireAuth, requireBarberAccess] },
    async (request) => {
      const { barberId } = request.params;
      return prisma.appointment.findMany({
        where: { barberId },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
        },
      });
    }
  );

  // GET /shops/:shopId/appointments - Get all appointments for a shop (shop owner only)
  server.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/appointments',
    { preHandler: [requireAuth, requireShopAccess] },
    async (request) => {
      const { shopId } = request.params;
      return prisma.appointment.findMany({
        where: {
          barber: {
            shopId,
          },
        },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
        },
      });
    }
  );

  // POST /appointments/:id/cancel - Cancel an appointment with refund logic
  server.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/appointments/:id/cancel',
    { preHandler: [requireAuth, requireBarberOwnsAppointment] },
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.body || {};

      const appointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          payment: true,
        },
      });

      if (!appointment) {
        return reply.status(404).send({
          error: {
            code: 'APPOINTMENT_NOT_FOUND',
            message: 'Appointment not found',
          },
        });
      }

      // Cannot cancel if already cancelled, completed, or no-show
      if (
        appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.COMPLETED ||
        appointment.status === AppointmentStatus.NO_SHOW
      ) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_APPOINTMENT_STATE',
            message: `Appointment cannot be cancelled (current status: ${appointment.status})`,
          },
        });
      }

      // Cannot cancel after appointment has started
      if (isAfter(new Date(), appointment.startTime)) {
        return reply.status(400).send({
          error: {
            code: 'CANCELLATION_WINDOW_PASSED',
            message: 'Cannot cancel after appointment has started',
          },
        });
      }

      const hoursBeforeStart = differenceInHours(
        appointment.startTime,
        new Date()
      );

      // Determine if refund should be issued
      const shouldRefund =
        appointment.payment &&
        appointment.payment.status === PaymentStatus.PAID &&
        hoursBeforeStart >= CANCELLATION_POLICY.REFUND_CUTOFF_HOURS;

      // Perform refund FIRST (outside DB transaction) - Stripe handles idempotency
      if (shouldRefund && appointment.payment) {
        try {
          await refundPayment(appointment.payment.stripePaymentIntentId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return reply.status(500).send({
            error: {
              code: 'STRIPE_ERROR',
              message: `Failed to process refund: ${message}`,
            },
          });
        }
      }

      // Persist state changes in transaction
      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancellationReason: reason || null,
          },
        });

        if (appointment.payment) {
          await tx.payment.update({
            where: { id: appointment.payment.id },
            data: {
              status: shouldRefund
                ? PaymentStatus.REFUNDED
                : appointment.payment.status,
            },
          });
        }
      });

      // Fetch the fully hydrated appointment
      const hydratedAppointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
          payment: true,
        },
      });

      return hydratedAppointment;
    }
  );

  // POST /appointments/:id/no-show - Mark appointment as no-show (barber or shop owner only)
  server.post<{ Params: { id: string } }>(
    '/appointments/:id/no-show',
    { preHandler: [requireAuth, requireRole(UserRole.BARBER, UserRole.SHOP_OWNER, UserRole.ADMIN), requireBarberOwnsAppointment] },
    async (request, reply) => {
      const { id } = request.params;

      const result = await markNoShow(prisma, {
        appointmentId: id,
      });

      if (!result.success) {
        const statusCode = getStatusCodeForError(result.error.code);
        return reply.status(statusCode).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
      }

      // Fetch the fully hydrated appointment
      const hydratedAppointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
        },
      });

      return hydratedAppointment;
    }
  );

  // POST /appointments/:id/complete - Mark appointment as completed (barber or shop owner only)
  server.post<{ Params: { id: string } }>(
    '/appointments/:id/complete',
    { preHandler: [requireAuth, requireRole(UserRole.BARBER, UserRole.SHOP_OWNER, UserRole.ADMIN), requireBarberOwnsAppointment] },
    async (request, reply) => {
      const { id } = request.params;

      const result = await completeAppointment(prisma, id);

      if (!result.success) {
        const statusCode = getStatusCodeForError(result.error.code);
        return reply.status(statusCode).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
      }

      // Fetch the fully hydrated appointment
      const hydratedAppointment = await prisma.appointment.findUnique({
        where: { id },
        include: {
          customer: true,
          barber: {
            include: {
              user: true,
              shop: true,
            },
          },
          service: true,
        },
      });

      return hydratedAppointment;
    }
  );
};
