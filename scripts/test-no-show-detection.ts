/**
 * Phase 6.2 No-Show Detection Sanity Tests
 *
 * Tests:
 * A. Appointment before grace period → untouched
 * B. Appointment after grace period → NO_SHOW
 * C. CANCELLED appointment → untouched
 * D. COMPLETED appointment → untouched
 * E. Re-run script → no duplicate changes (idempotency)
 */

import 'dotenv/config';
import { AppointmentStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../src/db/prisma';
import { detectNoShows } from '../src/services/cancellation.service';
import { NO_SHOW_POLICY } from '../src/config/noShow';

interface TestResult {
  name: string;
  passed: boolean;
  notes: string;
}

const results: TestResult[] = [];

async function getTestData(): Promise<{ barberId: string; serviceId: string }> {
  const shop = await prisma.shop.findFirst({
    include: {
      barbers: true,
      services: true,
    },
  });

  if (!shop || shop.barbers.length === 0 || shop.services.length === 0) {
    throw new Error('No shop with barbers and services found. Run seed first.');
  }

  return {
    barberId: shop.barbers[0].id,
    serviceId: shop.services[0].id,
  };
}

async function createTestCustomer(email: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email,
      password: 'test-hash',
      role: 'CUSTOMER',
    },
  });
  return user.id;
}

