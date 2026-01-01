import 'dotenv/config';
import { prisma } from '../src/db/prisma';
import bcrypt from 'bcrypt';

async function updatePasswords() {
  const hash = await bcrypt.hash('password123', 10);

  await prisma.user.update({
    where: { email: 'owner@barbershop.com' },
    data: { password: hash }
  });

  await prisma.user.update({
    where: { email: 'barber@barbershop.com' },
    data: { password: hash }
  });

  console.log('Passwords updated for seeded users');
}

updatePasswords();
