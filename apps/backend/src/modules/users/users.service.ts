import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'users' };
  }

  async list() {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { technician: { select: { id: true, name: true, color: true, active: true } } }
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      active: row.active,
      technician: row.technician ?? null,
      createdAt: row.createdAt
    }));
  }

  async create(body: Record<string, unknown>) {
    const password = String(body.password ?? 'admin123');
    const passwordHash = await bcrypt.hash(password, 10);
    const role = this.parseRole(body.role);
    const row = await this.prisma.user.create({
      data: {
        name: String(body.name ?? ''),
        email: String(body.email ?? ''),
        role,
        active: body.active !== undefined ? Boolean(body.active) : true,
        passwordHash
      }
    });

    if (role === UserRole.TECHNICIAN) {
      await this.prisma.technician.upsert({
        where: { userId: row.id },
        update: {
          name: row.name,
          active: row.active,
          color: this.parseColor(body.technicianColor)
        },
        create: {
          userId: row.id,
          name: row.name,
          baseCity: 'Não informado',
          baseAddress: 'Não informado',
          specialties: [],
          active: row.active,
          color: this.parseColor(body.technicianColor)
        }
      });
    }

    return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
  }

  async update(id: string, body: Record<string, unknown>) {
    const password = body.password ? await bcrypt.hash(String(body.password), 10) : undefined;
    const nextRole = body.role !== undefined ? this.parseRole(body.role) : undefined;
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name) : undefined,
        email: body.email !== undefined ? String(body.email) : undefined,
        role: nextRole,
        active: body.active !== undefined ? Boolean(body.active) : undefined,
        passwordHash: password
      }
    });

    const effectiveRole = nextRole ?? row.role;
    if (effectiveRole === UserRole.TECHNICIAN) {
      await this.prisma.technician.upsert({
        where: { userId: row.id },
        update: {
          name: row.name,
          active: row.active,
          color: this.parseColor(body.technicianColor)
        },
        create: {
          userId: row.id,
          name: row.name,
          baseCity: 'Não informado',
          baseAddress: 'Não informado',
          specialties: [],
          active: row.active,
          color: this.parseColor(body.technicianColor)
        }
      });
    } else {
      await this.prisma.technician.updateMany({
        where: { userId: row.id },
        data: { active: false }
      });
    }

    return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  private parseRole(role: unknown): UserRole {
    const value = String(role ?? 'LOGISTICS').toUpperCase();
    if (value === 'ADMIN') return UserRole.ADMIN;
    if (value === 'TECHNICIAN') return UserRole.TECHNICIAN;
    if (value === 'VALIDATOR') return UserRole.VALIDATOR;
    return UserRole.LOGISTICS;
  }

  private parseColor(input: unknown): string {
    const color = String(input ?? '#2563eb').trim();
    return /^#([0-9a-fA-F]{6})$/.test(color) ? color : '#2563eb';
  }
}
