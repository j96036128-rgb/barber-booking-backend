import { PrismaClient, AppointmentStatus } from '@prisma/client';
import {
  CreateAppointmentInput,
  ValidateSlotInput,
  SlotValidationResult,
  AppointmentResult,
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,
} from './types';

/**
 * Creates a new appointment after validating all constraints
 */
export async function createAppointment(
  prisma: PrismaClient,
  input: CreateAppointmentInput,
  config: BookingConfig = DEFAULT_BOOKING_CONFIG
): Promise<AppointmentResult> {
  const { barberId, customerId, serviceId, startTime } = input;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
  });

  if (!service) {
    return { success: false, error: 'Service not found' };
  }

  const endTime = new Date(startTime.getTime() + service.durationMinutes * 60 * 1000);

  const validation = await validateAppointmentSlot(prisma, { barberId, serviceId, startTime }, config);

  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const noShowFlag = await prisma.noShowFlag.findUnique({
    where: { customerId },
  });

  if (noShowFlag && noShowFlag.count >= config.maxNoShowCount) {
    return {
      success: false,
      error: 'Account restricted due to excessive no-shows. Please contact support.',
    };
  }

  const barber = await prisma.barber.findUnique({
    where: { id: barberId },
  });

  if (!barber) {
    return { success: false, error: 'Barber not found' };
  }

  if (!barber.active) {
    return { success: false, error: 'Barber is not currently accepting appointments' };
  }

  const serviceCheck = await prisma.service.findFirst({
    where: {
      id: serviceId,
      OR: [
        { barberId: barberId },
        { barberId: null, shopId: barber.shopId },
      ],
    },
  });

  if (!serviceCheck) {
    return { success: false, error: 'Service not available for this barber' };
  }

  const appointment = await prisma.appointment.create({
    data: {
      barberId,
      customerId,
      serviceId,
      startTime,
      endTime,
      status: AppointmentStatus.BOOKED,
    },
  });

  return {
    success: true,
    appointmentId: appointment.id,
  };
}

/**
 * Validates if a time slot is available for booking
 */
export async function validateAppointmentSlot(
  prisma: PrismaClient,
  input: ValidateSlotInput,
  config: BookingConfig = DEFAULT_BOOKING_CONFIG
): Promise<SlotValidationResult> {
  const { barberId, serviceId, startTime } = input;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
  });

  if (!service) {
    return { valid: false, reason: 'Service not found' };
  }

  const endTimeWithBuffer = new Date(
    startTime.getTime() + (service.durationMinutes + config.bufferMinutes) * 60 * 1000
  );
  const startTimeWithBuffer = new Date(
    startTime.getTime() - config.bufferMinutes * 60 * 1000
  );

  if (startTime < new Date()) {
    return { valid: false, reason: 'Cannot book appointments in the past' };
  }

  const dayOfWeek = startTime.getDay();
  const timeString = startTime.toTimeString().slice(0, 5);
  const endTimeString = new Date(startTime.getTime() + service.durationMinutes * 60 * 1000)
    .toTimeString()
    .slice(0, 5);

  const dateException = await prisma.availability.findFirst({
    where: {
      barberId,
      isException: true,
      date: {
        gte: new Date(startTime.toDateString()),
        lt: new Date(new Date(startTime.toDateString()).getTime() + 24 * 60 * 60 * 1000),
      },
    },
  });

  if (dateException) {
    if (timeString < dateException.startTime || endTimeString > dateException.endTime) {
      return { valid: false, reason: 'Time slot outside barber availability for this date' };
    }
  } else {
    const regularAvailability = await prisma.availability.findFirst({
      where: {
        barberId,
        dayOfWeek,
        isException: false,
      },
    });

    if (!regularAvailability) {
      return { valid: false, reason: 'Barber not available on this day' };
    }

    if (timeString < regularAvailability.startTime || endTimeString > regularAvailability.endTime) {
      return { valid: false, reason: 'Time slot outside barber working hours' };
    }
  }

  const overlappingAppointment = await prisma.appointment.findFirst({
    where: {
      barberId,
      status: { in: [AppointmentStatus.BOOKED] },
      OR: [
        {
          startTime: { lte: startTime },
          endTime: { gt: startTimeWithBuffer },
        },
        {
          startTime: { lt: endTimeWithBuffer },
          endTime: { gte: new Date(startTime.getTime() + service.durationMinutes * 60 * 1000) },
        },
        {
          startTime: { gte: startTime },
          endTime: { lte: new Date(startTime.getTime() + service.durationMinutes * 60 * 1000) },
        },
      ],
    },
  });

  if (overlappingAppointment) {
    return { valid: false, reason: 'Time slot conflicts with existing appointment' };
  }

  return { valid: true };
}

