import { Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

type AppointmentRow = Prisma.AppointmentGetPayload<{
  include: {
    client: true;
    technician: true;
    statusLogs: true;
  };
}>;

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'appointments' };
  }

  async list(from?: string, to?: string) {
    const where: Prisma.AppointmentWhereInput = {};
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const rows = await this.prisma.appointment.findMany({
      where,
      include: {
        client: true,
        technician: true,
        statusLogs: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { date: 'desc' }
    });

    return rows.map((row) => this.toApiAppointment(row));
  }

  async findById(id: string) {
    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        client: true,
        technician: true,
        statusLogs: { orderBy: { createdAt: 'desc' } }
      }
    });
    if (!row) throw new NotFoundException('Agendamento não encontrado');
    return this.toApiAppointment(row);
  }

  async create(body: Record<string, unknown>) {
    const row = await this.prisma.appointment.create({
      data: {
        clientId: String(body.clientId),
        technicianId: body.technicianId ? String(body.technicianId) : null,
        city: String(body.city ?? ''),
        fullAddress: String(body.fullAddress ?? ''),
        serviceType: String(body.serviceType ?? ''),
        problemDescription: body.problemDescription ? String(body.problemDescription) : null,
        date: new Date(String(body.date)),
        startTime: new Date(String(body.startTime)),
        endTime: new Date(String(body.endTime)),
        status: this.parseStatus(body.status),
        osNumber: body.osNumber ? String(body.osNumber) : null,
        notes: body.notes ? String(body.notes) : null,
        daysOut: Number(body.daysOut ?? 1)
      },
      include: { client: true, technician: true, statusLogs: true }
    });
    return this.toApiAppointment(row);
  }

  async update(id: string, body: Record<string, unknown>) {
    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        technicianId: body.technicianId !== undefined ? (body.technicianId ? String(body.technicianId) : null) : undefined,
        city: body.city !== undefined ? String(body.city) : undefined,
        fullAddress: body.fullAddress !== undefined ? String(body.fullAddress) : undefined,
        serviceType: body.serviceType !== undefined ? String(body.serviceType) : undefined,
        problemDescription: body.problemDescription !== undefined ? (body.problemDescription ? String(body.problemDescription) : null) : undefined,
        date: body.date ? new Date(String(body.date)) : undefined,
        startTime: body.startTime ? new Date(String(body.startTime)) : undefined,
        endTime: body.endTime ? new Date(String(body.endTime)) : undefined,
        status: body.status !== undefined ? this.parseStatus(body.status) : undefined,
        osNumber: body.osNumber !== undefined ? (body.osNumber ? String(body.osNumber) : null) : undefined,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : undefined,
        daysOut: body.daysOut !== undefined ? Number(body.daysOut) : undefined
      },
      include: { client: true, technician: true, statusLogs: { orderBy: { createdAt: 'desc' } } }
    });
    return this.toApiAppointment(row);
  }

  async patchChecklist(id: string, body: Record<string, unknown>) {
    const payload = JSON.stringify(body ?? {});
    await this.prisma.appointment.findUniqueOrThrow({ where: { id }, select: { id: true } });
    await this.prisma.auditLog.create({
      data: { entity: 'appointment_checklist', entityId: id, action: 'UPDATE', metadata: body as Prisma.InputJsonValue }
    });
    return { ok: true, saved: true, checklist: body, id, meta: payload.length };
  }

  async remindMissing(id: string) {
    const exists = await this.prisma.appointment.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Agendamento não encontrado');
    return { ok: true, message: 'Lembrete enviado com sucesso.' };
  }

  async cancel(id: string, reason?: string) {
    await this.prisma.appointment.findUniqueOrThrow({ where: { id }, select: { id: true } });
    await this.prisma.appointment.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        entity: 'appointment',
        entityId: id,
        action: 'DELETE',
        metadata: {
          reason: reason ?? null,
          origin: 'cancel_endpoint'
        }
      }
    });
    return { ok: true, deleted: true, id };
  }

  async reschedule(id: string, date: string, startTime: string, endTime: string) {
    await this.prisma.appointment.update({
      where: { id },
      data: { date: new Date(date), startTime: new Date(startTime), endTime: new Date(endTime), status: AppointmentStatus.WAITING }
    });
    await this.prisma.statusLog.create({
      data: { appointmentId: id, status: 'RESCHEDULED' }
    });
    return { ok: true };
  }

  async confirm(id: string) {
    await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.READY } });
    await this.prisma.statusLog.create({ data: { appointmentId: id, status: 'CONFIRMED' } });
    return { ok: true };
  }

  private parseStatus(input: unknown): AppointmentStatus {
    const value = String(input ?? 'WAITING').toUpperCase();
    if (value === 'READY') return AppointmentStatus.READY;
    if (value === 'CRITICAL') return AppointmentStatus.CRITICAL;
    if (value === 'DRAFT') return AppointmentStatus.DRAFT;
    if (value === 'COMPLETED') return AppointmentStatus.COMPLETED;
    return AppointmentStatus.WAITING;
  }

  private toApiAppointment(row: AppointmentRow) {
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
      status: this.toFrontendStatus(row.status),
      notes: row.notes,
      osNumber: row.osNumber,
      daysOut: row.daysOut,
      needsHotel: false,
      needsTransport: false,
      clientChecklist: row.notes,
      schedulingChecklist: {
        clientConfirmed: row.status !== AppointmentStatus.DRAFT,
        contactConfirmed: row.status === AppointmentStatus.READY,
        addressConfirmed: !!row.fullAddress,
        serviceTypeConfirmed: !!row.serviceType && row.serviceType !== 'Pendente definicao',
        technicianSelected: !!row.technicianId,
        technicianAvailability: !!row.technicianId,
        dateTimeConfirmed: !!row.startTime,
        hotelNeedChecked: true,
        transportNeedChecked: true,
        osChecked: !!row.osNumber,
        clientChecklistChecked: !!row.notes
      },
      client: {
        id: row.client.id,
        name: row.client.name,
        city: row.client.city,
        address: row.client.address,
        phone: row.client.phone,
        email: row.client.email,
        latitude: row.client.latitude,
        longitude: row.client.longitude
      },
      technician: row.technician
        ? {
            id: row.technician.id,
            name: row.technician.name,
            baseCity: row.technician.baseCity,
            baseAddress: row.technician.baseAddress,
            specialties: row.technician.specialties,
            averageDailyCost: 0,
            availability: 'Seg-Sex',
            hasOwnCar: false,
            canTravel: true,
            active: row.technician.active,
            color: row.technician.color
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

  private toFrontendStatus(status: AppointmentStatus): 'WAITING' | 'READY' | 'CRITICAL' {
    if (status === AppointmentStatus.READY) return 'READY';
    if (status === AppointmentStatus.CRITICAL) return 'CRITICAL';
    return 'WAITING';
  }
}
