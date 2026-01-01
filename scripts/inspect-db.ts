import { prisma } from '../src/db/prisma';

async function main() {
  const shops = await prisma.shop.findMany({
    include: {
      owner: true,
      barbers: {
        include: {
          user: true,
          services: true,
          availability: true,
        },
      },
      services: true,
    },
  });

  console.dir(shops, { depth: null });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
