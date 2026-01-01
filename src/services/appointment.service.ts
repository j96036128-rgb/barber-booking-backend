/**
 * Appointment Booking Service
 *
 * Handles safe creation of appointments with:
 * - Overlap prevention for the same barber
 * - Availability checks (weekly + exception days)
 * - Configurable buffer time between appointments
 * - Prevention of booking in the past
 * - Concurrent booking safety via Prisma transactions
 */

import { PrismaClient, AppointmentStatus, Availability } from '@prisma/client';
import {
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,
  CreateAppointmentInput,
  CreatedAppointment,
  ServiceResult,
  ErrorCode,
  success,
  failure,
  doTimeRangesOverlap,
  combineDateAndTime,
  getDayOfWeek,
  startOfDay,
  endOfDay,
  addMinutes,
} from './types';
import { isCustomerBlocked } from './cancellation.service';

// ============================================================================
// Main Booking Service
// ============================================================================

/**
 * Creates a new appointment with full validation and concurrency safety.
 *
 * Uses Prisma interactive transactions to ensure:
 * 1. Atomicity - all checks and creation happen in one transaction
 * 2. Isolation - prevents concurrent booking race conditions
 * 3. Consistency - all business rules are enforced
 *
 * @param prisma - Prisma client instance
 * @param input - Appointment creation parameters
 * @param config - Optional booking configuration overrides
 */
