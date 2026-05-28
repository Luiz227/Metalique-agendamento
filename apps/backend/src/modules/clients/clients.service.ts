import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'clients' };
  }

  async list() {
    return this.prisma.client.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(body: Record<string, unknown>) {
    return this.prisma.client.create({
      data: {
        name: String(body.name ?? ''),
        cnpj: body.cnpj ? String(body.cnpj) : null,
        city: String(body.city ?? ''),
        address: String(body.address ?? ''),
        phone: body.phone ? String(body.phone) : null,
        email: body.email ? String(body.email) : null
      }
    });
  }

  async update(id: string, body: Record<string, unknown>) {
    return this.prisma.client.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name) : undefined,
        cnpj: body.cnpj !== undefined ? (body.cnpj ? String(body.cnpj) : null) : undefined,
        city: body.city !== undefined ? String(body.city) : undefined,
        address: body.address !== undefined ? String(body.address) : undefined,
        phone: body.phone !== undefined ? (body.phone ? String(body.phone) : null) : undefined,
        email: body.email !== undefined ? (body.email ? String(body.email) : null) : undefined
      }
    });
  }
}
