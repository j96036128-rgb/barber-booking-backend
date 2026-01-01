/**
 * Payment Routes
 *
 * Handles payment-related API endpoints.
 */

import { FastifyPluginAsync } from 'fastify';
import { createPaymentIntentForAppointment } from '../services/payment.service';
import { ErrorCode } from '../services/types';
import { requireAuth } from '../middleware/auth';

function getStatusCodeForError(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.APPOINTMENT_NOT_FOUND:
      return 404;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.INVALID_APPOINTMENT_STATE:
      return 400;
    case ErrorCode.PAYMENT_ALREADY_EXISTS:
      return 409;
    case ErrorCode.STRIPE_ERROR:
    case ErrorCode.INTERNAL_ERROR:
    default:
      return 500;
  }
}

export const paymentRoutes: FastifyPluginAsync = async (server) => {
  // POST /appointments/:id/pay - Create a PaymentIntent for an appointment deposit
  server.post<{ Params: { id: string } }>(
    '/appointments/:id/pay',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: appointmentId } = request.params;

      if (!request.user) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        });
      }

      const result = await createPaymentIntentForAppointment({
        appointmentId,
        user: request.user,
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

      return reply.status(200).send({
        clientSecret: result.data.clientSecret,
      });
    }
  );
};
