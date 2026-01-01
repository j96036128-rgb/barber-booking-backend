/**
 * Payment Service
 *
 * Handles Stripe PaymentIntent creation for appointment deposits.
 */

import { AppointmentStatus, UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import { stripe } from '../lib/stripe';
import { DEPOSIT_AMOUNT_CENTS, PAYMENT_CURRENCY } from '../config/payments';
import { ServiceResult, ErrorCode, success, failure } from './types';

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  barberId?: string;
  shopId?: string;
}

export interface CreatePaymentIntentInput {
  appointmentId: string;
  user: AuthUser;
}

export interface PaymentIntentResult {
  clientSecret: string;
}

// ============================================================================
// PaymentIntent Creation
// ============================================================================

/**
 * Creates a Stripe PaymentIntent for an appointment deposit.
 *
 * Authorization:
 * - CUSTOMER: must own the appointment
 * - BARBER: must be assigned to the appointment
 * - SHOP_OWNER: must own the shop where the appointment is booked
 * - ADMIN: can create for any appointment
 *
 * Validations:
 * - Appointment must exist
 * - Appointment status must be BOOKED
 * - No existing payment for this appointment
 */
export async function createPaymentIntentForAppointment(
  input: CreatePaymentIntentInput
): Promise<ServiceResult<PaymentIntentResult>> {
  const { appointmentId, user } = input;

  try {
    // Fetch appointment with relations
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        customer: true,
        barber: {
          include: {
            shop: true,
          },
        },
        payment: true,
      },
    });

    // Check appointment exists
    if (!appointment) {
      return failure(
        ErrorCode.APPOINTMENT_NOT_FOUND,
        `Appointment with ID ${appointmentId} not found`
      );
    }

    // Authorization check
    const authResult = checkAuthorization(appointment, user);
    if (!authResult.authorized) {
      return failure(ErrorCode.FORBIDDEN, authResult.message);
    }

    // Validate appointment status
    if (appointment.status !== AppointmentStatus.BOOKED) {
      return failure(
        ErrorCode.INVALID_APPOINTMENT_STATE,
        `Cannot create payment for appointment with status ${appointment.status}. Only BOOKED appointments can be paid.`
      );
    }

    // Check for existing payment
    if (appointment.payment) {
      return failure(
        ErrorCode.PAYMENT_ALREADY_EXISTS,
        `A payment already exists for appointment ${appointmentId}`
      );
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: DEPOSIT_AMOUNT_CENTS,
      currency: PAYMENT_CURRENCY,
      payment_method_types: ['card'],
      metadata: {
        appointmentId: appointment.id,
        customerId: appointment.customerId,
      },
    });

    // Persist Payment record
    await prisma.payment.create({
      data: {
        stripePaymentIntentId: paymentIntent.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        currency: PAYMENT_CURRENCY,
        status: 'REQUIRES_PAYMENT',
        customerId: appointment.customerId,
        appointmentId: appointment.id,
      },
    });

    return success({
      clientSecret: paymentIntent.client_secret!,
    });
  } catch (error) {
    // Handle Stripe errors
    if (error && typeof error === 'object' && 'type' in error) {
      const stripeError = error as { type: string; message?: string };
      if (stripeError.type.startsWith('Stripe')) {
        return failure(
          ErrorCode.STRIPE_ERROR,
          `Stripe error: ${stripeError.message || 'Unknown Stripe error'}`
        );
      }
    }

    // Handle other errors
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to create payment intent: ${error.message}`
      );
    }

    throw error;
  }
}

// ============================================================================
// Refund
// ============================================================================

/**
 * Refunds a payment via Stripe.
 *
 * This function calls Stripe directly and does NOT update the database.
 * The caller is responsible for updating payment status after a successful refund.
 *
 * Stripe handles idempotency - calling this multiple times for the same
 * payment intent is safe.
 *
 * @param paymentIntentId - The Stripe PaymentIntent ID to refund
 */
export async function refundPayment(paymentIntentId: string) {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
  });
}

// ============================================================================
// Authorization Helper
// ============================================================================

interface AuthorizationResult {
  authorized: boolean;
  message: string;
}

interface AppointmentWithRelations {
  customerId: string;
  barberId: string;
  barber: {
    shop: {
      id: string;
    };
  };
}

function checkAuthorization(
  appointment: AppointmentWithRelations,
  user: AuthUser
): AuthorizationResult {
  // ADMIN can access any appointment
  if (user.role === UserRole.ADMIN) {
    return { authorized: true, message: '' };
  }

  // CUSTOMER must own the appointment
  if (user.role === UserRole.CUSTOMER) {
    if (appointment.customerId !== user.userId) {
      return {
        authorized: false,
        message: 'You can only create payments for your own appointments',
      };
    }
    return { authorized: true, message: '' };
  }

  // BARBER must be assigned to the appointment
  if (user.role === UserRole.BARBER) {
    if (appointment.barberId !== user.barberId) {
      return {
        authorized: false,
        message: 'You can only create payments for your own appointments',
      };
    }
    return { authorized: true, message: '' };
  }

  // SHOP_OWNER must own the shop
  if (user.role === UserRole.SHOP_OWNER) {
    if (appointment.barber.shop.id !== user.shopId) {
      return {
        authorized: false,
        message: 'You can only create payments for appointments in your shop',
      };
    }
    return { authorized: true, message: '' };
  }

  // Deny by default
  return {
    authorized: false,
    message: 'You do not have permission to create payments',
  };
}
