import { Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class LegacyService {
  constructor(private readonly prisma: PrismaService) {}

  async resourcesVehicles() {
    return this.prisma.vehicle.findMany({ orderBy: { name: 'asc' } });
  }

  async resourcesHotels() {
    return this.prisma.hotel.findMany({ orderBy: { name: 'asc' } });
  }

  async financeExpenses() {
    return this.prisma.expense.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async getSettings() {
    return {
      companyName: 'Metalique',
      timezone: 'America/Sao_Paulo',
      language: 'pt-BR'
    };
  }

  async putSettings(payload: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: { entity: 'settings', action: 'UPDATE', metadata: payload as Prisma.InputJsonValue }
    });
    return { ok: true };
  }

  async getSla() {
    return { warningHours: 24, criticalHours: 48 };
  }

  async putSla(payload: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: { entity: 'settings_sla', action: 'UPDATE', metadata: payload as Prisma.InputJsonValue }
    });
    return { ok: true };
  }

  async listSuggestions(query: { from?: string; to?: string }) {
    const where: Prisma.RouteSuggestionWhereInput = {};
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    const rows = await this.prisma.routeSuggestion.findMany({
      where,
      include: {
        originAppointment: { include: { client: true, technician: true, statusLogs: true } },
        nearbyAppointment: { include: { client: true, technician: true, statusLogs: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map((row) => ({
      id: row.id,
      distanceKm: row.distanceKm,
      durationMinutes: row.durationMinutes,
      score: row.score,
      potentialSavings: Math.round(row.score * 10),
      reason: 'Sugestão automática de agrupamento',
      status: row.status,
      originAppointment: this.toSimpleAppointment(row.originAppointment),
      nearbyAppointment: this.toSimpleAppointment(row.nearbyAppointment)
    }));
  }

  async updateSuggestion(id: string, body: { status?: string }) {
    await this.prisma.routeSuggestion.update({
      where: { id },
      data: { status: String(body.status ?? 'OPEN').toUpperCase() }
    });
    return { ok: true };
  }

  async listValidations() {
    const rows = await this.prisma.finalValidation.findMany({
      include: { appointment: { include: { client: true, technician: true, statusLogs: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map((row) => ({
      id: row.id,
      approved: row.approved,
      notes: row.notes,
      validatorName: row.validatorName,
      appointment: this.toSimpleAppointment(row.appointment)
    }));
  }

  async createValidation(body: Record<string, unknown>) {
    const appointmentId = String(body.appointmentId ?? '');
    const row = await this.prisma.finalValidation.upsert({
      where: { appointmentId },
      update: {
        approved: Boolean(body.approved),
        notes: body.notes ? String(body.notes) : null,
        validatorName: String(body.validatorName ?? 'Validador')
      },
      create: {
        appointmentId,
        approved: Boolean(body.approved),
        notes: body.notes ? String(body.notes) : null,
        validatorName: String(body.validatorName ?? 'Validador')
      }
    });
    return row;
  }

  async reportsSummary() {
    const [cities, suggestionsAccepted, suggestionsIgnored] = await Promise.all([
      this.prisma.client.groupBy({ by: ['city'], _count: { city: true } }),
      this.prisma.routeSuggestion.count({ where: { status: 'ACCEPTED' } }),
      this.prisma.routeSuggestion.count({ where: { status: 'IGNORED' } })
    ]);
    return {
      byCity: cities.map((c) => ({ city: c.city, total: c._count.city })),
      suggestionsAccepted,
      suggestionsIgnored
    };
  }

  async reportsTechnical() {
    const rows = await this.prisma.statusLog.findMany({
      where: { status: { in: ['COMPLETED_SUCCESS', 'COMPLETED_PARTIAL'] } },
      include: { appointment: { include: { client: true, technician: true, attachments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return rows.map((row) => ({
      id: row.id,
      summary: row.observation ?? 'Relatório técnico',
      diagnosis: null,
      solution: null,
      pendingItems: null,
      createdAt: row.createdAt,
      technician: {
        id: row.appointment.technician?.id ?? 'unknown',
        name: row.appointment.technician?.name ?? 'Sem técnico',
        color: row.appointment.technician?.color ?? '#3b82f6'
      },
      appointment: {
        id: row.appointment.id,
        city: row.appointment.city,
        date: row.appointment.date,
        serviceType: row.appointment.serviceType,
        fullAddress: row.appointment.fullAddress,
        client: row.appointment.client,
        attachments: row.appointment.attachments.map((a) => ({
          id: a.id,
          type: 'midia-tecnica',
          originalName: a.originalName,
          fileName: a.originalName,
          mimeType: a.mimeType,
          size: a.size,
          path: a.publicUrl ?? '',
          uploadedAt: a.createdAt
        }))
      }
    }));
  }

  async technicianAppointments(userId: string | null) {
    if (!userId) return [];
    const technician = await this.prisma.technician.findFirst({ where: { userId } });
    if (!technician) return [];
    const rows = await this.prisma.appointment.findMany({
      where: { technicianId: technician.id, status: { in: [AppointmentStatus.READY, AppointmentStatus.CRITICAL, AppointmentStatus.WAITING] } },
      include: { client: true, technician: true, statusLogs: { orderBy: { createdAt: 'desc' } } },
      orderBy: { date: 'asc' }
    });
    return rows.map((row) => this.toSimpleAppointment(row));
  }

  async technicianSetStatus(id: string, status: string, observation?: string) {
    await this.prisma.statusLog.create({ data: { appointmentId: id, status, observation: observation ?? null } });
    return { ok: true };
  }

  async technicianReport(id: string, summary?: string) {
    await this.prisma.statusLog.create({
      data: { appointmentId: id, status: 'COMPLETED_SUCCESS', observation: summary ?? 'Atendimento finalizado pelo técnico' }
    });
    await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CRITICAL } });
    return { ok: true };
  }

  async attachFile(
    appointmentId: string,
    file?: { originalname?: string; mimetype?: string; size?: number },
    type?: string
  ) {
    const exists = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Agendamento não encontrado');
    const originalName = file?.originalname ?? 'arquivo.bin';
    const mimeType = file?.mimetype ?? 'application/octet-stream';
    const size = file?.size ?? 0;
    await this.prisma.attachment.create({
      data: {
        appointmentId,
        driveFileId: `local-${Date.now()}`,
        driveFolderPath: 'temporario',
        originalName,
        mimeType,
        size,
        publicUrl: ''
      }
    });
    return { ok: true, type: type ?? 'midia-tecnica' };
  }

  private toSimpleAppointment(row: {
    id: string;
    clientId: string;
    technicianId: string | null;
    city: string;
    fullAddress: string;
    serviceType: string;
    problemDescription: string | null;
    date: Date;
    startTime: Date;
    endTime: Date;
    status: AppointmentStatus;
    notes: string | null;
    osNumber: string | null;
    daysOut: number;
    client: { id: string; name: string; city: string; address: string; phone: string | null; email: string | null };
    technician: { id: string; name: string; baseCity: string; baseAddress: string; specialties: string[]; active: boolean; color: string } | null;
    statusLogs: { id: string; status: string; createdAt: Date; observation: string | null }[];
  }) {
    return {
      id: row.id,
      clientId: row.clientId,
      technicianId: row.technicianId,
      city: row.city,
      fullAddress: row.fullAddress,
      serviceType: row.serviceType,
      problemDescription: row.problemDescription,
      date: row.date.toISOString(),
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
      status: row.status === AppointmentStatus.READY ? 'READY' : row.status === AppointmentStatus.CRITICAL ? 'CRITICAL' : 'WAITING',
      notes: row.notes,
      osNumber: row.osNumber,
      daysOut: row.daysOut,
      needsHotel: false,
      needsTransport: false,
      clientChecklist: row.notes,
      schedulingChecklist: {
        clientConfirmed: true,
        contactConfirmed: true,
        addressConfirmed: true,
        serviceTypeConfirmed: true,
        technicianSelected: !!row.technicianId,
        technicianAvailability: !!row.technicianId,
        dateTimeConfirmed: true,
        hotelNeedChecked: true,
        transportNeedChecked: true,
        osChecked: true,
        clientChecklistChecked: true
      },
      client: row.client,
      technician: row.technician
        ? {
            ...row.technician,
            averageDailyCost: 0,
            availability: 'Seg-Sex',
            hasOwnCar: false,
            canTravel: true
          }
        : null,
      statusLogs: row.statusLogs.map((log) => ({
        id: log.id,
        status: log.status,
        createdAt: log.createdAt.toISOString(),
        observation: log.observation
      }))
    };
  }
}
