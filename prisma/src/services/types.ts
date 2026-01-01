import { Prisma, AppointmentStatus } from '@prisma/client';

// Input types for service methods
export interface CreateAppointmentInput {
  barberId: string;
  customerId: string;
  serviceId: string;
  startTime: Date;
}

export interface ValidateSlotInput {
  barberId: string;
  serviceId: string;
  startTime: Date;
}

export interface CancelAppointmentInput {
  appointmentId: string;
  customerId: string;
  reason?: string;
}

export interface MarkNoShowInput {
  appointmentId: string;
}

// Configuration for booking rules
export interface BookingConfig {
  bufferMinutes: number;
  cancellationCutoffHours: number;
  slotIntervalMinutes: number;
  maxNoShowCount: number;
}

// Default booking configuration
export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  bufferMinutes: 10,
  cancellationCutoffHours: 6,
  maxNoShowCount: 3,
  slotIntervalMinutes: 15,
};

// Result types
export interface SlotValidationResult {
  valid: boolean;
  reason?: string;
}

export interface AppointmentResult {
  success: boolean;
  appointmentId?: string;
  error?: string;
}

export interface CancellationResult {
  success: boolean;
  error?: string;
}

// Re-export Prisma types for convenience
export { AppointmentStatus };
export type Appointment = Prisma.AppointmentGetPayload<{}>;
export type Service = Prisma.ServiceGetPayload<{}>;
export type Barber = Prisma.BarberGetPayload<{}>;
export type Availability = Prisma.AvailabilityGetPayload<{}>;
export type NoShowFlag = Prisma.NoShowFlagGetPayload<{}>;
