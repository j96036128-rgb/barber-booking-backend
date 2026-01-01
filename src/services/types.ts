/**
 * Shared types and configuration for barber shop booking services
 */

import { AppointmentStatus } from '@prisma/client';

// ============================================================================
// Configuration
// ============================================================================

export interface BookingConfig {
  /** Minimum buffer time between appointments in minutes (default: 10) */
  bufferMinutes: number;
  /** Hours before appointment when cancellation becomes "late" (default: 6) */
  lateCancellationHours: number;
  /** Default appointment slot duration in minutes for slot calculation */
  defaultSlotDurationMinutes: number;
}

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  bufferMinutes: 10,
  lateCancellationHours: 6,
  defaultSlotDurationMinutes: 30,
};

// ============================================================================
// Result Types (discriminated unions for type-safe error handling)
// ============================================================================

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: ServiceError };

export interface ServiceError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export enum ErrorCode {
  // Booking errors
  BOOKING_IN_PAST = 'BOOKING_IN_PAST',
  OVERLAPPING_APPOINTMENT = 'OVERLAPPING_APPOINTMENT',
  BARBER_UNAVAILABLE = 'BARBER_UNAVAILABLE',
  BARBER_NOT_FOUND = 'BARBER_NOT_FOUND',
  SERVICE_NOT_FOUND = 'SERVICE_NOT_FOUND',
  CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND',
  BARBER_NOT_ACTIVE = 'BARBER_NOT_ACTIVE',
  CUSTOMER_BLOCKED = 'CUSTOMER_BLOCKED',

  // Cancellation errors
  APPOINTMENT_NOT_FOUND = 'APPOINTMENT_NOT_FOUND',
  APPOINTMENT_ALREADY_CANCELLED = 'APPOINTMENT_ALREADY_CANCELLED',
  APPOINTMENT_ALREADY_COMPLETED = 'APPOINTMENT_ALREADY_COMPLETED',
  CANNOT_CANCEL_PAST_APPOINTMENT = 'CANNOT_CANCEL_PAST_APPOINTMENT',

  // General errors
  INVALID_DATE_RANGE = 'INVALID_DATE_RANGE',
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // Auth errors
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Payment errors
  INVALID_APPOINTMENT_STATE = 'INVALID_APPOINTMENT_STATE',
  PAYMENT_ALREADY_EXISTS = 'PAYMENT_ALREADY_EXISTS',
  STRIPE_ERROR = 'STRIPE_ERROR',
}

// ============================================================================
// Input/Output DTOs
// ============================================================================

export interface CreateAppointmentInput {
  barberId: string;
  customerId: string;
  serviceId: string;
  startTime: Date;
}

export interface CreatedAppointment {
  id: string;
  barberId: string;
  customerId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  reason?: string;
}

export interface CancellationResult {
  appointmentId: string;
  status: AppointmentStatus;
  wasLateCancellation: boolean;
}

export interface MarkNoShowInput {
  appointmentId: string;
}

export interface NoShowResult {
  appointmentId: string;
  customerId: string;
  noShowCount: number;
}

export interface AvailableSlotsInput {
  barberId: string;
  startDate: Date;
  endDate: Date;
  /** Duration in minutes for the service being booked */
  serviceDurationMinutes?: number;
}

export interface TimeSlot {
  startTime: Date;
  endTime: Date;
}

export interface DailyAvailability {
  date: Date;
  slots: TimeSlot[];
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Creates a success result
 */
export function success<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

/**
 * Creates an error result
 */
export function failure<T>(code: ErrorCode, message: string, details?: Record<string, unknown>): ServiceResult<T> {
  return {
    success: false,
    error: { code, message, details },
  };
}

/**
 * Parses a time string (HH:MM) into hours and minutes
 */
export function parseTimeString(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Combines a date with a time string to create a full DateTime
 */
export function combineDateAndTime(date: Date, timeStr: string): Date {
  const { hours, minutes } = parseTimeString(timeStr);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Gets the day of week (0-6, Sunday = 0) for a given date
 */
export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

/**
 * Checks if two time ranges overlap
 * [start1, end1) overlaps with [start2, end2)
 */
export function doTimeRangesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Normalizes a date to midnight (start of day) in local timezone
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Normalizes a date to end of day (23:59:59.999) in local timezone
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Adds minutes to a date
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Calculates the difference in hours between two dates
 */
export function differenceInHours(date1: Date, date2: Date): number {
  return (date1.getTime() - date2.getTime()) / (1000 * 60 * 60);
}
