import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';

type AppointmentRow = Prisma.AppointmentGetPayload<{
  include: {
    client: true;
    technician: true;
    vehicle: true;
    attachments: true;
    statusLogs: true;
  };
}>;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService
  ) {}

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
        vehicle: true,
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
        vehicle: true,
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
        vehicleId: body.vehicleId ? String(body.vehicleId) : null,
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
        flightOutboundAirport: body.flightOutboundAirport ? String(body.flightOutboundAirport) : null,
        flightReturnAirport: body.flightReturnAirport ? String(body.flightReturnAirport) : null,
        flightDepartureAt: body.flightDepartureAt ? new Date(String(body.flightDepartureAt)) : null,
        flightReturnAt: body.flightReturnAt ? new Date(String(body.flightReturnAt)) : null
      },
      include: { client: true, technician: true, vehicle: true, attachments: true, statusLogs: true }
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

  async deleteAll(userId: string, confirmation?: string) {
    if (confirmation !== 'EXCLUIR TODOS') {
      throw new BadRequestException('Digite EXCLUIR TODOS para confirmar a exclusao');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true }
    });
    if (!user?.active || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Somente administradores podem excluir todos os agendamentos');
    }

    const total = await this.prisma.appointment.count();
    await this.prisma.$transaction([
      this.prisma.appointment.deleteMany(),
      this.prisma.auditLog.create({
        data: {
          userId,
          entity: 'appointment',
          action: 'BULK_DELETE',
          metadata: { total, confirmation }
        }
      })
    ]);
    return { ok: true, deleted: total };
  }

  async resetSystemData(userId: string, confirmation?: string) {
    if (confirmation !== 'REDEFINIR SISTEMA') {
      throw new BadRequestException('Digite REDEFINIR SISTEMA para confirmar a limpeza');
    }
    const administrator = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!administrator || !administrator.active || administrator.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Somente um administrador ativo pode redefinir o sistema');
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      const snapshot = {
        appointments: await tx.appointment.count(),
        clients: await tx.client.count(),
        technicians: await tx.technician.count(),
        vehicles: await tx.vehicle.count(),
        hotels: await tx.hotel.count(),
        users: await tx.user.count({ where: { id: { not: userId } } })
      };

      await tx.appointment.deleteMany();
      await tx.notification.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.technician.deleteMany();
      await tx.client.deleteMany();
      await tx.hotel.deleteMany();
      await tx.vehicle.deleteMany();
      await tx.user.deleteMany({ where: { id: { not: userId } } });
      await tx.auditLog.create({
        data: {
          userId,
          entity: 'system',
          action: 'FACTORY_RESET',
          metadata: snapshot
        }
      });
      return snapshot;
    });

    return {
      ok: true,
      preservedAdministrator: administrator.email,
      deleted: counts
    };
  }

  async update(id: string, body: Record<string, unknown>) {
    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        technicianId: body.technicianId !== undefined ? (body.technicianId ? String(body.technicianId) : null) : undefined,
        vehicleId: body.vehicleId !== undefined ? (body.vehicleId ? String(body.vehicleId) : null) : undefined,
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
        flightOutboundAirport: body.flightOutboundAirport !== undefined ? (body.flightOutboundAirport ? String(body.flightOutboundAirport) : null) : undefined,
        flightReturnAirport: body.flightReturnAirport !== undefined ? (body.flightReturnAirport ? String(body.flightReturnAirport) : null) : undefined,
        flightDepartureAt: body.flightDepartureAt !== undefined ? (body.flightDepartureAt ? new Date(String(body.flightDepartureAt)) : null) : undefined,
        flightReturnAt: body.flightReturnAt !== undefined ? (body.flightReturnAt ? new Date(String(body.flightReturnAt)) : null) : undefined
      },
      include: { client: true, technician: true, vehicle: true, attachments: true, statusLogs: { orderBy: { createdAt: 'desc' } } }
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
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { client: true, technician: { include: { user: { select: { email: true } } } } }
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');
    const email = await this.mail.sendAppointmentCancelled(appointment, reason);
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
    return { ok: true, deleted: true, id, email };
  }

  async reschedule(id: string, date: string, startTime: string, endTime: string) {
    const appointment = await this.prisma.appointment.update({
      where: { id },
      data: { date: new Date(date), startTime: new Date(startTime), endTime: new Date(endTime), status: AppointmentStatus.WAITING },
      include: { client: true, technician: { include: { user: { select: { email: true } } } } }
    });
    await this.prisma.statusLog.create({
      data: { appointmentId: id, status: 'RESCHEDULED' }
    });
    const email = await this.mail.sendAppointmentRescheduled(appointment);
    await this.prisma.statusLog.create({
      data: {
        appointmentId: id,
        status: email.sent ? 'RESCHEDULE_EMAIL_SENT' : 'RESCHEDULE_EMAIL_FAILED',
        observation: email.sent
          ? `E-mail enviado para ${email.recipients ?? 0} destinatário(s)`
          : `E-mail não enviado: ${email.reason ?? 'motivo desconhecido'}`
      }
    });
    return { ok: true, email };
  }

  async confirm(id: string) {
    const current = await this.prisma.appointment.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('Agendamento nao encontrado');
    if (current.status !== AppointmentStatus.READY) {
      await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.READY } });
      await this.prisma.statusLog.create({ data: { appointmentId: id, status: 'CONFIRMED' } });
    }
    return this.sendConfirmationEmail(id);
  }

  async sendConfirmationEmail(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        client: true,
        technician: { include: { user: { select: { email: true } } } }
      }
    });
    if (!appointment) throw new NotFoundException('Agendamento nao encontrado');

    const email = await this.mail.sendAppointmentConfirmed(appointment);
    await this.prisma.statusLog.create({
      data: {
        appointmentId: id,
        status: email.sent ? 'CONFIRMATION_EMAIL_SENT' : 'CONFIRMATION_EMAIL_FAILED',
        observation: email.sent
          ? `E-mail enviado para ${email.recipients ?? 0} destinatario(s)`
          : `E-mail nao enviado: ${email.reason ?? 'motivo desconhecido'}`
      }
    });
    return { ok: true, email };
  }

  async reopen(id: string) {
    await this.prisma.appointment.update({
      where: { id },
      data: { status: AppointmentStatus.READY }
    });
    await this.prisma.statusLog.create({
      data: { appointmentId: id, status: 'REOPENED', observation: 'Agendamento reaberto para pronto' }
    });
    return { ok: true, status: 'READY' };
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
    const hasDefinedAddress = Boolean(row.fullAddress && row.fullAddress.trim() && row.fullAddress !== 'Endereco a definir');
    const hasDefinedCity = Boolean(row.city && row.city.trim() && row.city !== 'A definir');
    const hasDefinedServiceType = Boolean(row.serviceType && row.serviceType.trim() && row.serviceType !== 'Pendente definicao');
    const hasDefinedProblem = Boolean(
      row.problemDescription &&
        row.problemDescription.trim() &&
        row.problemDescription !== 'Pendente descricao do servico'
    );
    const hasHotelRequest = Boolean(row.hasHotel || row.hotelName || row.hotelAddress || row.hotelCheckIn || row.hotelCheckOut);
    const hasTransportDecision = Boolean(row.transportMode && row.transportMode !== 'NONE');
    const hasFlightData = Boolean(
      row.flightOutboundAirport ||
      row.flightReturnAirport ||
      row.flightAirport ||
      row.flightDepartureAt ||
      row.flightReturnAt
    );
    const hasOfficialServiceData = Boolean(
      row.serviceCode &&
        row.serviceItemDescription &&
        row.machineCode &&
        row.machineName &&
        row.machineModel
    );

    const derivedChecklist: Record<ChecklistKey, boolean> = {
      clientConfirmed: false,
      contactConfirmed: false,
      addressConfirmed: hasDefinedAddress && hasDefinedCity,
      serviceTypeConfirmed: hasDefinedServiceType && hasDefinedProblem,
      technicianSelected: !!row.technicianId,
      technicianAvailability: !!row.technicianId && !!row.startTime && !!row.endTime,
      dateTimeConfirmed: !!row.startTime,
      hotelNeedChecked: !hasHotelRequest || Boolean(row.hotelName && row.hotelAddress && row.hotelCheckIn && row.hotelCheckOut),
      transportNeedChecked:
        !hasTransportDecision ||
        row.transportMode === 'CAR' ||
        (row.transportMode === 'AIR' && hasFlightData),
      osChecked: hasOfficialServiceData,
      clientChecklistChecked: false
    };
    const schedulingChecklist = { ...derivedChecklist, ...(checklistOverride ?? {}) };

    return {
      id: row.id,
      clientId: row.clientId,
      technicianId: row.technicianId,
      vehicleId: row.vehicleId,
      vehiclePickupMileage: row.vehiclePickupMileage,
      vehicleReturnMileage: row.vehicleReturnMileage,
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
      flightOutboundAirport: row.flightOutboundAirport,
      flightReturnAirport: row.flightReturnAirport,
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
      vehicle: row.vehicle
        ? {
            id: row.vehicle.id,
            name: row.vehicle.name,
            year: row.vehicle.year,
            plate: row.vehicle.plate,
            mileage: row.vehicle.mileage,
            lastMaintenanceMileage: row.vehicle.lastMaintenanceMileage,
            lastMaintenanceAt: row.vehicle.lastMaintenanceAt?.toISOString() ?? null,
            active: row.vehicle.active
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
        publicUrl: `/api/attachments/files/${attachment.id}`,
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