export async function createAppointment(
  prisma: PrismaClient,
  input: CreateAppointmentInput,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<CreatedAppointment>> {
  const mergedConfig = { ...DEFAULT_BOOKING_CONFIG, ...config };
  const { barberId, customerId, serviceId, startTime } = input;

  // ---- Pre-transaction validation (fail fast for obvious issues) ----

  // Check 1: Prevent booking in the past
  const now = new Date();
  if (startTime <= now) {
    return failure(
      ErrorCode.BOOKING_IN_PAST,
      'Cannot book appointments in the past',
      { requestedTime: startTime.toISOString(), currentTime: now.toISOString() }
    );
  }

  // Check 2: Prevent booking if customer has too many no-shows
  const blockedResult = await isCustomerBlocked(prisma, customerId);
  if (blockedResult.success && blockedResult.data.blocked) {
    return failure(
      ErrorCode.CUSTOMER_BLOCKED,
      'Your account has been temporarily blocked due to missed appointments. Please contact support.',
      { noShowCount: blockedResult.data.noShowCount }
    );
  }

  // ---- Main transaction with serializable isolation for race condition prevention ----
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Fetch barber with lock to prevent concurrent modifications
      const barber = await tx.barber.findUnique({
        where: { id: barberId },
        include: { availability: true },
      });

      if (!barber) {
        return failure<CreatedAppointment>(
          ErrorCode.BARBER_NOT_FOUND,
          `Barber with ID ${barberId} not found`
        );
      }

      if (!barber.active) {
        return failure<CreatedAppointment>(
          ErrorCode.BARBER_NOT_ACTIVE,
          'This barber is not currently accepting appointments'
        );
      }

      // Fetch service to get duration
      const service = await tx.service.findUnique({
        where: { id: serviceId },
      });

      if (!service) {
        return failure<CreatedAppointment>(
          ErrorCode.SERVICE_NOT_FOUND,
          `Service with ID ${serviceId} not found`
        );
      }

      // Verify customer exists
      const customer = await tx.user.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        return failure<CreatedAppointment>(
          ErrorCode.CUSTOMER_NOT_FOUND,
          `Customer with ID ${customerId} not found`
        );
      }

      // Calculate appointment end time based on service duration
      const endTime = addMinutes(startTime, service.durationMinutes);

      // Check 2: Verify barber availability for the requested time slot
      const availabilityCheck = checkBarberAvailability(
        barber.availability,
        startTime,
        endTime
      );

      if (!availabilityCheck.available) {
        return failure<CreatedAppointment>(
          ErrorCode.BARBER_UNAVAILABLE,
          availabilityCheck.reason,
          { requestedStart: startTime.toISOString(), requestedEnd: endTime.toISOString() }
        );
      }

      // Check 3: Prevent overlapping appointments (with buffer time)
      // Expand the time range to include buffer on both ends
      const bufferMs = mergedConfig.bufferMinutes * 60 * 1000;
      const searchStart = new Date(startTime.getTime() - bufferMs);
      const searchEnd = new Date(endTime.getTime() + bufferMs);

      const overlappingAppointments = await tx.appointment.findMany({
        where: {
          barberId,
          status: { in: [AppointmentStatus.BOOKED] }, // Only consider active bookings
          OR: [
            // Appointment starts during our window (including buffer)
            {
              startTime: { gte: searchStart, lt: searchEnd },
            },
            // Appointment ends during our window (including buffer)
            {
              endTime: { gt: searchStart, lte: searchEnd },
            },
            // Appointment completely encompasses our window
            {
              startTime: { lte: searchStart },
              endTime: { gte: searchEnd },
            },
          ],
        },
      });

      // Filter to confirm actual overlaps (accounting for buffer)
      const confirmedOverlaps = overlappingAppointments.filter((apt) => {
        const aptStartWithBuffer = new Date(apt.startTime.getTime() - bufferMs);
        const aptEndWithBuffer = new Date(apt.endTime.getTime() + bufferMs);
        return doTimeRangesOverlap(startTime, endTime, aptStartWithBuffer, aptEndWithBuffer);
      });

      if (confirmedOverlaps.length > 0) {
        const conflictingApt = confirmedOverlaps[0];
        return failure<CreatedAppointment>(
          ErrorCode.OVERLAPPING_APPOINTMENT,
          `Time slot conflicts with existing appointment. Required buffer: ${mergedConfig.bufferMinutes} minutes.`,
          {
            conflictingAppointmentId: conflictingApt.id,
            conflictingStart: conflictingApt.startTime.toISOString(),
            conflictingEnd: conflictingApt.endTime.toISOString(),
            bufferMinutes: mergedConfig.bufferMinutes,
          }
        );
      }

      // All validations passed - create the appointment
      const appointment = await tx.appointment.create({
        data: {
          barberId,
          customerId,
          serviceId,
          startTime,
          endTime,
          status: AppointmentStatus.BOOKED,
        },
      });

      return success<CreatedAppointment>({
        id: appointment.id,
        barberId: appointment.barberId,
        customerId: appointment.customerId,
        serviceId: appointment.serviceId,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        status: appointment.status,
      });
    }, {
      // Use serializable isolation to prevent phantom reads during concurrent bookings
      // This ensures that if two requests try to book the same slot simultaneously,
      // one will fail with a transaction conflict rather than creating duplicates
      isolationLevel: 'Serializable',
      timeout: 10000, // 10 second timeout for the transaction
    });

    return result;

  } catch (error) {
    // Handle Prisma-specific transaction errors
    if (error instanceof Error) {
      // P2034 is Prisma's code for transaction conflicts (serialization failure)
      if (error.message.includes('P2034') || error.message.includes('could not serialize')) {
        return failure(
          ErrorCode.CONCURRENT_MODIFICATION,
          'Another booking was made for this time slot. Please try again.',
          { originalError: error.message }
        );
      }
    }

    // Re-throw unexpected errors
    throw error;
  }
}

// ============================================================================
// Availability Checking
// ============================================================================

interface AvailabilityCheckResult {
  available: boolean;
  reason: string;
}

/**
 * Checks if a barber is available for a given time slot.
 *
 * Availability rules:
 * 1. Exception days (isException=true with specific date) override weekly availability
 * 2. Weekly availability (isException=false) applies based on dayOfWeek
 * 3. If an exception exists for a date, ONLY exception rules apply (weekly is ignored)
 * 4. If no exception and no weekly rule, barber is unavailable
 */
