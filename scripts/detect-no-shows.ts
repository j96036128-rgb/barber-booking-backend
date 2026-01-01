/**
 * Phase 6.2 No-Show Detection Script
 *
 * Detects and marks CONFIRMED appointments as NO_SHOW when:
 * - Current time > startTime + GRACE_PERIOD_MINUTES (default: 10)
 *
 * Safe to run multiple times (idempotent).
 * Does NOT create HTTP endpoints - backend-only automation.
 *
 * Usage: npx ts-node scripts/detect-no-shows.ts
 */

import 'dotenv/config';
import { prisma } from '../src/db/prisma';
import { detectNoShows } from '../src/services/cancellation.service';
import { NO_SHOW_POLICY } from '../src/config/noShow';

async function main() {
  console.log('No-Show Detection Script');
  console.log('='.repeat(50));
  console.log(`Grace period: ${NO_SHOW_POLICY.GRACE_PERIOD_MINUTES} minutes after start time`);
  console.log(`Current time: ${new Date().toISOString()}`);
  console.log('');

  const result = await detectNoShows(prisma);

  console.log('Results:');
  console.log(`  Appointments scanned: ${result.scanned}`);
  console.log(`  Marked as NO_SHOW:    ${result.markedAsNoShow}`);

  if (result.details.length > 0) {
    console.log('');
    console.log('Details:');
    for (const detail of result.details) {
      console.log(`  - Appointment: ${detail.appointmentId}`);
      console.log(`    Customer:    ${detail.customerId}`);
      console.log(`    No-show count: ${detail.noShowCount}`);
    }
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('Done.');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Error:', error);
  await prisma.$disconnect();
  process.exit(1);
});
