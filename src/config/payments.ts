/**
 * Payment Configuration
 *
 * Centralized configuration for payment-related settings.
 * Values can be overridden via environment variables.
 */

/**
 * Deposit amount in cents (smallest currency unit).
 * Default: 500 (£5.00 / $5.00)
 */
export const DEPOSIT_AMOUNT_CENTS = parseInt(
  process.env.DEPOSIT_AMOUNT_CENTS || '500',
  10
);

/**
 * Payment currency code (ISO 4217 lowercase).
 * Default: 'gbp'
 */
export const PAYMENT_CURRENCY = process.env.PAYMENT_CURRENCY || 'gbp';

/**
 * Validates payment configuration at startup.
 */
export function validatePaymentConfig(): void {
  if (isNaN(DEPOSIT_AMOUNT_CENTS) || DEPOSIT_AMOUNT_CENTS <= 0) {
    throw new Error(
      `Invalid DEPOSIT_AMOUNT_CENTS: ${process.env.DEPOSIT_AMOUNT_CENTS}. ` +
      'Must be a positive integer.'
    );
  }

  const validCurrencies = ['gbp', 'usd', 'eur', 'aud', 'cad'];
  if (!validCurrencies.includes(PAYMENT_CURRENCY.toLowerCase())) {
    console.warn(
      `[Payments] Currency '${PAYMENT_CURRENCY}' is not in common list. ` +
      'Ensure it is a valid Stripe currency code.'
    );
  }

  console.log(
    `[Payments] Config loaded: ${DEPOSIT_AMOUNT_CENTS} ${PAYMENT_CURRENCY.toUpperCase()}`
  );
}
