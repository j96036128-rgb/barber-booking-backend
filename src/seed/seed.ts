import { prisma } from '../config/prisma';

async function main() {
  console.log('Seeding start...');
  await prisma.$connect();
  console.log('Seeding complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed.', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
