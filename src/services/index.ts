/**
 * Barber Shop Booking Services
 *
 * This module exports all service functions for the barber shop booking system.
 * These are framework-agnostic service-level functions that can be used with
 * any Node.js backend framework (Express, NestJS, Fastify, etc.).
 */

// Re-export all types and configuration
export {
  // Configuration
  BookingConfig,
  DEFAULT_BOOKING_CONFIG,

  // Result types
  ServiceResult,
  ServiceError,
  ErrorCode,

  // Input/Output DTOs
  CreateAppointmentInput,
  CreatedAppointment,
  CancelAppointmentInput,
  CancellationResult,
  MarkNoShowInput,
  NoShowResult,
  AvailableSlotsInput,
  TimeSlot,
  DailyAvailability,

  // Helper functions
  success,
  failure,
} from './types';

// Appointment booking service
export {
  createAppointment,
  validateAppointmentSlot,
} from './appointment.service';

// Cancellation and no-show service
export {
  cancelAppointment,
  markNoShow,
  completeAppointment,
  detectAndMarkNoShows,
  getCustomerNoShowCount,
  resetNoShowCount,
  isCustomerBlocked,
} from './cancellation.service';

// Availability calculation service
export {
  getAvailableSlots,
  getBookableSlots,
  getNextAvailableSlot,
  isSlotAvailable,
  getAvailabilitySummary,
} from './availability.service';