/**
 * Retrieves appointments for a specific barber within a date range
 */
export async function getBarberAppointments(
  prisma: PrismaClient,
  barberId: string,
  startDate: Date,
  endDate: Date
) {
  return prisma.appointment.findMany({
    where: {
      barberId,
      startTime: { gte: startDate },
      endTime: { lte: endDate },
      status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.COMPLETED] },
    },
    include: {
      service: true,
      customer: {
        select: {
          id: true,
          email: true,
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });
}

/**
 * Retrieves appointments for a specific customer
 */
export async function getCustomerAppointments(prisma: PrismaClient, customerId: string) {
  return prisma.appointment.findMany({
    where: {
      customerId,
    },
    include: {
      service: true,
      barber: {
        include: {
          user: {
            select: {
              email: true,
            },
          },
          shop: {
            select: {
              name: true,
              location: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: 'desc' },
  });
}

/**
 * Gets available time slots for a barber on a specific date
 */
export async function getAvailableSlots(
  prisma: PrismaClient,
  barberId: string,
  serviceId: string,
  date: Date,
  config: BookingConfig = DEFAULT_BOOKING_CONFIG
): Promise<Date[]> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
  });

  if (!service) {
    return [];
  }

  const dayOfWeek = date.getDay();
  const dateStart = new Date(date.toDateString());
  const dateEnd = new Date(dateStart.getTime() + 24 * 60 * 60 * 1000);

  const availability = await prisma.availability.findFirst({
    where: {
      barberId,
      OR: [
        { isException: true, date: { gte: dateStart, lt: dateEnd } },
        { isException: false, dayOfWeek },
      ],
    },
    orderBy: { isException: 'desc' },
  });

  if (!availability) {
    return [];
  }

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      barberId,
      status: AppointmentStatus.BOOKED,
      startTime: { gte: dateStart },
      endTime: { lt: dateEnd },
    },
    orderBy: { startTime: 'asc' },
  });

  const slots: Date[] = [];
  const [startHour, startMinute] = availability.startTime.split(':').map(Number);
  const [endHour, endMinute] = availability.endTime.split(':').map(Number);

  const workStart = new Date(dateStart);
  workStart.setHours(startHour, startMinute, 0, 0);

  const workEnd = new Date(dateStart);
  workEnd.setHours(endHour, endMinute, 0, 0);

  const slotDuration = service.durationMinutes + config.bufferMinutes;
  const now = new Date();

  for (
    let slotStart = new Date(workStart);
    slotStart.getTime() + service.durationMinutes * 60 * 1000 <= workEnd.getTime();
    slotStart = new Date(slotStart.getTime() + config.slotIntervalMinutes * 60 * 1000)
  ) {
    if (slotStart <= now) {
      continue;
    }

    const slotEnd = new Date(slotStart.getTime() + slotDuration * 60 * 1000);

    const hasConflict = existingAppointments.some((apt) => {
      const aptStartWithBuffer = new Date(apt.startTime.getTime() - config.bufferMinutes * 60 * 1000);
      const aptEndWithBuffer = new Date(apt.endTime.getTime() + config.bufferMinutes * 60 * 1000);
      return slotStart < aptEndWithBuffer && slotEnd > aptStartWithBuffer;
    });

    if (!hasConflict) {
      slots.push(new Date(slotStart));
    }
  }

  return slots;
}
