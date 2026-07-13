import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

type TrackApiUsageInput = {
  provider: string;
  service: string;
  action: string;
  status?: 'SUCCESS' | 'ERROR' | 'SKIPPED';
  units?: number;
  metadata?: Prisma.InputJsonValue;
  errorMessage?: string | null;
};

@Injectable()
export class ApiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async track(input: TrackApiUsageInput) {
    try {
      await this.prisma.apiUsageLog.create({
        data: {
          provider: input.provider,
          service: input.service,
          action: input.action,
          status: input.status ?? 'SUCCESS',
          units: input.units ?? 1,
          metadata: input.metadata,
          errorMessage: input.errorMessage?.slice(0, 500) ?? null
        }
      });
    } catch {
      // Usage tracking must never break the business flow.
    }
  }

  async summary(daysInput = 30) {
    const days = Math.min(Math.max(Number.isFinite(daysInput) ? Math.floor(daysInput) : 30, 1), 180);
    const to = new Date();
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));

    const where = { createdAt: { gte: from, lte: to } };
    const [logs, byProvider, byService, byStatus] = await Promise.all([
      this.prisma.apiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['provider', 'status'],
        where,
        _sum: { units: true },
        _count: { _all: true }
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['provider', 'service', 'action', 'status'],
        where,
        _sum: { units: true },
        _count: { _all: true }
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['status'],
        where,
        _sum: { units: true },
        _count: { _all: true }
      })
    ]);

    const normalize = <T extends Record<string, unknown>>(rows: T[]) =>
      rows
        .map((row) => ({
          ...row,
          units: Number((row as { _sum?: { units?: number | null } })._sum?.units ?? 0),
          requests: Number((row as { _count?: { _all?: number } })._count?._all ?? 0)
        }))
        .sort((a, b) => b.units - a.units);

    const serviceRows = normalize(byService);
    const totalUnits = serviceRows.reduce((sum, row) => sum + row.units, 0);
    const totalRequests = serviceRows.reduce((sum, row) => sum + row.requests, 0);

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days },
      totals: { units: totalUnits, requests: totalRequests },
      byProvider: normalize(byProvider),
      byService: serviceRows,
      byStatus: normalize(byStatus),
      recent: logs.map((log) => ({
        id: log.id,
        provider: log.provider,
        service: log.service,
        action: log.action,
        status: log.status,
        units: log.units,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt.toISOString()
      }))
    };
  }
}
