import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rawBody from 'fastify-raw-body';
import { authRoutes } from './routes/auth';
import { shopRoutes } from './routes/shops';
import { barberRoutes } from './routes/barbers';
import { serviceRoutes } from './routes/services';
import { availabilityRoutes } from './routes/availability';
import { appointmentRoutes } from './routes/appointments';
import { paymentRoutes } from './routes/payments';
import { webhookRoutes } from './routes/webhooks';
import { validatePaymentConfig } from './config/payments';
import { verifyStripeConnection } from './lib/stripe';

const server = Fastify({ logger: true });

// CORS configuration - restrict to allowed origins only
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:3001']; // Dev defaults

server.get('/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    // Validate configuration
    validatePaymentConfig();
    await verifyStripeConnection();

    // Register CORS - restrict to allowed origins only (no wildcards)
    await server.register(cors, {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Register rawBody plugin for Stripe webhook signature verification
    await server.register(rawBody, {
      field: 'rawBody',
      global: false, // Only attach rawBody when route config requests it
      encoding: false, // Keep as Buffer for Stripe
      runFirst: true,
    });

    // Register webhook routes FIRST (before other body parsers)
    await server.register(webhookRoutes);

    // Register other routes
    await server.register(authRoutes);
    await server.register(shopRoutes);
    await server.register(barberRoutes);
    await server.register(serviceRoutes);
    await server.register(availabilityRoutes);
    await server.register(appointmentRoutes);
    await server.register(paymentRoutes);

    await server.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
