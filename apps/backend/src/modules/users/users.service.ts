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
    const rows = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      active: row.active,
      createdAt: row.createdAt
    }));
  }

  async create(body: Record<string, unknown>) {
    const password = String(body.password ?? 'admin123');
    const passwordHash = await bcrypt.hash(password, 10);
    const row = await this.prisma.user.create({
      data: {
        name: String(body.name ?? ''),
        email: String(body.email ?? ''),
        role: this.parseRole(body.role),
        active: body.active !== undefined ? Boolean(body.active) : true,
        passwordHash
      }
    });
    return { id: row.id, name: row.name, email: row.email, role: row.role, active: row.active };
  }

  async update(id: string, body: Record<string, unknown>) {
    const password = body.password ? await bcrypt.hash(String(body.password), 10) : undefined;
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name) : undefined,
        email: body.email !== undefined ? String(body.email) : undefined,
        role: body.role !== undefined ? this.parseRole(body.role) : undefined,
        active: body.active !== undefined ? Boolean(body.active) : undefined,
        passwordHash: password
      }
    });
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
}
