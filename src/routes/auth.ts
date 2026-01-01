import { FastifyPluginAsync } from 'fastify';
import { UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { registerUser, loginUser } from '../services/auth.service';
import { ErrorCode } from '../services/types';

function getStatusCodeForError(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.EMAIL_ALREADY_EXISTS:
      return 409;
    case ErrorCode.INVALID_CREDENTIALS:
      return 401;
    case ErrorCode.UNAUTHORIZED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    default:
      return 500;
  }
}

interface RegisterBody {
  email: string;
  password: string;
  role: UserRole;
}

interface LoginBody {
  email: string;
  password: string;
}

export const authRoutes: FastifyPluginAsync = async (server) => {
  // POST /auth/register - Register a new user
  server.post<{ Body: RegisterBody }>(
    '/auth/register',
    async (request, reply) => {
      const { email, password, role } = request.body;

      // Validate required fields
      if (!email || !password || !role) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: email, password, role',
          },
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid email format',
          },
        });
      }

      // Validate password length
      if (password.length < 8) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 8 characters long',
          },
        });
      }

      // Validate role
      const validRoles = Object.values(UserRole);
      if (!validRoles.includes(role)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
          },
        });
      }

      const result = await registerUser(prisma, { email, password, role });

      if (!result.success) {
        const statusCode = getStatusCodeForError(result.error.code);
        return reply.status(statusCode).send({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        });
      }

      return reply.status(201).send(result.data);
    }
  );

  // POST /auth/login - Login and get JWT token
  server.post<{ Body: LoginBody }>(
    '/auth/login',
    async (request, reply) => {
      const { email, password } = request.body;

      // Validate required fields
      if (!email || !password) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Missing required fields: email, password',
          },
        });
      }

      const result = await loginUser(prisma, { email, password });

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
