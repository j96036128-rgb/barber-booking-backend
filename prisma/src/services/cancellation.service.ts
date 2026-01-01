import { PrismaClient, AppointmentStatus } from '@prisma/client';
import {
  CancelAppointmentInput,
  MarkNoShowInput,
  CancellationResult,
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,
} from './types';

/**
 * Cancels an appointment if within the allowed cancellation window
 */
export async function cancelAppointment(
  prisma: PrismaClient,
  input: CancelAppointmentInput,
  config: BookingConfig = DEFAULT_BOOKING_CONFIG
): Promise<CancellationResult> {
  const { appointmentId, customerId, reason } = input;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });

  if (!appointment) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.customerId !== customerId) {
    return { success: false, error: 'Not authorized to cancel this appointment' };
  }

  if (appointment.status !== AppointmentStatus.BOOKED) {
    return { success: false, error: `Cannot cancel appointment with status: ${appointment.status}` };
  }

  const now = new Date();
  const cutoffTime = new Date(
    appointment.startTime.getTime() - config.cancellationCutoffHours * 60 * 60 * 1000
  );

  if (now > cutoffTime) {
    return {
      success: false,
      error: `Cancellations must be made at least ${config.cancellationCutoffHours} hours in advance`,
    };
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: AppointmentStatus.CANCELLED,
      cancellationReason: reason || null,
    },
  });

  return { success: true };
}

/**
 * Marks an appointment as no-show and updates the customer's no-show flag
 */
export async function markNoShow(
  prisma: PrismaClient,
  input: MarkNoShowInput
): Promise<CancellationResult> {
  const { appointmentId } = input;

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });

  if (!appointment) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== AppointmentStatus.BOOKED) {
    return { success: false, error: `Cannot mark as no-show, current status: ${appointment.status}` };
  }

  const now = new Date();
  if (now < appointment.startTime) {
    return { success: false, error: 'Cannot mark as no-show before appointment time' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.NO_SHOW },
    });

    await tx.noShowFlag.upsert({
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
  });

  return { success: true };
}

/**
 * Marks an appointment as completed
 */
export async function completeAppointment(
  prisma: PrismaClient,
  appointmentId: string
): Promise<CancellationResult> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
  });

  if (!appointment) {
    return { success: false, error: 'Appointment not found' };
  }

  if (appointment.status !== AppointmentStatus.BOOKED) {
    return { success: false, error: `Cannot complete appointment with status: ${appointment.status}` };
  }

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: AppointmentStatus.COMPLETED },
  });

  return { success: true };
}

/**
 * Gets the no-show count for a customer
 */
export async function getNoShowCount(prisma: PrismaClient, customerId: string): Promise<number> {
  const noShowFlag = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  return noShowFlag?.count ?? 0;
}

/**
 * Resets the no-show flag for a customer (admin action)
 */
export async function resetNoShowFlag(
  prisma: PrismaClient,
  customerId: string
): Promise<CancellationResult> {
  const existing = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  if (!existing) {
    return { success: false, error: 'No no-show record found for this customer' };
  }

  await prisma.noShowFlag.update({
    where: { customerId },
    data: {
      count: 0,
      lastFlaggedAt: null,
    },
  });

  return { success: true };
}

/**
 * Checks if a customer is blocked due to excessive no-shows
 */
export async function isCustomerBlocked(
  prisma: PrismaClient,
  customerId: string,
  config: BookingConfig = DEFAULT_BOOKING_CONFIG
): Promise<boolean> {
  const noShowFlag = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  if (!noShowFlag) {
    return false;
  }

  return noShowFlag.count >= config.maxNoShowCount;
}
