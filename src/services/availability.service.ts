/**
 * Availability Slot Calculation Service
 *
 * Calculates available time slots for a barber within a date range by:
 * - Reading weekly availability patterns
 * - Applying exception day overrides
 * - Subtracting existing appointments (with buffer time)
 * - Returning bookable time slots
 */

import { PrismaClient, AppointmentStatus, Availability, Appointment } from '@prisma/client';
import {
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,
  AvailableSlotsInput,
  TimeSlot,
  DailyAvailability,
  ServiceResult,
  ErrorCode,
  success,
  failure,
  combineDateAndTime,
  getDayOfWeek,
  startOfDay,
  endOfDay,
  addMinutes,
} from './types';

// ============================================================================
// Main Availability Calculation
// ============================================================================

/**
 * Calculates available time slots for a barber within a date range.
 *
 * Algorithm:
 * 1. For each day in the range, determine applicable availability rules
 * 2. Exception days override weekly patterns completely
 * 3. Generate potential slots from availability windows
 * 4. Subtract existing appointments with buffer time
 * 5. Filter out slots that are too short for the requested service
 *
 * @param prisma - Prisma client instance
 * @param input - Query parameters (barberId, date range, optional service duration)
 * @param config - Optional configuration overrides
 */
export async function getAvailableSlots(
  prisma: PrismaClient,
  input: AvailableSlotsInput,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<DailyAvailability[]>> {
  const mergedConfig = { ...DEFAULT_BOOKING_CONFIG, ...config };
  const { barberId, startDate, endDate, serviceDurationMinutes } = input;

  // Validate date range
  if (startDate >= endDate) {
    return failure(
      ErrorCode.INVALID_DATE_RANGE,
      'Start date must be before end date'
    );
  }

  // Don't allow queries for past dates (normalize to start of today)
  const today = startOfDay(new Date());
  const normalizedStartDate = startDate < today ? today : startOfDay(startDate);
  const normalizedEndDate = endOfDay(endDate);

  // Fetch barber with availability
  const barber = await prisma.barber.findUnique({
    where: { id: barberId },
    include: { availability: true },
  });

  if (!barber) {
    return failure(
      ErrorCode.BARBER_NOT_FOUND,
      `Barber with ID ${barberId} not found`
    );
  }

  if (!barber.active) {
    return failure(
      ErrorCode.BARBER_NOT_ACTIVE,
      'This barber is not currently accepting appointments'
    );
  }

  // Fetch existing appointments in the date range
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      barberId,
      status: { in: [AppointmentStatus.BOOKED] },
      startTime: { gte: normalizedStartDate },
      endTime: { lte: normalizedEndDate },
    },
    orderBy: { startTime: 'asc' },
  });

  // Calculate available slots for each day
  const slotDuration = serviceDurationMinutes ?? mergedConfig.defaultSlotDurationMinutes;
  const dailyAvailability: DailyAvailability[] = [];

  // Iterate through each day in the range
  const currentDate = new Date(normalizedStartDate);
  while (currentDate <= normalizedEndDate) {
    const daySlots = calculateDaySlotsForDate(
      new Date(currentDate),
      barber.availability,
      existingAppointments,
      slotDuration,
      mergedConfig.bufferMinutes
    );

    // Only include days that have available slots
    if (daySlots.length > 0) {
      dailyAvailability.push({
        date: new Date(currentDate),
        slots: daySlots,
      });
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return success(dailyAvailability);
}

// ============================================================================
// Day-Level Slot Calculation
// ============================================================================

/**
 * Calculates available slots for a single day.
 *
 * @param date - The date to calculate slots for
 * @param availability - Barber's availability records
 * @param appointments - Existing appointments (filtered to relevant range)
 * @param slotDurationMinutes - Required duration for each slot
 * @param bufferMinutes - Buffer time between appointments
 */
function calculateDaySlotsForDate(
  date: Date,
  availability: Availability[],
  appointments: Appointment[],
  slotDurationMinutes: number,
  bufferMinutes: number
): TimeSlot[] {
  const dayStart = startOfDay(date);
  const dayOfWeek = getDayOfWeek(date);
  const now = new Date();

  // Find applicable availability rules for this day
  // Exception days (with matching date) take precedence over weekly rules
  const exceptionsForDate = availability.filter(
    (a) =>
      a.isException &&
      a.date &&
      startOfDay(a.date).getTime() === dayStart.getTime()
  );

  const weeklyForDay = availability.filter(
    (a) => !a.isException && a.dayOfWeek === dayOfWeek
  );

  // Use exceptions if they exist, otherwise use weekly rules
  const applicableRules = exceptionsForDate.length > 0 ? exceptionsForDate : weeklyForDay;

  // If exception exists but has no valid time slots, barber is off this day
  if (exceptionsForDate.length > 0) {
    const hasValidSlots = exceptionsForDate.some((a) => a.startTime && a.endTime);
    if (!hasValidSlots) {
      return []; // Day off - no availability
    }
  }

  // No availability rules for this day
  if (applicableRules.length === 0) {
    return [];
  }

  // Get appointments for this specific day
  const dayEnd = endOfDay(date);
  const dayAppointments = appointments.filter(
    (apt) => apt.startTime >= dayStart && apt.startTime <= dayEnd
  );

  // Convert appointments to blocked time ranges (including buffer)
  const blockedRanges: TimeSlot[] = dayAppointments.map((apt) => ({
    startTime: new Date(apt.startTime.getTime() - bufferMinutes * 60 * 1000),
    endTime: new Date(apt.endTime.getTime() + bufferMinutes * 60 * 1000),
  }));

  // Calculate free slots from each availability window
  const allFreeSlots: TimeSlot[] = [];

  for (const rule of applicableRules) {
    const windowStart = combineDateAndTime(date, rule.startTime);
    const windowEnd = combineDateAndTime(date, rule.endTime);

    // Skip if the entire window is in the past
    if (windowEnd <= now) {
      continue;
    }

    // Adjust window start if it's in the past
    const effectiveStart = windowStart < now ? now : windowStart;

    // Get free slots within this availability window
    const freeSlots = subtractBlockedRanges(
      { startTime: effectiveStart, endTime: windowEnd },
      blockedRanges
    );

    allFreeSlots.push(...freeSlots);
  }

  // Filter slots that are long enough for the service
  return allFreeSlots.filter((slot) => {
    const durationMinutes = (slot.endTime.getTime() - slot.startTime.getTime()) / (60 * 1000);
    return durationMinutes >= slotDurationMinutes;
  });
}

// ============================================================================
// Time Range Operations
// ============================================================================

/**
 * Subtracts blocked time ranges from an availability window.
 *
 * Given a free window [windowStart, windowEnd] and a list of blocked ranges,
 * returns the remaining free time slots.
 *
 * Example:
 *   Window: 9:00-17:00
 *   Blocked: [10:00-11:00, 14:00-15:00]
 *   Result: [9:00-10:00, 11:00-14:00, 15:00-17:00]
 */
function subtractBlockedRanges(
  window: TimeSlot,
  blocked: TimeSlot[]
): TimeSlot[] {
  // Sort blocked ranges by start time
  const sortedBlocked = [...blocked].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  // Filter to only blocked ranges that overlap with our window
  const relevantBlocked = sortedBlocked.filter(
    (b) => b.startTime < window.endTime && b.endTime > window.startTime
  );

  if (relevantBlocked.length === 0) {
    return [window];
  }

  const freeSlots: TimeSlot[] = [];
  let currentStart = window.startTime;

  for (const blocked of relevantBlocked) {
    // If there's a gap before this blocked range, add it as a free slot
    if (blocked.startTime > currentStart) {
      freeSlots.push({
        startTime: new Date(currentStart),
        endTime: new Date(Math.min(blocked.startTime.getTime(), window.endTime.getTime())),
      });
    }

    // Move current position past this blocked range
    if (blocked.endTime > currentStart) {
      currentStart = new Date(blocked.endTime);
    }
  }

  // Add remaining time after the last blocked range
  if (currentStart < window.endTime) {
    freeSlots.push({
      startTime: new Date(currentStart),
      endTime: new Date(window.endTime),
    });
  }

  return freeSlots;
}

// ============================================================================
// Granular Slot Generation
// ============================================================================

/**
 * Generates discrete bookable time slots from availability windows.
 *
 * Instead of returning free time ranges, this returns specific start times
 * at regular intervals (e.g., every 15 minutes) that customers can book.
 *
 * @param prisma - Prisma client instance
 * @param input - Query parameters
 * @param slotIntervalMinutes - Interval between slot start times (default: 15)
 * @param config - Optional configuration overrides
 */
export async function getBookableSlots(
  prisma: PrismaClient,
  input: AvailableSlotsInput,
  slotIntervalMinutes: number = 15,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<DailyAvailability[]>> {
  // First get the raw available windows
  const windowsResult = await getAvailableSlots(prisma, input, config);

  if (!windowsResult.success) {
    return windowsResult;
  }

  const serviceDuration = input.serviceDurationMinutes ?? DEFAULT_BOOKING_CONFIG.defaultSlotDurationMinutes;

  // Convert windows to discrete slots
  const bookableSlots: DailyAvailability[] = windowsResult.data.map((day) => ({
    date: day.date,
    slots: generateDiscreteSlots(day.slots, serviceDuration, slotIntervalMinutes),
  }));

  // Filter out days with no slots
  return success(bookableSlots.filter((day) => day.slots.length > 0));
}

/**
 * Generates discrete time slots from free windows.
 *
 * @param freeWindows - Available time windows
 * @param serviceDurationMinutes - Duration of the service being booked
 * @param intervalMinutes - Start time interval (e.g., 15 means slots start at :00, :15, :30, :45)
 */
function generateDiscreteSlots(
  freeWindows: TimeSlot[],
  serviceDurationMinutes: number,
  intervalMinutes: number
): TimeSlot[] {
  const slots: TimeSlot[] = [];

  for (const window of freeWindows) {
    // Round up start time to next interval boundary
    let slotStart = roundUpToInterval(window.startTime, intervalMinutes);

    while (true) {
      const slotEnd = addMinutes(slotStart, serviceDurationMinutes);

      // Check if this slot fits within the window
      if (slotEnd > window.endTime) {
        break;
      }

      slots.push({
        startTime: new Date(slotStart),
        endTime: new Date(slotEnd),
      });

      // Move to next interval
      slotStart = addMinutes(slotStart, intervalMinutes);
    }
  }

  return slots;
}

/**
 * Rounds a date up to the next interval boundary.
 *
 * Example: 9:07 with 15-minute interval becomes 9:15
 */
function roundUpToInterval(date: Date, intervalMinutes: number): Date {
  const minutes = date.getMinutes();
  const remainder = minutes % intervalMinutes;

  if (remainder === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) {
    return date; // Already on boundary
  }

  const result = new Date(date);
  result.setMinutes(minutes + (intervalMinutes - remainder));
  result.setSeconds(0);
  result.setMilliseconds(0);

  return result;
}

// ============================================================================
// Availability Management Helpers
// ============================================================================

/**
 * Gets the next available slot for a barber.
 *
 * Useful for "book next available" functionality.
 *
 * @param prisma - Prisma client instance
 * @param barberId - The barber's ID
 * @param serviceDurationMinutes - Duration of the service
 * @param maxDaysAhead - Maximum days to search ahead (default: 30)
 * @param config - Optional configuration overrides
 */
export async function getNextAvailableSlot(
  prisma: PrismaClient,
  barberId: string,
  serviceDurationMinutes: number,
  maxDaysAhead: number = 30,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<TimeSlot | null>> {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + maxDaysAhead);

  const slotsResult = await getBookableSlots(
    prisma,
    {
      barberId,
      startDate: now,
      endDate,
      serviceDurationMinutes,
    },
    15, // 15-minute intervals
    config
  );

  if (!slotsResult.success) {
    return slotsResult as ServiceResult<TimeSlot | null>;
  }

  // Return the first available slot
  for (const day of slotsResult.data) {
    if (day.slots.length > 0) {
      return success(day.slots[0]);
    }
  }

  return success(null); // No available slots in the range
}

/**
 * Checks if a specific time slot is available for booking.
 *
 * @param prisma - Prisma client instance
 * @param barberId - The barber's ID
 * @param startTime - Proposed start time
 * @param serviceDurationMinutes - Duration of the service
 * @param config - Optional configuration overrides
 */
export async function isSlotAvailable(
  prisma: PrismaClient,
  barberId: string,
  startTime: Date,
  serviceDurationMinutes: number,
  config: Partial<BookingConfig> = {}
): Promise<ServiceResult<boolean>> {
  const endTime = addMinutes(startTime, serviceDurationMinutes);

  // Query for a small window around the requested time
  const windowStart = new Date(startTime);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(startTime);
  windowEnd.setHours(23, 59, 59, 999);

  const slotsResult = await getAvailableSlots(
    prisma,
    {
      barberId,
      startDate: windowStart,
      endDate: windowEnd,
      serviceDurationMinutes,
    },
    config
  );

  if (!slotsResult.success) {
    return slotsResult as ServiceResult<boolean>;
  }

  // Check if the requested time falls within any available window
  const dayAvailability = slotsResult.data.find(
    (d) => startOfDay(d.date).getTime() === startOfDay(startTime).getTime()
  );

  if (!dayAvailability) {
    return success(false);
  }

  // Check if the requested slot fits within any free window
  for (const window of dayAvailability.slots) {
    if (startTime >= window.startTime && endTime <= window.endTime) {
      return success(true);
    }
  }

  return success(false);
}

/**
 * Gets availability summary for a barber over a date range.
 *
 * Returns a simple day-by-day summary showing whether each day has
 * any availability. Useful for calendar views.
 *
 * @param prisma - Prisma client instance
 * @param barberId - The barber's ID
 * @param startDate - Start of the range
 * @param endDate - End of the range
 * @param serviceDurationMinutes - Minimum slot duration to consider available
 */
export async function getAvailabilitySummary(
  prisma: PrismaClient,
  barberId: string,
  startDate: Date,
  endDate: Date,
  serviceDurationMinutes: number
): Promise<ServiceResult<Array<{ date: Date; hasAvailability: boolean; slotCount: number }>>> {
  const slotsResult = await getBookableSlots(
    prisma,
    {
      barberId,
      startDate,
      endDate,
      serviceDurationMinutes,
    }
  );

  if (!slotsResult.success) {
    return slotsResult as ServiceResult<Array<{ date: Date; hasAvailability: boolean; slotCount: number }>>;
  }

  // Create a map of available days
  const availableMap = new Map<string, number>();
  for (const day of slotsResult.data) {
    const dateKey = startOfDay(day.date).toISOString();
    availableMap.set(dateKey, day.slots.length);
  }

  // Generate summary for each day in the range
  const summary: Array<{ date: Date; hasAvailability: boolean; slotCount: number }> = [];
  const currentDate = new Date(startOfDay(startDate));
  const normalizedEnd = startOfDay(endDate);

  while (currentDate <= normalizedEnd) {
    const dateKey = currentDate.toISOString();
    const slotCount = availableMap.get(dateKey) ?? 0;

    summary.push({
      date: new Date(currentDate),
      hasAvailability: slotCount > 0,
      slotCount,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return success(summary);
}
