import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@metalique.com.br' },
    update: { name: 'Administrador', role: UserRole.ADMIN, active: true, passwordHash },
    create: { name: 'Administrador', email: 'admin@metalique.com.br', role: UserRole.ADMIN, active: true, passwordHash }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