function checkBarberAvailability(
  availabilityRecords: Availability[],
  requestedStart: Date,
  requestedEnd: Date
): AvailabilityCheckResult {
  const appointmentDate = startOfDay(requestedStart);
  const dayOfWeek = getDayOfWeek(requestedStart);

  // Separate exception and weekly availability records
  const exceptionForDate = availabilityRecords.filter(
    (a) =>
      a.isException &&
      a.date &&
      startOfDay(a.date).getTime() === appointmentDate.getTime()
  );

  const weeklyForDay = availabilityRecords.filter(
    (a) => !a.isException && a.dayOfWeek === dayOfWeek
  );

  // Determine which rules to apply
  // If there are exceptions for this specific date, they completely override weekly rules
  const applicableRules = exceptionForDate.length > 0 ? exceptionForDate : weeklyForDay;

  // Handle case where exception exists but with no time slots (day off)
  // An exception with empty/no time range means the barber is off that day
  if (exceptionForDate.length > 0) {
    const hasValidTimeSlots = exceptionForDate.some(
      (a) => a.startTime && a.endTime
    );
    if (!hasValidTimeSlots) {
      return {
        available: false,
        reason: 'Barber has marked this date as unavailable (day off)',
      };
    }
  }

  if (applicableRules.length === 0) {
    return {
      available: false,
      reason: `Barber has no availability set for ${dayOfWeek === 0 ? 'Sunday' : dayOfWeek === 6 ? 'Saturday' : 'this day of week'}`,
    };
  }

  // Check if the requested time falls within any available window
  for (const rule of applicableRules) {
    const ruleStart = combineDateAndTime(appointmentDate, rule.startTime);
    const ruleEnd = combineDateAndTime(appointmentDate, rule.endTime);

    // The appointment must fit entirely within an availability window
    if (requestedStart >= ruleStart && requestedEnd <= ruleEnd) {
      return {
        available: true,
        reason: 'Slot is within barber availability',
      };
    }
  }

  // Appointment doesn't fit within any availability window
  const availableWindows = applicableRules
    .map((r) => `${r.startTime}-${r.endTime}`)
    .join(', ');

  return {
    available: false,
    reason: `Requested time is outside barber's available hours. Available: ${availableWindows}`,
  };
}

// ============================================================================
// Utility Functions for External Use
// ============================================================================

/**
 * Validates appointment timing without creating it.
 * Useful for real-time UI validation before submission.
 */
export async function validateAppointmentSlot(
  prisma: PrismaClient,
  input: CreateAppointmentInput,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<{ valid: true }>> {
  const mergedConfig = { ...DEFAULT_BOOKING_CONFIG, ...config };
  const { barberId, serviceId, startTime } = input;

  // Check if in the past
  if (startTime <= new Date()) {
    return failure(ErrorCode.BOOKING_IN_PAST, 'Cannot book appointments in the past');
  }

  // Fetch barber and service
  const [barber, service] = await Promise.all([
    prisma.barber.findUnique({
      where: { id: barberId },
      include: { availability: true },
    }),
    prisma.service.findUnique({ where: { id: serviceId } }),
  ]);

  if (!barber) {
    return failure(ErrorCode.BARBER_NOT_FOUND, 'Barber not found');
  }

  if (!barber.active) {
    return failure(ErrorCode.BARBER_NOT_ACTIVE, 'Barber is not accepting appointments');
  }

  if (!service) {
    return failure(ErrorCode.SERVICE_NOT_FOUND, 'Service not found');
  }

  const endTime = addMinutes(startTime, service.durationMinutes);

  // Check availability
  const availabilityCheck = checkBarberAvailability(barber.availability, startTime, endTime);
  if (!availabilityCheck.available) {
    return failure(ErrorCode.BARBER_UNAVAILABLE, availabilityCheck.reason);
  }

  // Check overlaps (without transaction - this is just validation)
  const bufferMs = mergedConfig.bufferMinutes * 60 * 1000;
  const searchStart = new Date(startTime.getTime() - bufferMs);
  const searchEnd = new Date(endTime.getTime() + bufferMs);

  const overlapping = await prisma.appointment.findFirst({
    where: {
      barberId,
      status: AppointmentStatus.BOOKED,
      OR: [
        { startTime: { gte: searchStart, lt: searchEnd } },
        { endTime: { gt: searchStart, lte: searchEnd } },
        { startTime: { lte: searchStart }, endTime: { gte: searchEnd } },
      ],
    },
  });

  if (overlapping) {
    return failure(
      ErrorCode.OVERLAPPING_APPOINTMENT,
      'Time slot conflicts with an existing appointment'
    );
  }

  return success({ valid: true });
}
