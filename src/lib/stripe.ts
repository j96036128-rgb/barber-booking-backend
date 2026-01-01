/**
 * Stripe Client Singleton
 *
 * Initializes and exports the Stripe client for payment processing.
 * Requires STRIPE_SECRET_KEY environment variable to be set.
 */

import Stripe from 'stripe';

// Validate required environment variable
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY environment variable is required. ' +
    'Please set it in your .env file or environment.'
  );
}

// Initialize Stripe client
export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-12-15.clover',
  typescript: true,
});

/**
 * Verifies that the Stripe client is properly initialized.
 * Can be called at startup to confirm configuration is valid.
 */
export async function verifyStripeConnection(): Promise<boolean> {
  try {
    // Make a simple API call to verify the key is valid
    await stripe.balance.retrieve();
    console.log('[Stripe] Client initialized successfully');
    return true;
  } catch (error) {
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      console.error('[Stripe] Invalid API key - authentication failed');
    } else if (error instanceof Error) {
      console.error(`[Stripe] Connection error: ${error.message}`);
    }
    return false;
  }
}
