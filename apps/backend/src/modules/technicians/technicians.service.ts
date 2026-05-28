import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class TechniciansService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'technicians' };
  }

  async list() {
    // Backfill automático: garante que usuários com role TECHNICIAN existam em technicians.
    const techUsers = await this.prisma.user.findMany({
      where: { role: UserRole.TECHNICIAN },
      select: { id: true, name: true, active: true, technician: { select: { id: true } } }
    });

    const missing = techUsers.filter((u) => !u.technician);
    if (missing.length > 0) {
      await this.prisma.$transaction(
        missing.map((user) =>
          this.prisma.technician.create({
            data: {
              userId: user.id,
              name: user.name,
              baseCity: 'Não informado',
              baseAddress: 'Não informado',
              specialties: [],
              active: user.active,
              color: '#2563eb'
            }
          })
        )
      );
    }

    const rows = await this.prisma.technician.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      baseCity: row.baseCity,
      baseAddress: row.baseAddress,
      specialties: row.specialties,
      averageDailyCost: 0,
      availability: 'Seg-Sex',
      hasOwnCar: false,
      canTravel: true,
      active: row.active,
      color: row.color
    }));
  }
}
