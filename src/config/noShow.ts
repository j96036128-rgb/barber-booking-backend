/**
 * No-Show Policy Configuration
 *
 * Centralized configuration for no-show detection rules.
 */

export const NO_SHOW_POLICY = {
  /**
   * Number of minutes after appointment start time
   * before the appointment can be marked as a no-show.
   *
   * Example: If set to 10, an appointment at 2:00 PM
   * can be marked as no-show starting at 2:10 PM.
   */
  GRACE_PERIOD_MINUTES: 10,
};
