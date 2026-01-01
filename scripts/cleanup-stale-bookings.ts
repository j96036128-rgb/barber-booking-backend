/**
 * Stale Booking Cleanup Script
 *
 * Cancels unpaid BOOKED appointments that are older than 30 minutes.
 * This frees up time slots for other customers.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: npx ts-node scripts/cleanup-stale-bookings.ts
 *
 * For production: Run via cron every 5-10 minutes
 */

import 'dotenv/config';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../src/db/prisma';

const STALE_THRESHOLD_MINUTES = 30;

async function cleanupStaleBookings() {
  console.log('Stale Booking Cleanup');
  console.log('='.repeat(50));
  console.log(`Threshold: ${STALE_THRESHOLD_MINUTES} minutes`);
  console.log(`Current time: ${new Date().toISOString()}`);
  console.log('');

  const cutoffTime = new Date();
  cutoffTime.setMinutes(cutoffTime.getMinutes() - STALE_THRESHOLD_MINUTES);

  // Find BOOKED appointments created more than 30 minutes ago
  // that have no payment or payment is still REQUIRES_PAYMENT
  const staleAppointments = await prisma.appointment.findMany({
    where: {
      status: AppointmentStatus.BOOKED,
      createdAt: { lt: cutoffTime },
      OR: [
        { payment: null }, // No payment record
        { payment: { status: 'REQUIRES_PAYMENT' } }, // Payment not completed
      ],
    },
    include: {
      payment: true,
      customer: { select: { email: true } },
      barber: { select: { id: true } },
      service: { select: { name: true } },
    },
  });

  console.log(`Found ${staleAppointments.length} stale booking(s)`);

  if (staleAppointments.length === 0) {
    console.log('No stale bookings to clean up.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // Cancel each stale appointment
  let cancelled = 0;
  for (const appointment of staleAppointments) {
    try {
      await prisma.$transaction(async (tx) => {
        // Update appointment status to CANCELLED
        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancellationReason: 'Automatic cancellation: payment not completed within 30 minutes',
          },
        });

        // If there's a payment record, mark it as FAILED
        if (appointment.payment) {
          await tx.payment.update({
            where: { id: appointment.payment.id },
            data: { status: 'FAILED' },
          });
        }
      });

      console.log(`  Cancelled: ${appointment.id}`);
      console.log(`    Customer: ${appointment.customer.email}`);
      console.log(`    Service: ${appointment.service.name}`);
      console.log(`    Created: ${appointment.createdAt.toISOString()}`);
      cancelled++;
    } catch (error) {
      console.error(`  Failed to cancel ${appointment.id}:`, error);
    }
  }

  console.log('');
  console.log('='.repeat(50));
  console.log(`Summary: ${cancelled}/${staleAppointments.length} appointments cancelled`);

  await prisma.$disconnect();
  process.exit(0); // Explicit success exit for cron
}

cleanupStaleBookings().catch(async (error) => {
  console.error('Cleanup failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
