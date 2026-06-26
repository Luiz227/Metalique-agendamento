import { Injectable } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};

type AppointmentNotificationRow = Prisma.AppointmentGetPayload<{
  include: {
    client: true;
    technician: true;
  };
}>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { ok: true, module: 'notifications' };
  }

  async list() {
    const persisted = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { not: AppointmentStatus.COMPLETED }
      },
      include: { client: true, technician: true },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });

    const checklistById = await this.getChecklistOverrides(appointments.map((appointment) => appointment.id));
    const generated = appointments.flatMap((appointment) => this.buildAppointmentNotifications(appointment, checklistById.get(appointment.id)));

    return [
      ...generated,
      ...persisted.map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString()
      }))
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 80);
  }

  private buildAppointmentNotifications(
    appointment: AppointmentNotificationRow,
    checklistOverride?: Partial<Record<ChecklistKey, boolean>>
  ): NotificationItem[] {
    const checklist = this.buildSchedulingChecklist(appointment, checklistOverride);
    const missing = CHECKLIST_KEYS.filter((key) => !checklist[key]).map((key) => CHECKLIST_LABELS[key]);
    const createdAt = appointment.updatedAt.toISOString();
    const notifications: NotificationItem[] = [];

    if (missing.length > 0) {
      notifications.push({
        id: `pending-${appointment.id}`,
        title: `Pendencia no agendamento - ${appointment.client.name}`,
        message: `Falta confirmar: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}.`,
        readAt: null,
        createdAt
      });
      return notifications;
    }

    if (appointment.technician) {
      notifications.push({
        id: `released-${appointment.id}`,
        title: `Atendimento liberado para ${appointment.technician.name}`,
        message: `${appointment.client.name} esta com checklist completo e ja aparece no aplicativo do tecnico.`,
        readAt: null,
        createdAt
      });
    }

    const now = new Date();
    const start = new Date(appointment.startTime);
    const hoursToStart = (start.getTime() - now.getTime()) / 36e5;
    if (hoursToStart >= 0 && hoursToStart <= 48) {
      notifications.push({
        id: `upcoming-${appointment.id}`,
        title: `Atendimento se aproximando - ${appointment.client.name}`,
        message: `${appointment.technician?.name ?? 'Tecnico'} tem atendimento em ${appointment.city} no dia ${start.toLocaleDateString('pt-BR')} as ${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
        readAt: null,
        createdAt: start.toISOString()
      });
    }

    return notifications;
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

  private parseChecklist(input: unknown): Partial<Record<ChecklistKey, boolean>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const source = input as Record<string, unknown>;
    const result: Partial<Record<ChecklistKey, boolean>> = {};
    for (const key of CHECKLIST_KEYS) {
      if (source[key] !== undefined) result[key] = Boolean(source[key]);
    }
    return result;
  }

  private buildSchedulingChecklist(
    row: AppointmentNotificationRow,
    checklistOverride?: Partial<Record<ChecklistKey, boolean>>
  ): Record<ChecklistKey, boolean> {
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
    const hasFlightData = Boolean(row.flightAirport || row.flightDepartureAt || row.flightReturnAt);
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

    return { ...derivedChecklist, ...(checklistOverride ?? {}) };
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

const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  clientConfirmed: 'cliente',
  contactConfirmed: 'contato',
  addressConfirmed: 'endereco',
  serviceTypeConfirmed: 'tipo/descricao do servico',
  technicianSelected: 'tecnico',
  technicianAvailability: 'disponibilidade do tecnico',
  dateTimeConfirmed: 'data e horario',
  hotelNeedChecked: 'hospedagem',
  transportNeedChecked: 'transporte',
  osChecked: 'dados da OS',
  clientChecklistChecked: 'checklist do cliente'
};
