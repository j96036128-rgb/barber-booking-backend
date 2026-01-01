/**
 * Authentication Service
 *
 * Handles:
 * - User registration with password hashing
 * - User login with JWT token generation
 * - Token verification
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { ServiceResult, ErrorCode, success, failure } from './types';

// ============================================================================
// Configuration
// ============================================================================

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '24h'; // 24 hours for pilot security

// ============================================================================
// Types
// ============================================================================

export interface RegisterInput {
  email: string;
  password: string;
  role: UserRole;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
  };
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Registers a new user with hashed password.
 *
 * @param prisma - Prisma client instance
 * @param input - Registration data
 */
export async function registerUser(
  prisma: PrismaClient,
  input: RegisterInput
): Promise<ServiceResult<AuthResult>> {
  const { email, password, role } = input;

  try {
    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return failure(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'A user with this email already exists'
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role,
      },
    });

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return success({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to register user: ${error.message}`
      );
    }
    throw error;
  }
}

// ============================================================================
// Login
// ============================================================================

/**
 * Authenticates a user and returns a JWT token.
 *
 * @param prisma - Prisma client instance
 * @param input - Login credentials
 */
export async function loginUser(
  prisma: PrismaClient,
  input: LoginInput
): Promise<ServiceResult<AuthResult>> {
  const { email, password } = input;

  try {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return failure(
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password'
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return failure(
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password'
      );
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return success({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to login: ${error.message}`
      );
    }
    throw error;
  }
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Generates a JWT token for a user.
 */
function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies and decodes a JWT token.
 *
 * @param token - JWT token to verify
 */
export function verifyToken(token: string): ServiceResult<JwtPayload> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return success(decoded);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return failure(ErrorCode.UNAUTHORIZED, 'Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return failure(ErrorCode.UNAUTHORIZED, 'Invalid token');
    }
    return failure(ErrorCode.UNAUTHORIZED, 'Token verification failed');
  }
}
