/**
 * Stripe Webhook Routes
 *
 * Handles Stripe webhook events for payment confirmation.
 * IMPORTANT: Uses raw body for signature verification.
 */

import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../db/prisma';
import { stripe } from '../lib/stripe';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const webhookRoutes: FastifyPluginAsync = async (server) => {
  // POST /webhooks/stripe - Handle Stripe webhook events
  server.post(
    '/webhooks/stripe',
    {
      config: {
        rawBody: true, // REQUIRED for Stripe signature verification
      },
    },
    async (request, reply) => {
      // Validate webhook secret is configured
      if (!WEBHOOK_SECRET) {
        server.log.error('STRIPE_WEBHOOK_SECRET is not configured');
        return reply.status(500).send('Webhook secret not configured');
      }

      const signature = request.headers['stripe-signature'];

      if (!signature || typeof signature !== 'string') {
        return reply.status(400).send('Missing Stripe signature');
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          request.rawBody as Buffer,
          signature,
          WEBHOOK_SECRET
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        server.log.error(`Webhook signature verification failed: ${message}`);
        return reply.status(400).send('Webhook signature verification failed');
      }

      server.log.info(`Received Stripe webhook: ${event.type}`);

      switch (event.type) {
        case 'payment_intent.succeeded': {
          const intent = event.data.object as Stripe.PaymentIntent;
          server.log.info(`Processing payment_intent.succeeded: ${intent.id}`);

          await prisma.$transaction(async (tx) => {
            const payment = await tx.payment.findUnique({
              where: { stripePaymentIntentId: intent.id },
            });

            // Idempotency: ignore if payment not found or already processed
            if (!payment) {
              server.log.warn(`Payment not found for intent: ${intent.id}`);
              return;
            }

            if (payment.status === 'PAID') {
              server.log.info(`Payment ${payment.id} already marked as PAID`);
              return;
            }

            // Update payment status to PAID
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'PAID' },
            });

            // Update appointment status to CONFIRMED
            if (payment.appointmentId) {
              await tx.appointment.update({
                where: { id: payment.appointmentId },
                data: { status: 'CONFIRMED' },
              });
              server.log.info(
                `Appointment ${payment.appointmentId} confirmed after payment`
              );
            }
          });

          break;
        }

        case 'payment_intent.payment_failed': {
          const intent = event.data.object as Stripe.PaymentIntent;
          server.log.info(`Processing payment_intent.payment_failed: ${intent.id}`);

          // Update payment status to FAILED (only if still pending)
          const result = await prisma.payment.updateMany({
            where: {
              stripePaymentIntentId: intent.id,
              status: 'REQUIRES_PAYMENT',
            },
            data: { status: 'FAILED' },
          });

          if (result.count > 0) {
            server.log.info(`Marked payment as FAILED for intent: ${intent.id}`);
          }

          break;
        }

        default:
          // Ignore other events safely
          server.log.info(`Ignoring unhandled event type: ${event.type}`);
          break;
      }

      return reply.status(200).send({ received: true });
    }
  );
};
