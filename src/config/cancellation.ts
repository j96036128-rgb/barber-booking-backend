/**
 * Cancellation Policy Configuration
 *
 * Centralized configuration for appointment cancellation rules.
 */

export const CANCELLATION_POLICY = {
  /**
   * Number of hours before appointment start time
   * within which cancellation will NOT trigger a refund.
   *
   * Example: If set to 24, cancellations made less than 24 hours
   * before the appointment will forfeit the deposit.
   */
  REFUND_CUTOFF_HOURS: 24,
};
