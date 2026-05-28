import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class TechniciansService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'technicians' };
  }

  async list() {
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
