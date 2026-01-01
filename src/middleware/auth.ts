import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@prisma/client';
import { verifyToken, JwtPayload } from '../services/auth.service';
import { prisma } from '../db/prisma';

// Extend FastifyRequest to include user info
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload & {
      barberId?: string;
      shopId?: string;
    };
  }
}

/**
 * Middleware that requires a valid JWT token.
 * Extracts user info and attaches it to request.user
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      },
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const result = verifyToken(token);

  if (!result.success) {
    return reply.status(401).send({
      error: {
        code: result.error.code,
        message: result.error.message,
      },
    });
  }

  // Attach user info to request
  const payload = result.data;
  request.user = { ...payload };

  // If user is a barber, fetch their barberId
  if (payload.role === UserRole.BARBER) {
    const barber = await prisma.barber.findUnique({
      where: { userId: payload.userId },
    });
    if (barber) {
      request.user.barberId = barber.id;
      request.user.shopId = barber.shopId;
    }
  }

  // If user is a shop owner, fetch their shopId
  if (payload.role === UserRole.SHOP_OWNER) {
    const shop = await prisma.shop.findUnique({
      where: { ownerId: payload.userId },
    });
    if (shop) {
      request.user.shopId = shop.id;
    }
  }
}

/**
 * Creates a middleware that requires a specific role (or roles).
 * Must be used after requireAuth.
 *
 * @param allowedRoles - Single role or array of roles that are allowed
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!request.user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
        },
      });
    }
  };
}

/**
 * Middleware that ensures the authenticated user can only access their own resources.
 * Checks if the customerId in params matches the authenticated user's ID.
 */
export async function requireOwnResource(
  request: FastifyRequest<{ Params: { customerId?: string; id?: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  const { customerId } = request.params;

  // Customers can only access their own resources
  if (request.user.role === UserRole.CUSTOMER) {
    if (customerId && customerId !== request.user.userId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own resources',
        },
      });
    }
  }
}

/**
 * Middleware that checks if a barber can access an appointment.
 * Barbers can only access appointments where they are the assigned barber.
 */
export async function requireBarberOwnsAppointment(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  // Admins and shop owners bypass this check
  if (request.user.role === UserRole.ADMIN || request.user.role === UserRole.SHOP_OWNER) {
    return;
  }

  const { id: appointmentId } = request.params;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { barber: true },
  });

  if (!appointment) {
    return reply.status(404).send({
      error: {
        code: 'APPOINTMENT_NOT_FOUND',
        message: `Appointment with ID ${appointmentId} not found`,
      },
    });
  }

  // Barbers can only access their own appointments
  if (request.user.role === UserRole.BARBER) {
    if (appointment.barberId !== request.user.barberId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own appointments',
        },
      });
    }
  }

  // Customers can only access their own appointments
  if (request.user.role === UserRole.CUSTOMER) {
    if (appointment.customerId !== request.user.userId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own appointments',
        },
      });
    }
  }
}

/**
 * Middleware that checks if a user can access shop data.
 * Shop owners can only access their own shop's data.
 */
export async function requireShopAccess(
  request: FastifyRequest<{ Params: { shopId: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  // Admins can access all shops
  if (request.user.role === UserRole.ADMIN) {
    return;
  }

  const { shopId } = request.params;

  // Shop owners can only access their own shop
  if (request.user.role === UserRole.SHOP_OWNER) {
    if (shopId !== request.user.shopId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own shop data',
        },
      });
    }
    return;
  }

  // Barbers can access their shop's data
  if (request.user.role === UserRole.BARBER) {
    if (shopId !== request.user.shopId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own shop data',
        },
      });
    }
    return;
  }

  // Deny all other roles (including CUSTOMER)
  return reply.status(403).send({
    error: {
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this shop data',
    },
  });
}

/**
 * Middleware that checks if a barber can access barber-specific data.
 */
export async function requireBarberAccess(
  request: FastifyRequest<{ Params: { barberId: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  // Admins can access all barbers
  if (request.user.role === UserRole.ADMIN) {
    return;
  }

  const { barberId } = request.params;

  // Barbers can only access their own data
  if (request.user.role === UserRole.BARBER) {
    if (barberId !== request.user.barberId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access your own data',
        },
      });
    }
    return;
  }

  // Shop owners can access barbers in their shop
  if (request.user.role === UserRole.SHOP_OWNER) {
    const barber = await prisma.barber.findUnique({
      where: { id: barberId },
    });

    if (!barber || barber.shopId !== request.user.shopId) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'You can only access barbers in your shop',
        },
      });
    }
    return;
  }

  // Deny all other roles (including CUSTOMER)
  return reply.status(403).send({
    error: {
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this barber data',
    },
  });
}
