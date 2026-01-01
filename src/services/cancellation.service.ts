/**
 * Cancellation & No-Show Service
 *
 * Handles:
 * - Appointment cancellation with late cancellation detection
 * - No-show detection and flagging
 * - NoShowFlag count management for customers
 * - Appointment status transitions
 */

import { PrismaClient, AppointmentStatus } from '@prisma/client';
import {
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,
  CancelAppointmentInput,
  CancellationResult,
  MarkNoShowInput,
  NoShowResult,
  ServiceResult,
  ErrorCode,
  success,
  failure,
  differenceInHours,
} from './types';
import { NO_SHOW_POLICY } from '../config/noShow';

// ============================================================================
// Cancellation Service
// ============================================================================

/**
 * Cancels an appointment with late cancellation detection.
 *
 * Late cancellation is determined by comparing the current time against
 * the appointment start time. If the cancellation happens within the
 * configured cutoff period (default: 6 hours), it's marked as late.
 *
 * @param prisma - Prisma client instance
 * @param input - Cancellation parameters
 * @param config - Optional configuration overrides
 */
export async function cancelAppointment(
  prisma: PrismaClient,
  input: CancelAppointmentInput,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<CancellationResult>> {
  const mergedConfig = { ...DEFAULT_BOOKING_CONFIG, ...config };
  const { appointmentId, reason } = input;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Fetch the appointment with lock
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        return failure<CancellationResult>(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          `Appointment with ID ${appointmentId} not found`
        );
      }

      // Validate current status
      if (appointment.status === AppointmentStatus.CANCELLED) {
        return failure<CancellationResult>(
          ErrorCode.APPOINTMENT_ALREADY_CANCELLED,
          'This appointment has already been cancelled'
        );
      }

      if (appointment.status === AppointmentStatus.COMPLETED) {
        return failure<CancellationResult>(
          ErrorCode.APPOINTMENT_ALREADY_COMPLETED,
          'Cannot cancel a completed appointment'
        );
      }

      if (appointment.status === AppointmentStatus.NO_SHOW) {
        return failure<CancellationResult>(
          ErrorCode.APPOINTMENT_ALREADY_COMPLETED,
          'Cannot cancel an appointment marked as no-show'
        );
      }

      // Check if the appointment has already started
      if (appointment.startTime <= now) {
        return failure<CancellationResult>(
          ErrorCode.CANNOT_CANCEL_PAST_APPOINTMENT,
          'Cannot cancel an appointment that has already started or passed',
          {
            appointmentStart: appointment.startTime.toISOString(),
            currentTime: now.toISOString(),
          }
        );
      }

      // Determine if this is a late cancellation
      const hoursUntilAppointment = differenceInHours(appointment.startTime, now);
      const wasLateCancellation = hoursUntilAppointment < mergedConfig.lateCancellationHours;

      // Update the appointment status
      await tx.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: reason ?? (wasLateCancellation ? 'Late cancellation' : 'Cancelled by user'),
        },
      });

      return success<CancellationResult>({
        appointmentId,
        status: AppointmentStatus.CANCELLED,
        wasLateCancellation,
      });
    });

    return result;

  } catch (error) {
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to cancel appointment: ${error.message}`
      );
    }
    throw error;
  }
}

// ============================================================================
// No-Show Service
// ============================================================================

/**
 * Marks an appointment as a no-show and increments the customer's no-show count.
 *
 * This function should be called after an appointment's end time has passed
 * and the customer did not show up. It updates both the appointment status
 * and the customer's NoShowFlag record.
 *
 * @param prisma - Prisma client instance
 * @param input - No-show marking parameters
 */
export async function markNoShow(
  prisma: PrismaClient,
  input: MarkNoShowInput
): Promise<ServiceResult<NoShowResult>> {
  const { appointmentId } = input;
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Fetch the appointment
      const appointment = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { customer: true },
      });

      if (!appointment) {
        return failure<NoShowResult>(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          `Appointment with ID ${appointmentId} not found`
        );
      }

      // Can only mark as no-show if currently BOOKED
      if (appointment.status !== AppointmentStatus.BOOKED) {
        return failure<NoShowResult>(
          ErrorCode.APPOINTMENT_ALREADY_COMPLETED,
          `Cannot mark as no-show: appointment status is ${appointment.status}`,
          { currentStatus: appointment.status }
        );
      }

      // The appointment must have passed (at least the start time)
      // Typically you'd wait until end time, but start time is the minimum requirement
      if (appointment.startTime > now) {
        return failure<NoShowResult>(
          ErrorCode.BOOKING_IN_PAST, // Reusing code for timing-related errors
          'Cannot mark as no-show: appointment has not yet started',
          {
            appointmentStart: appointment.startTime.toISOString(),
            currentTime: now.toISOString(),
          }
        );
      }

      // Update appointment status
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.NO_SHOW },
      });

      // Upsert NoShowFlag - increment count or create if doesn't exist
      const noShowFlag = await tx.noShowFlag.upsert({
        where: { customerId: appointment.customerId },
        update: {
          count: { increment: 1 },
          lastFlaggedAt: now,
        },
        create: {
          customerId: appointment.customerId,
          count: 1,
          lastFlaggedAt: now,
        },
      });

      return success<NoShowResult>({
        appointmentId,
        customerId: appointment.customerId,
        noShowCount: noShowFlag.count,
      });
    });

    return result;

  } catch (error) {
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to mark no-show: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Marks an appointment as completed.
 *
 * This should be called when a customer successfully completes their appointment.
 *
 * @param prisma - Prisma client instance
 * @param appointmentId - The ID of the appointment to complete
 */
export async function completeAppointment(
  prisma: PrismaClient,
  appointmentId: string
): Promise<ServiceResult<{ appointmentId: string; status: AppointmentStatus }>> {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      return failure(
        ErrorCode.APPOINTMENT_NOT_FOUND,
        `Appointment with ID ${appointmentId} not found`
      );
    }

    if (appointment.status !== AppointmentStatus.BOOKED) {
      return failure(
        ErrorCode.APPOINTMENT_ALREADY_COMPLETED,
        `Cannot complete: appointment status is ${appointment.status}`,
        { currentStatus: appointment.status }
      );
    }

    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.COMPLETED },
    });

    return success({
      appointmentId,
      status: AppointmentStatus.COMPLETED,
    });

  } catch (error) {
    if (error instanceof Error) {
      return failure(
        ErrorCode.INTERNAL_ERROR,
        `Failed to complete appointment: ${error.message}`
      );
    }
    throw error;
  }
}

// ============================================================================
// Automatic No-Show Detection
// ============================================================================

/**
 * Detects and marks no-shows for appointments that have passed.
 *
 * This function is designed to be called by a scheduled job (cron).
 * It finds all BOOKED appointments where the end time has passed
 * and marks them as NO_SHOW.
 *
 * @param prisma - Prisma client instance
 * @param gracePeriodMinutes - Minutes after end time before marking as no-show (default: 15)
 * @returns Array of processed appointment results
 */
export async function detectAndMarkNoShows(
  prisma: PrismaClient,
  gracePeriodMinutes: number = 15
): Promise<{
  processed: number;
  results: Array<{ appointmentId: string; success: boolean; error?: string }>;
}> {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - gracePeriodMinutes * 60 * 1000);

  // Find all BOOKED appointments where endTime + grace period has passed
  const overdueAppointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.BOOKED,
      endTime: { lt: cutoffTime },
    },
    orderBy: { endTime: 'asc' },
  });

  const results: Array<{ appointmentId: string; success: boolean; error?: string }> = [];

  // Process each overdue appointment
  // We process them individually to ensure partial failures don't block the entire batch
  for (const appointment of overdueAppointments) {
    const markResult = await markNoShow(prisma, { appointmentId: appointment.id });

    if (markResult.success) {
      results.push({ appointmentId: appointment.id, success: true });
    } else {
      results.push({
        appointmentId: appointment.id,
        success: false,
        error: markResult.error.message,
      });
    }
  }

  return {
    processed: overdueAppointments.length,
    results,
  };
}

// ============================================================================
// Customer No-Show Status Queries
// ============================================================================

/**
 * Gets the no-show count for a customer.
 *
 * @param prisma - Prisma client instance
 * @param customerId - The customer's user ID
 */
export async function getCustomerNoShowCount(
  prisma: PrismaClient,
  customerId: string
): Promise<ServiceResult<{ count: number; lastFlaggedAt: Date | null }>> {
  const noShowFlag = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  if (!noShowFlag) {
    return success({ count: 0, lastFlaggedAt: null });
  }

  return success({
    count: noShowFlag.count,
    lastFlaggedAt: noShowFlag.lastFlaggedAt,
  });
}

/**
 * Resets a customer's no-show count.
 *
 * Useful for admin operations or when a customer appeals their no-show flags.
 *
 * @param prisma - Prisma client instance
 * @param customerId - The customer's user ID
 */
export async function resetNoShowCount(
  prisma: PrismaClient,
  customerId: string
): Promise<ServiceResult<{ previousCount: number }>> {
  const noShowFlag = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  if (!noShowFlag) {
    return success({ previousCount: 0 });
  }

  const previousCount = noShowFlag.count;

  await prisma.noShowFlag.update({
    where: { customerId },
    data: {
      count: 0,
      lastFlaggedAt: null,
    },
  });

  return success({ previousCount });
}

/**
 * Checks if a customer is blocked from booking due to excessive no-shows.
 *
 * @param prisma - Prisma client instance
 * @param customerId - The customer's user ID
 * @param maxNoShows - Maximum allowed no-shows before blocking (default: 3)
 */
export async function isCustomerBlocked(
  prisma: PrismaClient,
  customerId: string,
  maxNoShows: number = 3
): Promise<ServiceResult<{ blocked: boolean; noShowCount: number }>> {
  const result = await getCustomerNoShowCount(prisma, customerId);

  if (!result.success) {
    return result as ServiceResult<{ blocked: boolean; noShowCount: number }>;
  }

  return success({
    blocked: result.data.count >= maxNoShows,
    noShowCount: result.data.count,
  });
}

// ============================================================================
// Phase 6.2: Automated No-Show Detection for CONFIRMED Appointments
// ============================================================================

export interface NoShowDetectionResult {
  scanned: number;
  markedAsNoShow: number;
  details: Array<{
    appointmentId: string;
    customerId: string;
    noShowCount: number;
  }>;
}

/**
 * Detects and marks no-shows for CONFIRMED appointments past the grace period.
 *
 * This function is idempotent - running it multiple times will not
 * produce duplicate changes since it only processes CONFIRMED appointments.
 *
 * Criteria for marking as no-show:
 * - Appointment status is CONFIRMED (payment was made)
 * - Current time > startTime + GRACE_PERIOD_MINUTES
 *
 * Actions taken:
 * - Sets appointment.status = NO_SHOW
 * - Increments customer's no-show count
 * - Payment remains PAID (deposit forfeited)
 *
 * @param prisma - Prisma client instance
 * @returns Detection results with counts and details
 */
export async function detectNoShows(
  prisma: PrismaClient
): Promise<NoShowDetectionResult> {
  const now = new Date();
  const gracePeriodMs = NO_SHOW_POLICY.GRACE_PERIOD_MINUTES * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - gracePeriodMs);

  // Find all CONFIRMED appointments where startTime + grace period has passed
  const eligibleAppointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.CONFIRMED,
      startTime: { lt: cutoffTime },
    },
    orderBy: { startTime: 'asc' },
  });

  const details: NoShowDetectionResult['details'] = [];

  // Process each eligible appointment
  for (const appointment of eligibleAppointments) {
    // Use transaction for atomicity of status change + no-show count increment
    const result = await prisma.$transaction(async (tx) => {
      // Update appointment status to NO_SHOW
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.NO_SHOW },
      });

      // Upsert NoShowFlag - increment count or create if doesn't exist
      const noShowFlag = await tx.noShowFlag.upsert({
        where: { customerId: appointment.customerId },
        update: {
          count: { increment: 1 },
          lastFlaggedAt: now,
        },
        create: {
          customerId: appointment.customerId,
          count: 1,
          lastFlaggedAt: now,
        },
      });

      return {
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        noShowCount: noShowFlag.count,
      };
    });

    details.push(result);
  }

  return {
    scanned: eligibleAppointments.length,
    markedAsNoShow: details.length,
    details,
  };
}
