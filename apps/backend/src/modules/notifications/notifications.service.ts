import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'notifications' };
  }

  async list() {
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  }
}
