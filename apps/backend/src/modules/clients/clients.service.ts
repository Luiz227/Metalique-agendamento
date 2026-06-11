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
        ie: body.ie ? String(body.ie) : null,
        city: String(body.city ?? ''),
        state: body.state ? String(body.state) : null,
        district: body.district ? String(body.district) : null,
        zipCode: body.zipCode ? String(body.zipCode) : null,
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
        ie: body.ie !== undefined ? (body.ie ? String(body.ie) : null) : undefined,
        city: body.city !== undefined ? String(body.city) : undefined,
        state: body.state !== undefined ? (body.state ? String(body.state) : null) : undefined,
        district: body.district !== undefined ? (body.district ? String(body.district) : null) : undefined,
        zipCode: body.zipCode !== undefined ? (body.zipCode ? String(body.zipCode) : null) : undefined,
        address: body.address !== undefined ? String(body.address) : undefined,
        phone: body.phone !== undefined ? (body.phone ? String(body.phone) : null) : undefined,
        email: body.email !== undefined ? (body.email ? String(body.email) : null) : undefined
      }
    });
  }
}
