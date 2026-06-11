import { Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

type AppointmentRow = Prisma.AppointmentGetPayload<{
  include: {
    client: true;
    technician: true;
    attachments: true;
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
        attachments: true,
        statusLogs: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { date: 'desc' }
    });

    const checklistById = await this.getChecklistOverrides(rows.map((row) => row.id));
    return rows.map((row) => this.toApiAppointment(row, checklistById.get(row.id)));
  }

  async findById(id: string) {
    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        client: true,
        technician: true,
        attachments: true,
        statusLogs: { orderBy: { createdAt: 'desc' } }
      }
    });
    if (!row) throw new NotFoundException('Agendamento não encontrado');
    const checklist = await this.getLatestChecklist(id);
    return this.toApiAppointment(row, checklist);
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
        daysOut: Number(body.daysOut ?? 1),
        machineCode: body.machineCode ? String(body.machineCode) : null,
        machineName: body.machineName ? String(body.machineName) : null,
        machineModel: body.machineModel ? String(body.machineModel) : null,
        machineSerial: body.machineSerial ? String(body.machineSerial) : null,
        machineManufacturer: body.machineManufacturer ? String(body.machineManufacturer) : null,
        machineObservations: body.machineObservations ? String(body.machineObservations) : null,
        serviceCode: body.serviceCode ? String(body.serviceCode) : null,
        serviceItemDescription: body.serviceItemDescription ? String(body.serviceItemDescription) : null,
        hasHotel: Boolean(body.hasHotel),
        hotelName: body.hotelName ? String(body.hotelName) : null,
        hotelAddress: body.hotelAddress ? String(body.hotelAddress) : null,
        hotelCheckIn: body.hotelCheckIn ? new Date(String(body.hotelCheckIn)) : null,
        hotelCheckOut: body.hotelCheckOut ? new Date(String(body.hotelCheckOut)) : null,
        hotelDailyRate: body.hotelDailyRate ? new Prisma.Decimal(String(body.hotelDailyRate)) : null,
        hotelNotes: body.hotelNotes ? String(body.hotelNotes) : null,
        transportMode: body.transportMode ? String(body.transportMode) : null,
        flightAirport: body.flightAirport ? String(body.flightAirport) : null,
        flightDepartureAt: body.flightDepartureAt ? new Date(String(body.flightDepartureAt)) : null,
        flightReturnAt: body.flightReturnAt ? new Date(String(body.flightReturnAt)) : null
      },
      include: { client: true, technician: true, attachments: true, statusLogs: true }
    });
    if (body.schedulingChecklist && typeof body.schedulingChecklist === 'object') {
      await this.prisma.auditLog.create({
        data: {
          entity: 'appointment_checklist',
          entityId: row.id,
          action: 'UPDATE',
          metadata: body.schedulingChecklist as Prisma.InputJsonValue
        }
      });
    }
    return this.toApiAppointment(row, this.parseChecklist(body.schedulingChecklist));
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
        daysOut: body.daysOut !== undefined ? Number(body.daysOut) : undefined,
        machineCode: body.machineCode !== undefined ? (body.machineCode ? String(body.machineCode) : null) : undefined,
        machineName: body.machineName !== undefined ? (body.machineName ? String(body.machineName) : null) : undefined,
        machineModel: body.machineModel !== undefined ? (body.machineModel ? String(body.machineModel) : null) : undefined,
        machineSerial: body.machineSerial !== undefined ? (body.machineSerial ? String(body.machineSerial) : null) : undefined,
        machineManufacturer: body.machineManufacturer !== undefined ? (body.machineManufacturer ? String(body.machineManufacturer) : null) : undefined,
        machineObservations: body.machineObservations !== undefined ? (body.machineObservations ? String(body.machineObservations) : null) : undefined,
        serviceCode: body.serviceCode !== undefined ? (body.serviceCode ? String(body.serviceCode) : null) : undefined,
        serviceItemDescription: body.serviceItemDescription !== undefined ? (body.serviceItemDescription ? String(body.serviceItemDescription) : null) : undefined,
        hasHotel: body.hasHotel !== undefined ? Boolean(body.hasHotel) : undefined,
        hotelName: body.hotelName !== undefined ? (body.hotelName ? String(body.hotelName) : null) : undefined,
        hotelAddress: body.hotelAddress !== undefined ? (body.hotelAddress ? String(body.hotelAddress) : null) : undefined,
        hotelCheckIn: body.hotelCheckIn !== undefined ? (body.hotelCheckIn ? new Date(String(body.hotelCheckIn)) : null) : undefined,
        hotelCheckOut: body.hotelCheckOut !== undefined ? (body.hotelCheckOut ? new Date(String(body.hotelCheckOut)) : null) : undefined,
        hotelDailyRate: body.hotelDailyRate !== undefined ? (body.hotelDailyRate ? new Prisma.Decimal(String(body.hotelDailyRate)) : null) : undefined,
        hotelNotes: body.hotelNotes !== undefined ? (body.hotelNotes ? String(body.hotelNotes) : null) : undefined,
        transportMode: body.transportMode !== undefined ? (body.transportMode ? String(body.transportMode) : null) : undefined,
        flightAirport: body.flightAirport !== undefined ? (body.flightAirport ? String(body.flightAirport) : null) : undefined,
        flightDepartureAt: body.flightDepartureAt !== undefined ? (body.flightDepartureAt ? new Date(String(body.flightDepartureAt)) : null) : undefined,
        flightReturnAt: body.flightReturnAt !== undefined ? (body.flightReturnAt ? new Date(String(body.flightReturnAt)) : null) : undefined
      },
      include: { client: true, technician: true, attachments: true, statusLogs: { orderBy: { createdAt: 'desc' } } }
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

  private toApiAppointment(row: AppointmentRow, checklistOverride?: Partial<Record<ChecklistKey, boolean>>) {
    const derivedChecklist: Record<ChecklistKey, boolean> = {
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
    };
    const schedulingChecklist = { ...derivedChecklist, ...(checklistOverride ?? {}) };

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
      machineCode: row.machineCode,
      machineName: row.machineName,
      machineModel: row.machineModel,
      machineSerial: row.machineSerial,
      machineManufacturer: row.machineManufacturer,
      machineObservations: row.machineObservations,
      serviceCode: row.serviceCode,
      serviceItemDescription: row.serviceItemDescription,
      hasHotel: row.hasHotel,
      hotelName: row.hotelName,
      hotelAddress: row.hotelAddress,
      hotelCheckIn: row.hotelCheckIn?.toISOString() ?? null,
      hotelCheckOut: row.hotelCheckOut?.toISOString() ?? null,
      hotelDailyRate: row.hotelDailyRate?.toString() ?? null,
      hotelNotes: row.hotelNotes,
      transportMode: row.transportMode,
      flightAirport: row.flightAirport,
      flightDepartureAt: row.flightDepartureAt?.toISOString() ?? null,
      flightReturnAt: row.flightReturnAt?.toISOString() ?? null,
      needsHotel: Boolean(row.hasHotel || row.hotelName || row.hotelAddress || row.hotelCheckIn || row.hotelCheckOut),
      needsTransport: Boolean(row.transportMode),
      clientChecklist: row.notes,
      schedulingChecklist,
      client: {
        id: row.client.id,
        name: row.client.name,
        cnpj: row.client.cnpj,
        ie: row.client.ie,
        city: row.client.city,
        state: row.client.state,
        district: row.client.district,
        zipCode: row.client.zipCode,
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
      })),
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        publicUrl: attachment.publicUrl,
        createdAt: attachment.createdAt.toISOString()
      }))
    };
  }

  private toFrontendStatus(status: AppointmentStatus): 'WAITING' | 'READY' | 'CRITICAL' {
    if (status === AppointmentStatus.READY) return 'READY';
    if (status === AppointmentStatus.CRITICAL) return 'CRITICAL';
    return 'WAITING';
  }

  private async getChecklistOverrides(appointmentIds: string[]) {
    const map = new Map<string, Partial<Record<ChecklistKey, boolean>>>();
    if (!appointmentIds.length) return map;

    const logs = await this.prisma.auditLog.findMany({
      where: {
        entity: 'appointment_checklist',
        action: 'UPDATE',
        entityId: { in: appointmentIds }
      },
      orderBy: { createdAt: 'desc' }
    });

    for (const log of logs) {
      if (!log.entityId || map.has(log.entityId)) continue;
      map.set(log.entityId, this.parseChecklist(log.metadata));
    }

    return map;
  }

  private async getLatestChecklist(appointmentId: string) {
    const log = await this.prisma.auditLog.findFirst({
      where: {
        entity: 'appointment_checklist',
        action: 'UPDATE',
        entityId: appointmentId
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.parseChecklist(log?.metadata);
  }

  private parseChecklist(input: unknown): Partial<Record<ChecklistKey, boolean>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const source = input as Record<string, unknown>;
    const result: Partial<Record<ChecklistKey, boolean>> = {};
    for (const key of CHECKLIST_KEYS) {
      if (source[key] !== undefined) result[key] = Boolean(source[key]);
    }
    return result;
  }
}

const CHECKLIST_KEYS = [
  'clientConfirmed',
  'contactConfirmed',
  'addressConfirmed',
  'serviceTypeConfirmed',
  'technicianSelected',
  'technicianAvailability',
  'dateTimeConfirmed',
  'hotelNeedChecked',
  'transportNeedChecked',
  'osChecked',
  'clientChecklistChecked'
] as const;

type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