// ============================================================================
// TEST A: Appointment before grace period → untouched
// ============================================================================
async function testBeforeGracePeriod(): Promise<TestResult> {
  const testName = 'Before grace period';
  try {
    const { barberId, serviceId } = await getTestData();
    const customerId = await createTestCustomer(`before-grace-${Date.now()}@test.com`);

    // Create CONFIRMED appointment that started 5 minutes ago (within grace period)
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 5); // 5 min ago (grace is 10 min)

    const appointment = await prisma.appointment.create({
      data: {
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        barberId,
        customerId,
        serviceId,
      },
    });

    // Run detection
    await detectNoShows(prisma);

    // Check appointment status - should still be CONFIRMED
    const afterDetection = await prisma.appointment.findUnique({
      where: { id: appointment.id },
    });

    if (afterDetection?.status !== AppointmentStatus.CONFIRMED) {
      return {
        name: testName,
        passed: false,
        notes: `Expected CONFIRMED, got ${afterDetection?.status}`,
      };
    }

    return {
      name: testName,
      passed: true,
      notes: `Still CONFIRMED (within ${NO_SHOW_POLICY.GRACE_PERIOD_MINUTES}min grace)`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      notes: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST B: Appointment after grace period → NO_SHOW
// ============================================================================
async function testAfterGracePeriod(): Promise<TestResult> {
  const testName = 'After grace period';
  try {
    const { barberId, serviceId } = await getTestData();
    const customerId = await createTestCustomer(`after-grace-${Date.now()}@test.com`);

    // Create CONFIRMED appointment that started 15 minutes ago (past grace period)
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 15); // 15 min ago (grace is 10 min)

    const appointment = await prisma.appointment.create({
      data: {
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        barberId,
        customerId,
        serviceId,
      },
    });

    // Create payment record (PAID - deposit forfeited)
    await prisma.payment.create({
      data: {
        stripePaymentIntentId: `pi_test_noshow_${Date.now()}`,
        amountCents: 500,
        currency: 'gbp',
        status: PaymentStatus.PAID,
        customerId,
        appointmentId: appointment.id,
      },
    });

    // Run detection
    const result = await detectNoShows(prisma);

    // Check appointment status - should be NO_SHOW
    const afterDetection = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      include: { payment: true },
    });

    if (afterDetection?.status !== AppointmentStatus.NO_SHOW) {
      return {
        name: testName,
        passed: false,
        notes: `Expected NO_SHOW, got ${afterDetection?.status}`,
      };
    }

    // Check payment is still PAID (deposit forfeited)
    if (afterDetection?.payment?.status !== PaymentStatus.PAID) {
      return {
        name: testName,
        passed: false,
        notes: `Payment status changed to ${afterDetection?.payment?.status}, expected PAID`,
      };
    }

    // Check no-show count incremented
    const noShowFlag = await prisma.noShowFlag.findUnique({
      where: { customerId },
    });

    if (!noShowFlag || noShowFlag.count < 1) {
      return {
        name: testName,
        passed: false,
        notes: `No-show count not incremented`,
      };
    }

    return {
      name: testName,
      passed: true,
      notes: `Marked NO_SHOW, payment PAID, count=${noShowFlag.count}`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      notes: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST C: CANCELLED appointment → untouched
// ============================================================================
async function testCancelledUntouched(): Promise<TestResult> {
  const testName = 'CANCELLED untouched';
  try {
    const { barberId, serviceId } = await getTestData();
    const customerId = await createTestCustomer(`cancelled-${Date.now()}@test.com`);

    // Create CANCELLED appointment (past grace period)
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 30); // 30 min ago

    const appointment = await prisma.appointment.create({
      data: {
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CANCELLED,
        barberId,
        customerId,
        serviceId,
      },
    });

    // Run detection
    await detectNoShows(prisma);

    // Check appointment status - should still be CANCELLED
    const afterDetection = await prisma.appointment.findUnique({
      where: { id: appointment.id },
    });

    if (afterDetection?.status !== AppointmentStatus.CANCELLED) {
      return {
        name: testName,
        passed: false,
        notes: `Expected CANCELLED, got ${afterDetection?.status}`,
      };
    }

    return {
      name: testName,
      passed: true,
      notes: 'CANCELLED appointment ignored',
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      notes: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST D: COMPLETED appointment → untouched
// ============================================================================
async function testCompletedUntouched(): Promise<TestResult> {
  const testName = 'COMPLETED untouched';
  try {
    const { barberId, serviceId } = await getTestData();
    const customerId = await createTestCustomer(`completed-${Date.now()}@test.com`);

    // Create COMPLETED appointment (past grace period)
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 30); // 30 min ago

    const appointment = await prisma.appointment.create({
      data: {
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.COMPLETED,
        barberId,
        customerId,
        serviceId,
      },
    });

    // Run detection
    await detectNoShows(prisma);

    // Check appointment status - should still be COMPLETED
    const afterDetection = await prisma.appointment.findUnique({
      where: { id: appointment.id },
    });

    if (afterDetection?.status !== AppointmentStatus.COMPLETED) {
      return {
        name: testName,
        passed: false,
        notes: `Expected COMPLETED, got ${afterDetection?.status}`,
      };
    }

    return {
      name: testName,
      passed: true,
      notes: 'COMPLETED appointment ignored',
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      notes: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// TEST E: Re-run script → no duplicate changes (idempotency)
// ============================================================================
async function testIdempotency(): Promise<TestResult> {
  const testName = 'Idempotency';
  try {
    const { barberId, serviceId } = await getTestData();
    const customerId = await createTestCustomer(`idempotent-${Date.now()}@test.com`);

    // Create CONFIRMED appointment past grace period
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - 20); // 20 min ago

    const appointment = await prisma.appointment.create({
      data: {
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        barberId,
        customerId,
        serviceId,
      },
    });

    // First run - should mark as NO_SHOW
    const firstRun = await detectNoShows(prisma);

    // Get no-show count after first run
    const afterFirstRun = await prisma.noShowFlag.findUnique({
      where: { customerId },
    });
    const countAfterFirst = afterFirstRun?.count ?? 0;

    // Second run - should NOT process the same appointment again
    const secondRun = await detectNoShows(prisma);

    // Get no-show count after second run
    const afterSecondRun = await prisma.noShowFlag.findUnique({
      where: { customerId },
    });
    const countAfterSecond = afterSecondRun?.count ?? 0;

    // Verify second run didn't increment count
    if (countAfterSecond !== countAfterFirst) {
      return {
        name: testName,
        passed: false,
        notes: `Count changed: ${countAfterFirst} → ${countAfterSecond}`,
      };
    }

    // Verify second run didn't process any appointments for this user
    const processedSecondRun = secondRun.details.filter(
      (d) => d.appointmentId === appointment.id
    );
    if (processedSecondRun.length > 0) {
      return {
        name: testName,
        passed: false,
        notes: 'Appointment processed twice',
      };
    }

    return {
      name: testName,
      passed: true,
      notes: `Run1: ${firstRun.markedAsNoShow} marked, Run2: ${secondRun.markedAsNoShow} marked`,
    };
  } catch (error) {
    return {
      name: testName,
      passed: false,
      notes: `Error: ${error instanceof Error ? error.message : error}`,
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  console.log('Running Phase 6.2 No-Show Detection Sanity Tests\n');
  console.log(`Grace period: ${NO_SHOW_POLICY.GRACE_PERIOD_MINUTES} minutes`);
  console.log('='.repeat(60));

  results.push(await testBeforeGracePeriod());
  results.push(await testAfterGracePeriod());
  results.push(await testCancelledUntouched());
  results.push(await testCompletedUntouched());
  results.push(await testIdempotency());

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS\n');
  console.log('Test Case                  | Result | Notes');
  console.log('---------------------------|--------|------');

  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const name = result.name.padEnd(26);
    console.log(`${name} | ${status.padEnd(6)} | ${result.notes}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log('\n' + '='.repeat(60));
  console.log(`Summary: ${passed}/${total} tests passed`);

  if (passed < total) {
    console.log('\nFAILED TESTS:');
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.notes}`);
    }
  }

  await prisma.$disconnect();
  process.exit(passed === total ? 0 : 1);
}

main().catch(console.error);
