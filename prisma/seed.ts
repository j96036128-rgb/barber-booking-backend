import { config } from 'dotenv';
import { join } from 'path';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Load from prisma/.env for direct database connection, override any existing DATABASE_URL
config({ path: join(__dirname, '.env'), override: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  /* =========================
     USER (Shop Owner)
     ========================= */
  const shopOwner = await prisma.user.upsert({
    where: { email: 'owner@barbershop.com' },
    update: {},
    create: {
      email: 'owner@barbershop.com',
      password: 'hashed_password_placeholder',
      role: UserRole.SHOP_OWNER,
    },
  });

  /* =========================
     SHOP (ownerId is UNIQUE)
     ========================= */
  const shop = await prisma.shop.upsert({
    where: { ownerId: shopOwner.id },
    update: {},
    create: {
      name: 'Main Street Barbers',
      location: 'Downtown',
      ownerId: shopOwner.id,
    },
  });

  /* =========================
     USER (Barber)
     ========================= */
  const barberUser = await prisma.user.upsert({
    where: { email: 'barber@barbershop.com' },
    update: {},
    create: {
      email: 'barber@barbershop.com',
      password: 'hashed_password_placeholder',
      role: UserRole.BARBER,
    },
  });

  /* =========================
     BARBER (userId is UNIQUE)
     ========================= */
  const barber = await prisma.barber.upsert({
    where: { userId: barberUser.id },
    update: {},
    create: {
      userId: barberUser.id,
      shopId: shop.id,
      active: true,
    },
  });

  /* =========================
     SERVICE (no unique constraint)
     ========================= */
  const existingService = await prisma.service.findFirst({
    where: {
      name: 'Haircut',
      shopId: shop.id,
      barberId: barber.id,
    },
  });

  if (!existingService) {
    await prisma.service.create({
      data: {
        name: 'Haircut',
        durationMinutes: 30,
        priceCents: 2500,
        shopId: shop.id,
        barberId: barber.id,
      },
    });
  }

  /* =========================
     AVAILABILITY (no unique constraint)
     dayOfWeek: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
     ========================= */
  const days = [1, 2, 3, 4, 5]; // Monday through Friday

  for (const dayOfWeek of days) {
    const exists = await prisma.availability.findFirst({
      where: {
        barberId: barber.id,
        dayOfWeek,
        isException: false,
      },
    });

    if (!exists) {
      await prisma.availability.create({
        data: {
          barberId: barber.id,
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
          isException: false,
        },
      });
    }
  }

  console.log('Database seeded successfully');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
