import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { google } from 'googleapis';
import JSZip from 'jszip';
import { join } from 'path';
import { Readable } from 'stream';
import { PDFDocument, PDFPage, PDFFont, PageSizes, rgb, StandardFonts } from 'pdf-lib';

const ATTACHMENT_KIND = {
  GENERAL: 'GENERAL',
  SERVICE_ORDER_TEMPLATE: 'SERVICE_ORDER_TEMPLATE',
  TECHNICAL_REPORT: 'TECHNICAL_REPORT',
  TECHNICAL_MEDIA: 'TECHNICAL_MEDIA',
  TECHNICAL_DOCUMENT: 'TECHNICAL_DOCUMENT',
  CLIENT_SIGNATURE: 'CLIENT_SIGNATURE',
  TECHNICIAN_SIGNATURE: 'TECHNICIAN_SIGNATURE'
} as const;

const LOCAL_ATTACHMENT_PREFIX = 'local:';
const INLINE_ATTACHMENT_PREFIX = 'inline-db:';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const START_TRAINING_TEMPLATE_NAME = 'template-start-treinamento.docx';
const START_TRAINING_TEMPLATE_PATHS = [
  join(process.cwd(), 'apps', 'backend', 'templates', START_TRAINING_TEMPLATE_NAME),
  join(process.cwd(), 'templates', START_TRAINING_TEMPLATE_NAME)
];
const SIGE_START_TEMPLATE_NAME = 'sige-ordem-servico-externa.docx';
const SIGE_AVULSA_TEMPLATE_NAME = 'sige-ordem-servico-avulsa-externa.docx';
const SIGE_TEMPLATE_PATHS = {
  start: [
    join(process.cwd(), 'apps', 'backend', 'templates', SIGE_START_TEMPLATE_NAME),
    join(process.cwd(), 'templates', SIGE_START_TEMPLATE_NAME)
  ],
  avulsa: [
    join(process.cwd(), 'apps', 'backend', 'templates', SIGE_AVULSA_TEMPLATE_NAME),
    join(process.cwd(), 'templates', SIGE_AVULSA_TEMPLATE_NAME)
  ]
} as const;

@Injectable()
export class LegacyService {
  constructor(private readonly prisma: PrismaService) {}

  private driveClient: ReturnType<typeof google.drive> | null = null;

  async resourcesVehicles() {
    return this.prisma.vehicle.findMany({ orderBy: { name: 'asc' } });
  }

  async createVehicle(payload: { name?: string; year?: number | string | null; plate?: string; mileage?: number | string | null }) {
    const data = this.normalizeVehicleCreatePayload(payload);
    return this.prisma.vehicle.create({ data });
  }

  async updateVehicle(
    id: string,
    payload: { name?: string; year?: number | string | null; plate?: string; mileage?: number | string | null; active?: boolean }
  ) {
    const data = this.normalizeVehicleUpdatePayload(payload);
    if (typeof payload.active === 'boolean') data.active = payload.active;
    return this.prisma.vehicle.update({
      where: { id },
      data
    });
  }

  async toggleVehicle(id: string) {
    const current = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Veiculo nao encontrado');
    return this.prisma.vehicle.update({
      where: { id },
      data: { active: !current.active }
    });
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
    await this.rebuildSuggestionsFromAppointments();

    const where: Prisma.RouteSuggestionWhereInput = { status: 'OPEN' };
    if (query.from || query.to) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.from) dateFilter.gte = new Date(query.from);
      if (query.to) dateFilter.lte = new Date(query.to);
      where.OR = [
        { originAppointment: { date: dateFilter } },
        { nearbyAppointment: { date: dateFilter } }
      ];
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
      reason: this.buildSuggestionReason(row.originAppointment, row.nearbyAppointment),
      status: row.status,
      originAppointment: this.toSimpleAppointment(row.originAppointment),
      nearbyAppointment: this.toSimpleAppointment(row.nearbyAppointment)
    }));
  }

  private async rebuildSuggestionsFromAppointments() {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.WAITING, AppointmentStatus.READY] }
      },
      include: { client: true, technician: true, statusLogs: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });

    const keepPairs = new Set<string>();
    const pointsByAppointmentId = new Map<string, { lat: number; lng: number }>();

    for (let i = 0; i < appointments.length; i += 1) {
      for (let j = i + 1; j < appointments.length; j += 1) {
        const a = appointments[i];
        const b = appointments[j];

        const pointA = pointsByAppointmentId.get(a.id) ?? await this.resolvePoint(a);
        if (pointA) pointsByAppointmentId.set(a.id, pointA);
        const pointB = pointsByAppointmentId.get(b.id) ?? await this.resolvePoint(b);
        if (pointB) pointsByAppointmentId.set(b.id, pointB);
        if (!pointA || !pointB) continue;

        const distanceKm = this.haversineKm(pointA, pointB);
        if (!Number.isFinite(distanceKm) || distanceKm > 60) continue;

        const durationMinutes = Math.max(5, Math.round((distanceKm / 50) * 60));
        const score = Math.max(45, Math.min(100, Math.round(100 - distanceKm * 2)));
        const [originId, nearbyId] = [a.id, b.id].sort();
        const pairKey = `${originId}:${nearbyId}`;
        keepPairs.add(pairKey);

        const existing = await this.prisma.routeSuggestion.findFirst({
          where: {
            OR: [
              { originAppointmentId: originId, nearbyAppointmentId: nearbyId },
              { originAppointmentId: nearbyId, nearbyAppointmentId: originId }
            ]
          }
        });

        const payload: Prisma.RouteSuggestionUncheckedCreateInput = {
          originAppointmentId: originId,
          nearbyAppointmentId: nearbyId,
          distanceKm,
          durationMinutes,
          score
        };

        if (existing) {
          await this.prisma.routeSuggestion.update({
            where: { id: existing.id },
            data: {
              distanceKm,
              durationMinutes,
              score
            }
          });
        } else {
          await this.prisma.routeSuggestion.create({ data: payload });
        }
      }
    }

    const allOpen = await this.prisma.routeSuggestion.findMany({
      where: { status: 'OPEN' },
      select: { id: true, originAppointmentId: true, nearbyAppointmentId: true }
    });

    const staleOpenIds = allOpen
      .filter((item) => !keepPairs.has([item.originAppointmentId, item.nearbyAppointmentId].sort().join(':')))
      .map((item) => item.id);

    if (staleOpenIds.length) {
      await this.prisma.routeSuggestion.deleteMany({ where: { id: { in: staleOpenIds } } });
    }
  }

  async updateSuggestion(id: string, body: { status?: string }) {
    await this.prisma.routeSuggestion.update({
      where: { id },
      data: { status: String(body.status ?? 'OPEN').toUpperCase() }
    });
    return { ok: true };
  }

  private buildSuggestionReason(
    origin: { date: Date; technician?: { id: string; name: string } | null },
    nearby: { date: Date; technician?: { id: string; name: string } | null }
  ) {
    const sameDay = this.isSameDay(origin.date, nearby.date);
    const originTech = origin.technician?.id ?? origin.technician?.name ?? '';
    const nearbyTech = nearby.technician?.id ?? nearby.technician?.name ?? '';
    const sameTechnician = Boolean(originTech && nearbyTech && originTech === nearbyTech);

    if (sameDay && !sameTechnician) {
      return 'Atendimentos proximos no mesmo dia: avaliar dividir o mesmo carro ou concentrar a rota com um tecnico.';
    }

    if (!sameDay && !sameTechnician) {
      return 'Atendimentos proximos em dias diferentes: avaliar reagendar ou enviar um tecnico para atender os dois clientes.';
    }

    if (!sameDay && sameTechnician) {
      return 'Mesmo tecnico com clientes proximos em dias diferentes: avaliar juntar as visitas na mesma viagem.';
    }

    return 'Atendimentos proximos: avaliar a melhor sequencia para reduzir deslocamento.';
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

  async technicianAppointments(identity: { userId: string | null; email: string | null; name: string | null } | null) {
    if (!identity) return [];

    const linkedUser = identity.userId
      ? await this.prisma.user.findUnique({ where: { id: identity.userId } })
      : identity.email
        ? await this.prisma.user.findUnique({
            where: { email: identity.email }
          })
        : null;

    const candidateName = linkedUser?.name?.trim() || identity.name?.trim() || '';
    const firstName = candidateName.split(/\s+/).filter(Boolean)[0] ?? '';
    const technicianSearch: Prisma.TechnicianWhereInput[] = [];
    if (linkedUser) technicianSearch.push({ userId: linkedUser.id });
    if (candidateName) technicianSearch.push({ name: { equals: candidateName, mode: 'insensitive' } });
    if (firstName && firstName.length >= 3) technicianSearch.push({ name: { startsWith: firstName, mode: 'insensitive' } });

    let technicians = technicianSearch.length
      ? await this.prisma.technician.findMany({
          where: {
            OR: technicianSearch
          },
          orderBy: { createdAt: 'asc' }
        })
      : [];

    let primaryTechnician = technicians.find((item) => linkedUser && item.userId === linkedUser.id) ?? technicians[0] ?? null;

    if (!primaryTechnician && linkedUser?.role === UserRole.TECHNICIAN) {
      primaryTechnician = await this.prisma.technician.create({
        data: {
          userId: linkedUser.id,
          name: linkedUser.name,
          baseCity: 'Nao informado',
          baseAddress: 'Nao informado',
          specialties: [],
          active: linkedUser.active,
          color: '#2563eb'
        }
      });
      technicians = [primaryTechnician];
    }

    if (linkedUser && primaryTechnician && !primaryTechnician.userId) {
      primaryTechnician = await this.prisma.technician.update({
        where: { id: primaryTechnician.id },
        data: { userId: linkedUser.id, active: linkedUser.active, name: linkedUser.name }
      });
      technicians = technicians.map((item) => (item.id === primaryTechnician!.id ? primaryTechnician! : item));
    }

    if (!primaryTechnician) return [];

    const technicianIds = Array.from(new Set(technicians.map((item) => item.id)));
    const rows = await this.prisma.appointment.findMany({
      where: {
        technicianId: { in: technicianIds },
        status: { in: [AppointmentStatus.READY, AppointmentStatus.CRITICAL, AppointmentStatus.WAITING] }
      },
      include: { client: true, technician: true, attachments: true, statusLogs: { orderBy: { createdAt: 'desc' } } },
      orderBy: { date: 'asc' }
    });
    return rows.map((row) => this.toSimpleAppointment(row));
  }

  async technicianSetStatus(id: string, status: string, observation?: string) {
    await this.prisma.statusLog.create({ data: { appointmentId: id, status, observation: observation ?? null } });
    return { ok: true };
  }

  async technicianReport(
    id: string,
    report?: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const summary = report?.summary?.trim();

    await this.prisma.statusLog.create({
      data: { appointmentId: id, status: 'COMPLETED_SUCCESS', observation: summary ?? 'Atendimento finalizado pelo técnico' }
    });
    await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CRITICAL } });

    if (summary || report?.clientSignatureDataUrl || report?.technicianSignatureDataUrl) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id },
        include: { client: true, technician: true, attachments: { orderBy: { createdAt: 'desc' } } }
      });
      if (!appointment) throw new NotFoundException('Agendamento não encontrado');

      const officialTemplate = this.getBundledOfficialServiceOrderTemplate(appointment.serviceType);
      let reportPdf: Buffer;

      if (officialTemplate) {
        const reportDocx = await this.buildFilledSigeServiceOrderDocx(
          appointment,
          officialTemplate.buffer,
          officialTemplate.kind,
          {
            summary,
            finishedAt: report?.finishedAt,
            clientSignatureDataUrl: report?.clientSignatureDataUrl,
            technicianSignatureDataUrl: report?.technicianSignatureDataUrl
          }
        );

        reportPdf = await this.convertDocxBufferToPdf(
          reportDocx,
          'ordem-servico-preenchida-' + (appointment.osNumber || appointment.id) + '-' + new Date().toISOString().slice(0, 10)
        );

        reportPdf = await this.applySignaturesToPdf(reportPdf, officialTemplate.originalName, {
          finishedAt: report?.finishedAt,
          clientSignatureDataUrl: report?.clientSignatureDataUrl,
          technicianSignatureDataUrl: report?.technicianSignatureDataUrl
        });
      } else {
        reportPdf = await this.buildGeneratedServiceOrderPdf(appointment, {
          summary,
          finishedAt: report?.finishedAt,
          clientSignatureDataUrl: report?.clientSignatureDataUrl,
          technicianSignatureDataUrl: report?.technicianSignatureDataUrl
        });
      }

      await this.attachFile(
        id,
        {
          originalname: 'ordem-servico-preenchida-' + (appointment.osNumber || appointment.id) + '-' + new Date().toISOString().slice(0, 10) + '.pdf',
          mimetype: 'application/pdf',
          size: reportPdf.length,
          buffer: reportPdf
        },
        ATTACHMENT_KIND.TECHNICAL_REPORT
      );
    }

    return { ok: true };
  }

  private buildServiceOrderHtml(
    appointment: {
      id: string;
      osNumber: string | null;
      city: string;
      fullAddress: string;
      serviceType: string;
      problemDescription: string | null;
      date: Date;
      startTime: Date;
      endTime: Date;
      notes: string | null;
      machineName: string | null;
      machineModel: string | null;
      machineSerial: string | null;
      hasHotel: boolean;
      hotelName: string | null;
      hotelAddress: string | null;
      hotelCheckIn: Date | null;
      hotelCheckOut: Date | null;
      hotelDailyRate: Prisma.Decimal | null;
      hotelNotes: string | null;
      transportMode: string | null;
      flightAirport: string | null;
      flightDepartureAt: Date | null;
      flightReturnAt: Date | null;
      client: { name: string; phone: string | null; email: string | null; cnpj: string | null };
      technician: { name: string; baseCity: string; baseAddress: string } | null;
    },
    report: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const company = this.resolveServiceOrderCompany(appointment.serviceType);
    const isStart = this.isStartOrTraining(appointment.serviceType);
    const osNumber = appointment.osNumber || appointment.id;
    const serviceCode = isStart ? '10021' : '10012';
    const serviceDescription = isStart
      ? 'INSTALACAO (START / OU TREINAMENTO) TODAS AS MAQUINAS'
      : 'MANUTENCAO CORRETIVA LASER F OU DOBRADEIRA';
    const technicianNotes = report.summary || '';
    const clientSignatureImage = report.clientSignatureDataUrl
      ? `<img class="signature-image" src="${this.escapeHtml(report.clientSignatureDataUrl)}" alt="Assinatura do cliente" />`
      : '';
    const technicianSignatureImage = report.technicianSignatureDataUrl
      ? `<img class="signature-image" src="${this.escapeHtml(report.technicianSignatureDataUrl)}" alt="Assinatura do tecnico" />`
      : '';

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Ordem de Serviço ${this.escapeHtml(osNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; }
    .page { width: 210mm; min-height: 297mm; margin: 16px auto; padding: 16mm 18mm; background: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.12); }
    .top { display: grid; grid-template-columns: 1fr 150px; gap: 16px; align-items: start; }
    .brand { font-size: 28px; font-weight: 800; letter-spacing: .5px; text-align: right; }
    .brand-box { display: inline-flex; min-width: 92px; min-height: 48px; align-items: center; justify-content: center; background: #222; color: #fff; border-radius: 2px; padding: 8px 12px; }
    .company { font-size: 11px; line-height: 1.45; text-align: center; }
    .meta { text-align: right; font-size: 11px; line-height: 1.6; margin-top: 10px; }
    h1 { margin: 22px 0 12px; text-align: center; font-size: 15px; letter-spacing: .4px; }
    .section-title { margin: 14px 0 5px; text-align: center; font-size: 13px; font-weight: 700; }
    .box { border: 1px solid #6b7280; padding: 8px; font-size: 11px; line-height: 1.5; min-height: 72px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
    th, td { border: 1px solid #6b7280; padding: 7px; vertical-align: top; }
    th { background: #f9fafb; text-align: center; font-weight: 700; }
    .center { text-align: center; }
    .notes-cell { height: 155px; white-space: pre-wrap; font-size: 13px; line-height: 1.55; }
    .signature-table { margin-top: 22px; table-layout: fixed; }
    .signature-table td { height: 118px; text-align: center; vertical-align: bottom; }
    .signature-line { border-top: 1px solid #111827; padding-top: 7px; min-height: 24px; }
    .signature-image { display: block; width: 100%; max-width: 280px; height: 96px; object-fit: contain; margin: 0 auto 8px; background: #fff; }
    .footer { margin-top: 22px; font-size: 10px; text-align: center; color: #374151; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: auto; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="top">
      <div class="company">
        <strong>${this.escapeHtml(company.name)}</strong><br />
        <strong>CNPJ:</strong> ${this.escapeHtml(company.cnpj)} - ${this.escapeHtml(company.branch)}<br />
        ${this.escapeHtml(company.address)}<br />
        ${this.escapeHtml(company.cityStateZip)}<br />
        <strong>Fones:</strong> ${this.escapeHtml(company.phones)}
      </div>
      <div>
        <div class="brand"><span class="brand-box">${this.escapeHtml(company.logoText)}</span></div>
        <div class="meta">
          <strong>Pedido/Orc Nº:</strong> ${this.escapeHtml(osNumber)}<br />
          <strong>Emissão:</strong> ${this.formatDateOnly(new Date())}
        </div>
      </div>
    </div>

    <h1>DADOS DO CHAMADO/ ORDEM DE SERVIÇO</h1>
    <table>
      <tr>
        <td><strong>Cliente:</strong> ${this.escapeHtml(appointment.client.name)}</td>
        <td><strong>Telefone:</strong> ${this.escapeHtml(appointment.client.phone || 'Nao informado')}</td>
      </tr>
      <tr>
        <td><strong>CPF/CNPJ:</strong> ${this.escapeHtml(appointment.client.cnpj || 'Nao informado')}</td>
        <td><strong>E-mail:</strong> ${this.escapeHtml(appointment.client.email || 'Nao informado')}</td>
      </tr>
      <tr>
        <td><strong>Endereço:</strong> ${this.escapeHtml(appointment.fullAddress || 'Nao informado')}</td>
        <td><strong>CEP:</strong> Nao informado</td>
      </tr>
      <tr>
        <td><strong>Cidade:</strong> ${this.escapeHtml(appointment.city || 'Nao informado')}</td>
        <td><strong>Data Visita:</strong> ${this.formatDateOnly(appointment.date)}</td>
      </tr>
      <tr>
        <td colspan="2"><strong>OS Técnico:</strong> ${this.escapeHtml(appointment.technician?.name || 'Nao informado')}</td>
      </tr>
    </table>

    <div class="section-title">PROBLEMA</div>
    <div class="box">${this.escapeHtml(appointment.problemDescription || appointment.serviceType || 'Nao informado')}</div>

    <div class="section-title">DADOS DO(S) EQUIPAMENTO(S)</div>
    <table>
      <tr>
        <th style="width: 18%;">Código</th>
        <th>Nome</th>
        <th>Modelo</th>
        <th>Observações</th>
        <th>Fabricante</th>
      </tr>
      <tr>
        <td class="center">${this.escapeHtml(appointment.machineSerial || osNumber)}</td>
        <td class="center">${this.escapeHtml(appointment.machineName || appointment.serviceType || 'Nao informado')}</td>
        <td class="center">${this.escapeHtml(appointment.machineModel || 'Nao informado')}</td>
        <td>${this.escapeHtml(appointment.notes || '')}</td>
        <td class="center">${this.escapeHtml(company.logoText)}</td>
      </tr>
    </table>

    <div class="section-title">PRODUTOS / SERVIÇOS:</div>
    <table>
      <tr>
        <th style="width: 24%;">Código</th>
        <th>Descrição do(s) serviço(s):</th>
      </tr>
      <tr>
        <td class="center">${serviceCode}</td>
        <td>${this.escapeHtml(serviceDescription)}</td>
      </tr>
    </table>

    <table style="margin-top: 14px;">
      <tr>
        <th>CONSIDERAÇÕES DO TÉCNICO</th>
      </tr>
      <tr>
        <td class="notes-cell">${this.escapeHtml(technicianNotes || 'Nao informado')}</td>
      </tr>
    </table>

    <div class="footer">
      Declaro que os serviços descritos neste relatório foram prestados e dados como aceitos por mim nesta data.
    </div>
    <table class="signature-table">
      <tr>
        <td>${technicianSignatureImage}<div class="signature-line">Assinatura do TÃ©cnico<br />${this.escapeHtml(appointment.technician?.name || '')}</div></td>
        <td>${clientSignatureImage}<div class="signature-line">Assinatura do Cliente</div></td>
      </tr>
    </table>
  </main>
</body>
</html>`;
  }

  private getBundledStartTrainingTemplate() {
    const templatePath = START_TRAINING_TEMPLATE_PATHS.find((candidate) => existsSync(candidate));
    if (!templatePath) return null;
    return {
      buffer: readFileSync(templatePath),
      originalName: START_TRAINING_TEMPLATE_NAME,
      mimeType: DOCX_MIME_TYPE
    };
  }

  private getBundledOfficialServiceOrderTemplate(serviceType: string | null) {
    const kind = this.isStartOrTraining(serviceType) ? 'start' : 'avulsa';
    const candidates = kind === 'start' ? SIGE_TEMPLATE_PATHS.start : SIGE_TEMPLATE_PATHS.avulsa;
    const templatePath = candidates.find((candidate) => existsSync(candidate));
    if (!templatePath) return null;
    return {
      kind,
      buffer: readFileSync(templatePath),
      originalName: kind === 'start' ? SIGE_START_TEMPLATE_NAME : SIGE_AVULSA_TEMPLATE_NAME,
      mimeType: DOCX_MIME_TYPE
    } as const;
  }

  private async buildFilledServiceOrderDocx(
    appointment: {
      id: string;
      osNumber: string | null;
      city: string;
      fullAddress: string;
      serviceType: string;
      problemDescription: string | null;
      date: Date;
      notes: string | null;
      machineCode: string | null;
      machineName: string | null;
      machineModel: string | null;
      machineSerial: string | null;
      machineManufacturer: string | null;
      machineObservations: string | null;
      serviceCode: string | null;
      serviceItemDescription: string | null;
      client: {
        name: string;
        phone: string | null;
        email: string | null;
        cnpj: string | null;
        ie: string | null;
        state: string | null;
        district: string | null;
        zipCode: string | null;
      };
      technician: { name: string } | null;
    },
    templateBytes: Buffer,
    report: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const zip = await JSZip.loadAsync(templateBytes);
    const acceptanceDate = report.finishedAt ? new Date(report.finishedAt) : new Date();
    const company = this.resolveServiceOrderCompany(appointment.serviceType);
    const osNumber = appointment.osNumber || appointment.id;
    const addressDetails = this.extractLocationDetailsFromClient(appointment.client, appointment.fullAddress, appointment.city);
    const serviceCode = appointment.serviceCode || (this.isStartOrTraining(appointment.serviceType) ? '10021' : '10012');
    const serviceDescription = appointment.serviceItemDescription || (this.isStartOrTraining(appointment.serviceType)
      ? 'INSTALACAO (START / OU TREINAMENTO) TODAS AS MAQUINAS'
      : 'MANUTENCAO CORRETIVA LASER F OU DOBRADEIRA');
    const placeholders: Record<string, string> = {
      OS_NUMERO: osNumber,
      DATA_EMISSAO: this.formatDateOnly(new Date()),
      CLIENTE: appointment.client.name || 'Nao informado',
      TELEFONE: appointment.client.phone || 'Nao informado',
      CPF_CNPJ: appointment.client.cnpj || 'Nao informado',
      IE: appointment.client.ie || 'Nao informado',
      BAIRRO: addressDetails.bairro,
      ENDERECO: appointment.fullAddress || 'Nao informado',
      EMAIL: appointment.client.email || 'Nao informado',
      CIDADE: addressDetails.cidade,
      CEP: addressDetails.cep,
      TECNICO: appointment.technician?.name || 'Nao informado',
      DATA_VISITA: this.formatDateOnly(appointment.date),
      CODIGO_EQUIPAMENTO: appointment.machineCode || appointment.machineSerial || osNumber,
      NOME_EQUIPAMENTO: appointment.machineName || appointment.serviceType || 'Nao informado',
      MODELO_EQUIPAMENTO: appointment.machineModel || 'Nao informado',
      OBSERVACOES_EQUIPAMENTO: appointment.machineObservations || appointment.notes || '',
      FABRICANTE_EQUIPAMENTO: appointment.machineManufacturer || (this.isStartOrTraining(appointment.serviceType)
        ? 'METALIQUE LASER E PLASMA CNC'
        : company.logoText),
      CODIGO_SERVICO: serviceCode,
      DESCRICAO_SERVICO: serviceDescription,
      CONSIDERACOES_TECNICO: report.summary?.trim() || 'Nao informado',
      CosideracoesDoTecnico: report.summary?.trim() || 'Nao informado',
      ConsideracoesDoTecnico: report.summary?.trim() || 'Nao informado',
      DATA_ACEITE_DIA: String(acceptanceDate.getDate()).padStart(2, '0'),
      DATA_ACEITE_MES: String(acceptanceDate.getMonth() + 1).padStart(2, '0'),
      DATA_ACEITE_ANO: String(acceptanceDate.getFullYear())
    };

    for (const name of Object.keys(zip.files)) {
      if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
      const file = zip.file(name);
      if (!file) continue;
      const content = await file.async('string');
      const updated = this.replaceDocxPlaceholders(content, placeholders);
      zip.file(name, updated);
    }

    return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
  }

  private async buildFilledSigeServiceOrderDocx(
    appointment: {
      id: string;
      osNumber: string | null;
      city: string;
      fullAddress: string;
      serviceType: string;
      problemDescription: string | null;
      date: Date;
      notes: string | null;
      machineCode: string | null;
      machineName: string | null;
      machineModel: string | null;
      machineSerial: string | null;
      machineManufacturer: string | null;
      machineObservations: string | null;
      serviceCode: string | null;
      serviceItemDescription: string | null;
      client: {
        name: string;
        phone: string | null;
        email: string | null;
        cnpj: string | null;
        ie: string | null;
        state: string | null;
        district: string | null;
        zipCode: string | null;
      };
      technician: { name: string } | null;
    },
    templateBytes: Buffer,
    kind: 'start' | 'avulsa',
    report: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const zip = await JSZip.loadAsync(templateBytes);
    const emissionDate = new Date();
    const visitDate = appointment.date;
    const company = this.resolveServiceOrderCompany(appointment.serviceType);
    const osNumber = appointment.osNumber || appointment.id;
    const address = this.extractLocationDetailsFromClient(appointment.client, appointment.fullAddress, appointment.city);
    const equipmentCode = appointment.machineCode || appointment.machineSerial || osNumber;
    const equipmentName = appointment.machineName || appointment.serviceType || 'Nao informado';
    const equipmentModel = appointment.machineModel || 'Nao informado';
    const equipmentObservations = appointment.machineObservations || appointment.notes || '';
    const technicianName = appointment.technician?.name || 'Nao informado';
    const serviceCode = appointment.serviceCode || (kind === 'start' ? '10021' : '10012');
    const serviceDescription =
      appointment.serviceItemDescription || (kind === 'start'
        ? 'INSTALACAO (START / OU TREINAMENTO) TODAS AS MAQUINAS'
        : 'MANUTENCAO CORRETIVA LASER F OU DOBRADEIRA');
    const problemText = appointment.problemDescription?.trim() || appointment.serviceType || 'Nao informado';
    const placeholders: Record<string, string> = {
      Bairro: address.bairro,
      CEP: address.cep,
      'CPF/CNPJ': appointment.client.cnpj || 'Nao informado',
      Cidade: address.cidade,
      Cliente: appointment.client.name || 'Nao informado',
      Email: appointment.client.email || 'Nao informado',
      EnderecoCliente: appointment.fullAddress || 'Nao informado',
      Estado: address.estado,
      IE: appointment.client.ie || 'Nao informado',
      OsDataVisita: this.formatDateOnly(visitDate),
      OsEquipamentoCodigo: equipmentCode,
      OsEquipamentoFabricante: appointment.machineManufacturer || (kind === 'start' ? 'METALIQUE LASER E PLASMA CNC' : company.logoText),
      OsEquipamentoModelo: equipmentModel,
      OsEquipamentoNome: equipmentName,
      OsEquipamentoObservacoes: equipmentObservations,
      OsProblema: problemText,
      OsTecnico: technicianName,
      Telefone: appointment.client.phone || 'Nao informado',
      CodigoProduto: serviceCode,
      CodigoServico: serviceCode,
      DataEmissao: this.formatDateOnly(emissionDate),
      DescricaoProduto: serviceDescription,
      DescricaoServico: serviceDescription,
      NomeDoVendedor: 'Agenda Metalique',
      Pedido: osNumber,
      OSCodigo: osNumber,
      OsDataAbertura: this.formatDateOnly(emissionDate),
      ValidadeDoOrcamento: this.formatDateOnly(emissionDate),
      VendedorEmail: 'agenda@metalique.com.br',
      CONSIDERACOES_TECNICO: report.summary?.trim() || 'Nao informado',
      CosideracoesDoTecnico: report.summary?.trim() || 'Nao informado',
      ConsideracoesDoTecnico: report.summary?.trim() || 'Nao informado'
    };

    if (kind === 'start') {
      Object.assign(placeholders, {
        CodigoServico: serviceCode,
        DescricaoServico: serviceDescription,
        OSCodigo: osNumber,
        OsDataAbertura: this.formatDateOnly(emissionDate)
      });
    } else {
      Object.assign(placeholders, {
        CodigoProduto: serviceCode,
        DescricaoProduto: serviceDescription,
        Pedido: osNumber,
        DataEmissao: this.formatDateOnly(emissionDate),
        ValidadeDoOrcamento: this.formatDateOnly(emissionDate)
      });
    }

    for (const name of Object.keys(zip.files)) {
      if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;
      const file = zip.file(name);
      if (!file) continue;
      const content = await file.async('string');
      const updated = this.replaceDocxPlaceholders(content, placeholders, {
        notesText: report.summary?.trim() || 'Nao informado',
        acceptanceDate: report.finishedAt ? new Date(report.finishedAt) : new Date()
      });
      zip.file(
        name,
        updated
      );
    }

    return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
  }

  private async buildFilledServiceOrderPdf(
    appointment: {
      id: string;
      osNumber: string | null;
      date: Date;
      technician: { name: string } | null;
    },
    templateAttachment: { driveFileId: string; driveFolderPath: string; originalName: string; mimeType: string },
    report: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const templateBytes = await this.downloadStoredAttachment(templateAttachment);
    const pdf = await PDFDocument.load(templateBytes);
    const page = pdf.getPages()[pdf.getPageCount() - 1];
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const layout = this.getServiceOrderPdfLayout(width, height, templateAttachment.originalName);

    const notesText = report.summary?.trim() || 'Nao informado';
    this.drawWrappedTextInBox(page, notesText, {
      ...layout.notesBox,
      font,
      color: rgb(0.08, 0.08, 0.08),
      minFontSize: 8.5,
      maxFontSize: 11
    });

    const acceptanceDate = report.finishedAt ? new Date(report.finishedAt) : new Date();
    const acceptanceDateText = this.formatDateOnly(acceptanceDate);
    page.drawText(acceptanceDateText, {
      x: layout.acceptanceDate.x,
      y: layout.acceptanceDate.y,
      font: boldFont,
      size: layout.acceptanceDate.fontSize,
      color: rgb(0.08, 0.08, 0.08)
    });

    await this.drawSignatureOnPdf(pdf, page, report.technicianSignatureDataUrl, layout.technicianSignatureBox);
    await this.drawSignatureOnPdf(pdf, page, report.clientSignatureDataUrl, layout.clientSignatureBox);

    return Buffer.from(await pdf.save());
  }

  private async applySignaturesToPdf(
    pdfBytes: Buffer,
    originalName: string,
    report: {
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const pdf = await PDFDocument.load(pdfBytes);
    const page = pdf.getPages()[pdf.getPageCount() - 1];
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const layout = this.getServiceOrderPdfLayout(width, height, originalName);

    const acceptanceDate = report.finishedAt ? new Date(report.finishedAt) : new Date();
    const acceptanceDateText = this.formatDateOnly(acceptanceDate);
    page.drawText(acceptanceDateText, {
      x: layout.acceptanceDate.x,
      y: layout.acceptanceDate.y,
      font: boldFont,
      size: layout.acceptanceDate.fontSize,
      color: rgb(0.08, 0.08, 0.08)
    });

    await this.drawSignatureOnPdf(pdf, page, report.technicianSignatureDataUrl, layout.technicianSignatureBox);
    await this.drawSignatureOnPdf(pdf, page, report.clientSignatureDataUrl, layout.clientSignatureBox);

    return Buffer.from(await pdf.save());
  }

  private async buildGeneratedServiceOrderPdf(
    appointment: {
      id: string;
      osNumber: string | null;
      city: string;
      fullAddress: string;
      serviceType: string;
      problemDescription: string | null;
      date: Date;
      notes: string | null;
      machineCode: string | null;
      machineName: string | null;
      machineModel: string | null;
      machineSerial: string | null;
      machineManufacturer: string | null;
      machineObservations: string | null;
      serviceCode: string | null;
      serviceItemDescription: string | null;
      client: {
        name: string;
        phone: string | null;
        email: string | null;
        cnpj: string | null;
        ie: string | null;
        state: string | null;
        district: string | null;
        zipCode: string | null;
      };
      technician: { name: string } | null;
    },
    report: {
      summary?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage(PageSizes.A4);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();
    const margin = 28;
    const contentWidth = width - margin * 2;
    const black = rgb(0.08, 0.08, 0.08);
    const gray = rgb(0.35, 0.35, 0.35);
    const company = this.resolveServiceOrderCompany(appointment.serviceType);
    const address = this.extractLocationDetailsFromClient(appointment.client, appointment.fullAddress, appointment.city);
    const isStart = this.isStartOrTraining(appointment.serviceType);
    const osNumber = appointment.osNumber || appointment.id;
    const emissionDate = new Date();
    const visitDate = appointment.date;
    const acceptanceDate = report.finishedAt ? new Date(report.finishedAt) : new Date();
    const serviceCode = appointment.serviceCode || (isStart ? '10021' : '10012');
    const serviceDescription = appointment.serviceItemDescription || (isStart
      ? 'INSTALACAO (START / OU TREINAMENTO) TODAS AS MAQUINAS'
      : 'MANUTENCAO CORRETIVA LASER F OU DOBRADEIRA');
    const problemText = appointment.problemDescription?.trim() || appointment.serviceType || 'Nao informado';
    const equipmentCode = appointment.machineCode || appointment.machineSerial || osNumber;
    const equipmentName = appointment.machineName || appointment.serviceType || 'Nao informado';
    const equipmentModel = appointment.machineModel || 'Nao informado';
    const equipmentObservations = appointment.machineObservations || appointment.notes || '';
    const equipmentManufacturer = appointment.machineManufacturer || (isStart ? 'METALIQUE LASER E PLASMA CNC' : company.logoText);
    const notesText = report.summary?.trim() || 'Nao informado';
    const technicianName = appointment.technician?.name || 'Nao informado';

    let cursorY = height - 38;

    page.drawText(company.name, {
      x: margin + 112,
      y: cursorY,
      font: boldFont,
      size: 10.5,
      color: black
    });
    page.drawText(`CNPJ: ${company.cnpj} - ${company.branch}`, {
      x: margin + 112,
      y: cursorY - 28,
      font: boldFont,
      size: 9,
      color: black
    });
    page.drawText(company.address, {
      x: margin + 112,
      y: cursorY - 56,
      font,
      size: 8.5,
      color: gray
    });
    page.drawText(company.cityStateZip, {
      x: margin + 112,
      y: cursorY - 84,
      font,
      size: 8.5,
      color: gray
    });
    page.drawText(`Fones: ${company.phones}`, {
      x: margin + 112,
      y: cursorY - 112,
      font: boldFont,
      size: 8.5,
      color: black
    });

    page.drawText(company.logoText, {
      x: width - margin - 150,
      y: cursorY + 4,
      font: boldFont,
      size: 22,
      color: rgb(0.75, 0.15, 0.2)
    });
    page.drawText(`Pedido/Orc. N° ${osNumber}`, {
      x: width - margin - 170,
      y: cursorY - 2,
      font: boldFont,
      size: 9,
      color: black
    });
    page.drawText(`Emissao ${this.formatDateOnly(emissionDate)}`, {
      x: width - margin - 170,
      y: cursorY - 30,
      font: boldFont,
      size: 9,
      color: black
    });

    cursorY -= 148;

    page.drawText('DADOS DO CHAMADO/ ORDEM DE SERVICO', {
      x: margin + 160,
      y: cursorY,
      font: boldFont,
      size: 10.5,
      color: black
    });

    cursorY -= 26;
    const leftX = margin + 6;
    const rightX = margin + contentWidth / 2 + 12;
    const infoSize = 8.8;
    const lineGap = 18;
    const leftInfo = [
      `Cliente: ${appointment.client.name || 'Nao informado'}`,
      `CPF/CNPJ: ${appointment.client.cnpj || 'Nao informado'} IE: ${appointment.client.ie || 'Nao informado'}`,
      `Endereco: ${appointment.fullAddress || 'Nao informado'}`,
      `Cidade: ${address.cidade} - ${address.estado}`,
      `OS Tecnico: ${technicianName}`
    ];
    const rightInfo = [
      `Telefone: ${appointment.client.phone || 'Nao informado'}`,
      `Bairro: ${address.bairro}`,
      `E-mail: ${appointment.client.email || 'Nao informado'}`,
      `CEP: ${address.cep}`,
      `Data Visita: ${this.formatDateOnly(visitDate)}`
    ];
    leftInfo.forEach((line, index) => {
      page.drawText(line, { x: leftX, y: cursorY - index * lineGap, font: boldFont, size: infoSize, color: black });
    });
    rightInfo.forEach((line, index) => {
      page.drawText(line, { x: rightX, y: cursorY - index * lineGap, font: boldFont, size: infoSize, color: black });
    });

    cursorY -= lineGap * 5 + 8;

    cursorY = this.drawLabeledFullWidthBox(page, {
      x: margin,
      y: cursorY,
      width: contentWidth,
      label: 'PROBLEMA',
      text: problemText,
      font,
      boldFont
    });

    cursorY -= 18;

    cursorY = this.drawEquipmentTable(page, {
      x: margin,
      y: cursorY,
      width: contentWidth,
      font,
      boldFont,
      values: {
        code: equipmentCode,
        name: equipmentName,
        model: equipmentModel,
        observations: equipmentObservations,
        manufacturer: equipmentManufacturer
      }
    });

    cursorY -= 18;

    cursorY = this.drawServiceTable(page, {
      x: margin + 18,
      y: cursorY,
      width: contentWidth - 36,
      font,
      boldFont,
      code: serviceCode,
      description: serviceDescription
    });

    cursorY -= 18;

    page.drawText('CONSIDERACOES DO TECNICO', {
      x: margin + 210,
      y: cursorY,
      font: boldFont,
      size: 10,
      color: black
    });
    cursorY -= 12;
    page.drawRectangle({
      x: margin,
      y: cursorY - 118,
      width: contentWidth,
      height: 118,
      borderColor: black,
      borderWidth: 1
    });
    this.drawWrappedTextInBox(page, notesText, {
      x: margin,
      y: cursorY - 118,
      width: contentWidth,
      height: 118,
      paddingX: 8,
      paddingTop: 10,
      maxLines: 6,
      lineHeight: 15,
      font,
      color: black,
      minFontSize: 8,
      maxFontSize: 10.5
    });

    cursorY -= 144;

    page.drawRectangle({
      x: margin + 20,
      y: cursorY - 40,
      width: contentWidth - 40,
      height: 40,
      borderColor: black,
      borderWidth: 1
    });
    const declaration = 'Declaro que os servicos descritos neste relatorio foram prestados e dados como aceitos por mim nesta data';
    page.drawText(declaration, {
      x: margin + 28,
      y: cursorY - 16,
      font,
      size: 8.8,
      color: black
    });
    page.drawText(this.formatDateOnly(acceptanceDate), {
      x: width / 2 - 24,
      y: cursorY - 32,
      font: boldFont,
      size: 9,
      color: black
    });

    cursorY -= 86;

    const signatureBoxWidth = (contentWidth - 84) / 2;
    const signatureHeight = 42;
    page.drawRectangle({
      x: margin + 4,
      y: cursorY - signatureHeight,
      width: signatureBoxWidth,
      height: signatureHeight,
      borderColor: black,
      borderWidth: 1
    });
    page.drawRectangle({
      x: margin + contentWidth - signatureBoxWidth - 4,
      y: cursorY - signatureHeight,
      width: signatureBoxWidth,
      height: signatureHeight,
      borderColor: black,
      borderWidth: 1
    });

    await this.drawSignatureOnPdf(pdf, page, report.technicianSignatureDataUrl, {
      x: margin + 8,
      y: cursorY - signatureHeight + 16,
      width: signatureBoxWidth - 16,
      height: 22
    });
    await this.drawSignatureOnPdf(pdf, page, report.clientSignatureDataUrl, {
      x: margin + contentWidth - signatureBoxWidth,
      y: cursorY - signatureHeight + 16,
      width: signatureBoxWidth - 16,
      height: 22
    });

    page.drawText('Assinatura do Tecnico', {
      x: margin + 70,
      y: cursorY - signatureHeight + 4,
      font,
      size: 8.5,
      color: black
    });
    page.drawText('Assinatura do Cliente', {
      x: margin + contentWidth - signatureBoxWidth + 78,
      y: cursorY - signatureHeight + 4,
      font,
      size: 8.5,
      color: black
    });

    return Buffer.from(await pdf.save());
  }

  private async convertDocxBufferToPdf(docxBuffer: Buffer, baseFileName: string) {
    const drive = this.getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    let temporaryGoogleDocId: string | null = null;

    try {
      const created = await drive.files.create({
        requestBody: {
          name: baseFileName,
          mimeType: 'application/vnd.google-apps.document',
          ...(rootFolderId ? { parents: [rootFolderId] } : {})
        },
        media: {
          mimeType: DOCX_MIME_TYPE,
          body: Readable.from(docxBuffer)
        },
        supportsAllDrives: true,
        fields: 'id'
      });

      temporaryGoogleDocId = created.data.id ?? null;
      if (!temporaryGoogleDocId) {
        throw new Error('Falha ao converter o template DOCX oficial para PDF.');
      }

      const exported = await drive.files.export(
        {
          fileId: temporaryGoogleDocId,
          mimeType: 'application/pdf'
        },
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(exported.data as ArrayBuffer);
    } finally {
      if (temporaryGoogleDocId) {
        try {
          await drive.files.delete({
            fileId: temporaryGoogleDocId,
            supportsAllDrives: true
          });
        } catch {
          // Ignora limpeza do temporario para nao mascarar o erro principal.
        }
      }
    }
  }

  private getServiceOrderPdfLayout(width: number, height: number, originalName: string) {
    const normalized = (originalName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normalized.includes('ordem_servico') || normalized.includes('ordem servico')) {
      return {
        notesBox: {
          x: width * 0.03,
          y: height * 0.17,
          width: width * 0.94,
          height: height * 0.11,
          paddingX: 8,
          paddingTop: 11,
          maxLines: 5,
          lineHeight: 13
        },
        acceptanceDate: {
          x: width * 0.485,
          y: height * 0.112,
          fontSize: 11
        },
        technicianSignatureBox: {
          x: width * 0.04,
          y: height * 0.214,
          width: width * 0.33,
          height: height * 0.038
        },
        clientSignatureBox: {
          x: width * 0.615,
          y: height * 0.214,
          width: width * 0.305,
          height: height * 0.038
        }
      };
    }

    return {
      notesBox: {
        x: width * 0.025,
        y: height * 0.185,
        width: width * 0.95,
        height: height * 0.12,
        paddingX: 10,
        paddingTop: 12,
        maxLines: 4,
        lineHeight: 14
      },
      acceptanceDate: {
        x: width * 0.47,
        y: height * 0.135,
        fontSize: 11
      },
      technicianSignatureBox: {
        x: width * 0.04,
        y: height * 0.038,
        width: width * 0.33,
        height: height * 0.045
      },
      clientSignatureBox: {
        x: width * 0.63,
        y: height * 0.038,
        width: width * 0.3,
        height: height * 0.045
      }
    };
  }

  private drawLabeledFullWidthBox(
    page: PDFPage,
    options: {
      x: number;
      y: number;
      width: number;
      label: string;
      text: string;
      font: PDFFont;
      boldFont: PDFFont;
    }
  ) {
    const black = rgb(0.08, 0.08, 0.08);
    page.drawText(options.label, {
      x: options.x + options.width / 2 - options.label.length * 2.6,
      y: options.y,
      font: options.boldFont,
      size: 10,
      color: black
    });
    const boxY = options.y - 16;
    page.drawRectangle({
      x: options.x,
      y: boxY - 24,
      width: options.width,
      height: 24,
      borderColor: black,
      borderWidth: 1
    });
    page.drawText(options.text || 'Nao informado', {
      x: options.x + 6,
      y: boxY - 16,
      font: options.font,
      size: 9,
      color: black
    });
    return boxY - 24;
  }

  private drawEquipmentTable(
    page: PDFPage,
    options: {
      x: number;
      y: number;
      width: number;
      font: PDFFont;
      boldFont: PDFFont;
      values: {
        code: string;
        name: string;
        model: string;
        observations: string;
        manufacturer: string;
      };
    }
  ) {
    const black = rgb(0.08, 0.08, 0.08);
    page.drawText('DADOS DO(S) EQUIPAMENTO(S)', {
      x: options.x + options.width / 2 - 84,
      y: options.y,
      font: options.boldFont,
      size: 10,
      color: black
    });

    const tableTop = options.y - 14;
    const headerHeight = 22;
    const rowHeight = 54;
    const widths = [0.16, 0.18, 0.2, 0.22, 0.24].map((ratio) => options.width * ratio);
    const labels = ['Codigo', 'Nome', 'Modelo', 'Observacoes', 'Fabricante'];
    const values = [
      options.values.code,
      options.values.name,
      options.values.model,
      options.values.observations,
      options.values.manufacturer
    ];

    let x = options.x;
    widths.forEach((columnWidth, index) => {
      page.drawRectangle({
        x,
        y: tableTop - headerHeight,
        width: columnWidth,
        height: headerHeight,
        borderColor: black,
        borderWidth: 1
      });
      page.drawRectangle({
        x,
        y: tableTop - headerHeight - rowHeight,
        width: columnWidth,
        height: rowHeight,
        borderColor: black,
        borderWidth: 1
      });
      page.drawText(labels[index], {
        x: x + 6,
        y: tableTop - 15,
        font: options.boldFont,
        size: 8.3,
        color: black
      });
      this.drawWrappedTextInBox(page, values[index] || 'Nao informado', {
        x,
        y: tableTop - headerHeight - rowHeight,
        width: columnWidth,
        height: rowHeight,
        paddingX: 4,
        paddingTop: 8,
        maxLines: 4,
        lineHeight: 10,
        font: options.font,
        color: black,
        minFontSize: 7,
        maxFontSize: 8.3
      });
      x += columnWidth;
    });

    return tableTop - headerHeight - rowHeight;
  }

  private drawServiceTable(
    page: PDFPage,
    options: {
      x: number;
      y: number;
      width: number;
      font: PDFFont;
      boldFont: PDFFont;
      code: string;
      description: string;
    }
  ) {
    const black = rgb(0.08, 0.08, 0.08);
    page.drawText('PRODUTOS / SERVICOS:', {
      x: options.x + options.width / 2 - 62,
      y: options.y,
      font: options.boldFont,
      size: 10,
      color: black
    });

    const tableTop = options.y - 14;
    const headerHeight = 22;
    const rowHeight = 28;
    const codeWidth = options.width * 0.32;
    const descWidth = options.width - codeWidth;

    page.drawRectangle({ x: options.x, y: tableTop - headerHeight, width: codeWidth, height: headerHeight, borderColor: black, borderWidth: 1 });
    page.drawRectangle({ x: options.x + codeWidth, y: tableTop - headerHeight, width: descWidth, height: headerHeight, borderColor: black, borderWidth: 1 });
    page.drawRectangle({ x: options.x, y: tableTop - headerHeight - rowHeight, width: codeWidth, height: rowHeight, borderColor: black, borderWidth: 1 });
    page.drawRectangle({ x: options.x + codeWidth, y: tableTop - headerHeight - rowHeight, width: descWidth, height: rowHeight, borderColor: black, borderWidth: 1 });

    page.drawText('Codigo', { x: options.x + 8, y: tableTop - 15, font: options.boldFont, size: 8.3, color: black });
    page.drawText('Descricao do(s) servico(s):', { x: options.x + codeWidth + 8, y: tableTop - 15, font: options.boldFont, size: 8.3, color: black });
    page.drawText(options.code || 'Nao informado', { x: options.x + 8, y: tableTop - headerHeight - 17, font: options.font, size: 8.5, color: black });
    this.drawWrappedTextInBox(page, options.description || 'Nao informado', {
      x: options.x + codeWidth,
      y: tableTop - headerHeight - rowHeight,
      width: descWidth,
      height: rowHeight,
      paddingX: 5,
      paddingTop: 6,
      maxLines: 2,
      lineHeight: 10,
      font: options.font,
      color: black,
      minFontSize: 7.5,
      maxFontSize: 8.3
    });

    return tableTop - headerHeight - rowHeight;
  }

  private async drawSignatureOnPdf(
    pdf: PDFDocument,
    page: PDFPage,
    dataUrl: string | undefined,
    box: { x: number; y: number; width: number; height: number }
  ) {
    if (!dataUrl?.startsWith('data:image/')) return;

    const image = await this.embedDataUrlImage(pdf, dataUrl);
    const dims = image.scale(1);
    const scale = Math.min(box.width / dims.width, box.height / dims.height);
    const targetWidth = dims.width * scale;
    const targetHeight = dims.height * scale;
    page.drawImage(image, {
      x: box.x + (box.width - targetWidth) / 2,
      y: box.y + (box.height - targetHeight) / 2,
      width: targetWidth,
      height: targetHeight
    });
  }

  private async embedDataUrlImage(pdf: PDFDocument, dataUrl: string) {
    const [meta, base64] = dataUrl.split(',');
    const bytes = Buffer.from(base64 ?? '', 'base64');
    if (meta.includes('image/png')) return pdf.embedPng(bytes);
    return pdf.embedJpg(bytes);
  }

  private replaceDocxPlaceholders(
    xml: string,
    placeholders: Record<string, string>,
    extra?: { notesText?: string; acceptanceDate?: Date }
  ) {
    let result = xml;
    for (const [key, value] of Object.entries(placeholders)) {
      const escaped = this.escapeXml(value);
      const pattern = new RegExp(`\\{\\s*${key}\\s*\\}`, 'g');
      result = result.replace(pattern, escaped);
      const sigePattern = new RegExp(`##\\s*${this.escapeRegex(key)}\\s*##`, 'g');
      result = result.replace(sigePattern, escaped);
    }

    if (placeholders.Estado) {
      result = result.replace(/#Estado##/g, this.escapeXml(placeholders.Estado));
    }

    if (extra) {
      result = this.fillTechnicalNotesArea(result, extra.notesText || 'Nao informado');
      result = this.fillAcceptanceDateArea(result, extra.acceptanceDate ?? new Date());
    }

    return this.removeDocxSignaturePlaceholders(result);
  }

  private fillTechnicalNotesArea(xml: string, notesText: string) {
    const rows = this.wrapTechnicalNotes(notesText, 5, 80);
    let result = xml;
    const paragraphRegex = /(<w:p[^>]*w14:paraId="[^"]*"[^>]*>.*?CONSIDERAÇÕES DO TÉCNICO.*?<\/w:p>)([\s\S]*?)(<w:tbl[^>]*>[\s\S]*?Assinatura do T[ée]cnico)/u;
    const match = result.match(paragraphRegex);
    if (!match) return result;

    const middle = match[2];
    const cellRegex = /(<w:tr[\s\S]*?<w:t>)(.*?)(<\/w:t>[\s\S]*?<\/w:tr>)/g;
    let index = 0;
    const replacedMiddle = middle.replace(cellRegex, (_full, start, _inner, end) => {
      if (index >= rows.length) return `${start}${''}${end}`;
      const text = this.escapeXml(rows[index]);
      index += 1;
      return `${start}${text}${end}`;
    });

    return result.replace(middle, replacedMiddle);
  }

  private fillAcceptanceDateArea(xml: string, acceptanceDate: Date) {
    const formatted = this.escapeXml(this.formatDateOnly(acceptanceDate));
    return xml.replace(/(__\/__\/____|___\/___\/_____)/g, formatted);
  }

  private async injectDocxSignatureImages(
    zip: JSZip,
    xml: string,
    signatures: {
      technicianSignatureDataUrl?: string;
      clientSignatureDataUrl?: string;
    }
  ) {
    let result = xml;
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (!relsFile) return this.removeDocxSignaturePlaceholders(result);

    let relsXml = await relsFile.async('string');
    let contentTypesXml = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypesXml) return this.removeDocxSignaturePlaceholders(result);

    let nextRelId = this.getNextDocxRelationshipId(relsXml);
    let nextDocPrId = this.getNextDocxDocPrId(result);

    const applySignature = async (token: string, dataUrl?: string) => {
      if (!dataUrl) {
        result = this.replaceDocxSignaturePlaceholder(result, token, '');
        return;
      }

      const parsed = this.parseDocxImageDataUrl(dataUrl);
      const ext = parsed.mimeType === 'image/png' ? 'png' : 'jpg';
      const mediaFileName = `signature-${randomUUID()}.${ext}`;
      const mediaPath = `word/media/${mediaFileName}`;
      zip.file(mediaPath, parsed.bytes);
      contentTypesXml = this.ensureDocxContentType(contentTypesXml!, ext);

      const relId = `rId${nextRelId++}`;
      relsXml = relsXml.replace(
        '</Relationships>',
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFileName}"/></Relationships>`
      );

      const docPrId = nextDocPrId++;
      const drawingXml = this.buildDocxInlineImageXml(relId, docPrId, token);
      result = this.replaceDocxSignaturePlaceholder(result, token, drawingXml);
    };

    await applySignature('AssinaturaTecnico', signatures.technicianSignatureDataUrl);
    await applySignature('AssinaturaCliente', signatures.clientSignatureDataUrl);

    zip.file('word/_rels/document.xml.rels', relsXml);
    zip.file('[Content_Types].xml', contentTypesXml);
    return result;
  }

  private replaceDocxSignaturePlaceholder(xml: string, token: string, replacementXml: string) {
    const patterns = [
      new RegExp(
        `<w:r[^>]*>[\\s\\S]*?<w:t[^>]*>\\s*##${this.escapeRegex(token)}##\\s*<\\/w:t>[\\s\\S]*?<\\/w:r>`,
        'g'
      ),
      new RegExp(
        `<w:r[^>]*>[\\s\\S]*?<w:t[^>]*>\\s*\\{\\s*${this.escapeRegex(token)}\\s*\\}\\s*<\\/w:t>[\\s\\S]*?<\\/w:r>`,
        'g'
      )
    ];

    let updated = xml;
    for (const pattern of patterns) {
      updated = updated.replace(pattern, replacementXml);
    }
    return updated;
  }

  private removeDocxSignaturePlaceholders(xml: string) {
    return xml
      .replace(/##\s*AssinaturaTecnico\s*##/g, '')
      .replace(/##\s*AssinaturaCliente\s*##/g, '')
      .replace(/\{\s*AssinaturaTecnico\s*\}/g, '')
      .replace(/\{\s*AssinaturaCliente\s*\}/g, '');
  }

  private getNextDocxRelationshipId(relsXml: string) {
    const matches = Array.from(relsXml.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]));
    return (matches.length ? Math.max(...matches) : 0) + 1;
  }

  private getNextDocxDocPrId(xml: string) {
    const matches = Array.from(xml.matchAll(/<wp:docPr[^>]*id="(\d+)"/g)).map((match) => Number(match[1]));
    return (matches.length ? Math.max(...matches) : 1000) + 1;
  }

  private parseDocxImageDataUrl(dataUrl: string) {
    const [meta, base64] = dataUrl.split(',');
    const mimeType = meta?.includes('image/png') ? 'image/png' : 'image/jpeg';
    return {
      mimeType,
      bytes: Buffer.from(base64 ?? '', 'base64')
    };
  }

  private ensureDocxContentType(contentTypesXml: string, ext: 'png' | 'jpg') {
    if (ext === 'png' && !contentTypesXml.includes('Extension="png"')) {
      return contentTypesXml.replace(
        '</Types>',
        '<Default Extension="png" ContentType="image/png"/></Types>'
      );
    }
    if (ext === 'jpg' && !contentTypesXml.includes('Extension="jpg"')) {
      return contentTypesXml.replace(
        '</Types>',
        '<Default Extension="jpg" ContentType="image/jpeg"/></Types>'
      );
    }
    return contentTypesXml;
  }

  private buildDocxInlineImageXml(relId: string, docPrId: number, name: string) {
    const widthEmu = 2_350_000;
    const heightEmu = 650_000;
    return [
      '<w:r>',
      '<w:drawing>',
      '<wp:inline distT="0" distB="0" distL="0" distR="0">',
      `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`,
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
      `<wp:docPr id="${docPrId}" name="${this.escapeXml(name)}"/>`,
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${this.escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`,
      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`,
      '<pic:spPr>',
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>`,
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
      '</pic:spPr>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r>'
    ].join('');
  }

  private wrapTechnicalNotes(text: string, maxLines: number, maxCharsPerLine: number) {
    const cleaned = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
    if (!cleaned) return Array.from({ length: maxLines }, () => '');
    const words = cleaned.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
        continue;
      }
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }

    if (lines.length < maxLines && current) lines.push(current);
    while (lines.length < maxLines) lines.push('');
    return lines.slice(0, maxLines);
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private drawWrappedText(
    page: any,
    text: string,
    options: {
      x: number;
      y: number;
      maxWidth: number;
      lineHeight: number;
      maxLines: number;
      font: PDFFont;
      fontSize: number;
      color: ReturnType<typeof rgb>;
    }
  ) {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const width = options.font.widthOfTextAtSize(candidate, options.fontSize);
      if (width <= options.maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) lines.push(currentLine);
      currentLine = word;
      if (lines.length >= options.maxLines - 1) break;
    }

    if (currentLine && lines.length < options.maxLines) lines.push(currentLine);
    if (lines.length === options.maxLines && words.length > 0) {
      const last = lines[lines.length - 1];
      if (!last.endsWith('...')) lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 3))}...`;
    }

    lines.forEach((line, index) => {
      page.drawText(line, {
        x: options.x,
        y: options.y - index * options.lineHeight,
        font: options.font,
        size: options.fontSize,
        color: options.color
      });
    });
  }

  private drawWrappedTextInBox(
    page: PDFPage,
    text: string,
    options: {
      x: number;
      y: number;
      width: number;
      height: number;
      paddingX: number;
      paddingTop: number;
      maxLines: number;
      lineHeight: number;
      font: PDFFont;
      color: ReturnType<typeof rgb>;
      minFontSize: number;
      maxFontSize: number;
    }
  ) {
    const sanitized = (text || '').replace(/\s+/g, ' ').trim() || 'Nao informado';
    let fontSize = options.maxFontSize;
    let lines: string[] = [];

    while (fontSize >= options.minFontSize) {
      lines = this.wrapTextToLines(sanitized, options.font, fontSize, options.width - options.paddingX * 2, options.maxLines);
      const totalHeight = lines.length * options.lineHeight;
      if (totalHeight <= options.height - options.paddingTop * 2) break;
      fontSize -= 0.5;
    }

    const yStart = options.y + options.height - options.paddingTop - fontSize;
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: options.x + options.paddingX,
        y: yStart - index * options.lineHeight,
        font: options.font,
        size: fontSize,
        color: options.color
      });
    });
  }

  private wrapTextToLines(
    text: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
    maxLines: number
  ) {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);

      if (candidateWidth <= maxWidth) {
        currentLine = candidate;
        continue;
      }

      if (currentLine) lines.push(currentLine);
      currentLine = word;

      if (lines.length >= maxLines - 1) {
        const remaining = [currentLine, ...words.slice(index + 1)].join(' ');
        lines.push(this.ellipsizeText(remaining, font, fontSize, maxWidth));
        return lines;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines.slice(0, maxLines);
  }

  private ellipsizeText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
    if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
    let output = text.trim();
    while (output.length > 1 && font.widthOfTextAtSize(`${output}...`, fontSize) > maxWidth) {
      output = output.slice(0, -1).trimEnd();
    }
    return `${output}...`;
  }

  private async downloadDriveFile(fileId: string): Promise<Buffer> {
    const drive = this.getDriveClient();
    const response = await drive.files.get(
      {
        fileId,
        alt: 'media',
        supportsAllDrives: true
      },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  private async downloadStoredAttachment(attachment: { driveFileId: string; driveFolderPath: string }) {
    if (attachment.driveFileId.startsWith(INLINE_ATTACHMENT_PREFIX)) {
      return this.readInlineAttachmentBuffer(attachment.driveFolderPath);
    }

    if (attachment.driveFileId.startsWith(LOCAL_ATTACHMENT_PREFIX)) {
      const legacyInlineBuffer = this.tryReadLegacyInlineAttachmentBuffer(attachment.driveFolderPath);
      if (legacyInlineBuffer) return legacyInlineBuffer;
      throw new NotFoundException('Este anexo local antigo nao esta mais disponivel. Reanexe a OS para continuar.');
    }

    return this.downloadDriveFile(attachment.driveFileId);
  }

  private resolveServiceOrderCompany(serviceType: string | null) {
    if (this.isStartOrTraining(serviceType)) {
      return {
        logoText: 'Metalique',
        name: 'METALIQUE ENGENHARIA E TECNOLOGIA',
        cnpj: '30.565.318/0001-90',
        branch: 'MATRIZ SP',
        address: 'Rua Reinaldo Raulino dos Santos, 79',
        cityStateZip: 'Sorocaba - SP CEP 18086-796',
        phones: '(15) 3411-0907 ou (15) 3411-0908'
      };
    }

    return {
      logoText: 'Visacut',
      name: 'VISACUT COMERCIO DE MAQUINAS EIRELI',
      cnpj: '26.715.677/0001-08',
      branch: 'MATRIZ SP',
      address: 'Rua Reinaldo Raulino dos Santos, 79',
      cityStateZip: 'Sorocaba - SP CEP 18086-796',
      phones: '(15) 3411-0907 ou (15) 3411-0908'
    };
  }

  private isStartOrTraining(serviceType: string | null) {
    const normalized = (serviceType || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return normalized.includes('start') || normalized.includes('treinamento') || normalized.includes('training');
  }

  private escapeHtml(value: string | number | null | undefined) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatDateOnly(date: Date) {
    if (Number.isNaN(date.getTime())) return 'Nao informado';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short'
    }).format(date);
  }

  private formatDateTime(date: Date) {
    if (Number.isNaN(date.getTime())) return 'Nao informado';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(date);
  }

  private extractAddressDetails(fullAddress: string | null) {
    const text = fullAddress || '';
    const bairroMatch = text.match(/BAIRRO:\s*([^,]+)/i);
    const cepMatch = text.match(/CEP:\s*([0-9.-]+)/i);
    return {
      bairro: bairroMatch?.[1]?.trim() || 'Nao informado',
      cep: cepMatch?.[1]?.trim() || 'Nao informado'
    };
  }

  private extractLocationDetails(fullAddress: string | null, city: string | null) {
    const text = fullAddress || '';
    const base = this.extractAddressDetails(fullAddress);
    const cityText = city || '';
    const cityStateMatch = cityText.match(/^\s*(.*?)\s*\/\s*([A-Z]{2})\s*$/i);
    const addressCityStateMatch = text.match(/,\s*([^,]+)\s*-\s*([A-Z]{2})\b/i);

    const resolvedCity =
      cityStateMatch?.[1]?.trim() ||
      addressCityStateMatch?.[1]?.trim() ||
      cityText.trim() ||
      'Nao informado';
    const resolvedState =
      cityStateMatch?.[2]?.trim().toUpperCase() ||
      addressCityStateMatch?.[2]?.trim().toUpperCase() ||
      'SP';

    return {
      ...base,
      cidade: resolvedCity,
      estado: resolvedState
    };
  }

  private extractLocationDetailsFromClient(
    client: { state: string | null; district: string | null; zipCode: string | null } | null | undefined,
    fullAddress: string | null,
    city: string | null
  ) {
    const derived = this.extractLocationDetails(fullAddress, city);
    return {
      ...derived,
      bairro: client?.district?.trim() || derived.bairro,
      cep: client?.zipCode?.trim() || derived.cep,
      estado: client?.state?.trim().toUpperCase() || derived.estado
    };
  }

  private escapeXml(value: string | number | null | undefined) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async attachFile(
    appointmentId: string,
    file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
    type?: string,
    baseUrl?: string | null
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { client: true, technician: true }
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');

    const originalName = file?.originalname ?? 'arquivo.bin';
    const mimeType = file?.mimetype ?? 'application/octet-stream';
    const size = file?.size ?? 0;
    const kind = this.normalizeAttachmentKind(type, mimeType);
    const attachmentId = randomUUID();
    let uploadResult: { fileId: string; folderPath: string; publicUrl: string | null };

    if (kind === ATTACHMENT_KIND.SERVICE_ORDER_TEMPLATE) {
      uploadResult = await this.saveAttachmentInline({
        attachmentId,
        appointmentId,
        fileName: originalName,
        mimeType,
        buffer: file?.buffer,
        baseUrl: baseUrl ?? null
      });
    } else {
      try {
        uploadResult = await this.uploadToDrive({
          appointmentId,
          clientName: appointment.client.name,
          osNumber: appointment.osNumber || appointment.id,
          technicianName: appointment.technician?.name || 'Sem tecnico',
          fileName: originalName,
          mimeType,
          buffer: file?.buffer
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao enviar arquivo para o Google Drive';
        if (kind === ATTACHMENT_KIND.TECHNICAL_REPORT && file?.buffer?.length) {
          uploadResult = await this.saveAttachmentInline({
            attachmentId,
            appointmentId,
            fileName: originalName,
            mimeType,
            buffer: file.buffer,
            baseUrl: baseUrl ?? null
          });
        } else if (message.includes('Service Accounts do not have storage quota')) {
          throw new InternalServerErrorException(
            'Google Drive bloqueou o upload para Service Account sem cota. Compartilhe uma Unidade Compartilhada com esta Service Account ou use delegacao OAuth de usuario.'
          );
        } else if (message.toLowerCase().includes('invalid_grant')) {
          throw new InternalServerErrorException(
            'Google Drive recusou a autenticacao do upload. Atualize as credenciais OAuth ou mantenha a Service Account com acesso de edicao na pasta compartilhada.'
          );
        } else {
          throw new InternalServerErrorException(message);
        }
      }
    }

    await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        appointmentId,
        kind,
        driveFileId: uploadResult.fileId,
        driveFolderPath: uploadResult.folderPath,
        originalName,
        mimeType,
        size,
        publicUrl: uploadResult.publicUrl
      }
    });
    return {
      ok: true,
      type: type ?? 'midia-tecnica',
      kind,
      fileId: uploadResult.fileId,
      folder: uploadResult.folderPath
    };
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
    machineCode: string | null;
    machineName: string | null;
    machineModel: string | null;
    machineSerial: string | null;
    machineManufacturer: string | null;
    machineObservations: string | null;
    serviceCode: string | null;
    serviceItemDescription: string | null;
    transportMode: string | null;
    flightAirport: string | null;
    flightDepartureAt: Date | null;
    flightReturnAt: Date | null;
    hotelName: string | null;
    hotelAddress: string | null;
    hotelCheckIn: Date | null;
    hotelCheckOut: Date | null;
    hotelNotes: string | null;
    client: {
      id: string;
      name: string;
      cnpj: string | null;
      ie: string | null;
      city: string;
      state: string | null;
      district: string | null;
      zipCode: string | null;
      address: string;
      phone: string | null;
      email: string | null;
    };
    technician: { id: string; name: string; baseCity: string; baseAddress: string; specialties: string[]; active: boolean; color: string } | null;
    attachments?: { id: string; kind: string; originalName: string; mimeType: string; size: number; publicUrl: string | null; createdAt: Date }[];
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
      machineCode: row.machineCode,
      machineName: row.machineName,
      machineModel: row.machineModel,
      machineSerial: row.machineSerial,
      machineManufacturer: row.machineManufacturer,
      machineObservations: row.machineObservations,
      serviceCode: row.serviceCode,
      serviceItemDescription: row.serviceItemDescription,
      transportMode: row.transportMode,
      flightAirport: row.flightAirport,
      flightDepartureAt: row.flightDepartureAt?.toISOString() ?? null,
      flightReturnAt: row.flightReturnAt?.toISOString() ?? null,
      hotelName: row.hotelName,
      hotelAddress: row.hotelAddress,
      hotelCheckIn: row.hotelCheckIn?.toISOString() ?? null,
      hotelCheckOut: row.hotelCheckOut?.toISOString() ?? null,
      hotelNotes: row.hotelNotes,
      needsHotel: Boolean(row.hotelName || row.hotelAddress || row.hotelCheckIn || row.hotelCheckOut),
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
      })),
      attachments: (row.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        kind: attachment.kind,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        publicUrl: this.buildAttachmentPublicPath(attachment.id),
        createdAt: attachment.createdAt.toISOString()
      }))
    };
  }

  private normalizeAttachmentKind(type: string | undefined, mimeType: string) {
    const normalized = String(type ?? '').trim().toLowerCase();
    if (normalized === 'service-order-template') return ATTACHMENT_KIND.SERVICE_ORDER_TEMPLATE;
    if (normalized === 'relato-tecnico') return ATTACHMENT_KIND.TECHNICAL_REPORT;
    if (normalized === 'assinatura-cliente') return ATTACHMENT_KIND.CLIENT_SIGNATURE;
    if (normalized === 'assinatura-tecnico') return ATTACHMENT_KIND.TECHNICIAN_SIGNATURE;
    if (normalized === 'midia-tecnica') return ATTACHMENT_KIND.TECHNICAL_MEDIA;
    if (normalized === 'documento-tecnico') return ATTACHMENT_KIND.TECHNICAL_DOCUMENT;
    if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) return ATTACHMENT_KIND.TECHNICAL_MEDIA;
    return ATTACHMENT_KIND.GENERAL;
  }

  async getAttachmentFile(attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Anexo nao encontrado');
    if (attachment.driveFileId.startsWith(INLINE_ATTACHMENT_PREFIX)) {
      const buffer = this.readInlineAttachmentBuffer(attachment.driveFolderPath);
      return {
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        buffer
      };
    }

    if (attachment.driveFileId.startsWith(LOCAL_ATTACHMENT_PREFIX)) {
      const buffer = this.tryReadLegacyInlineAttachmentBuffer(attachment.driveFolderPath);
      if (!buffer) {
        throw new NotFoundException('Este anexo local antigo nao esta mais disponivel. Reanexe a OS para continuar.');
      }
      return {
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        buffer
      };
    }

    const buffer = await this.downloadDriveFile(attachment.driveFileId);
    return {
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: buffer.length,
      buffer
    };
  }

  async deleteAttachment(attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Anexo nao encontrado');

    if (
      !attachment.driveFileId.startsWith(INLINE_ATTACHMENT_PREFIX) &&
      !attachment.driveFileId.startsWith(LOCAL_ATTACHMENT_PREFIX)
    ) {
      try {
        const drive = this.getDriveClient();
        await drive.files.delete({
          fileId: attachment.driveFileId,
          supportsAllDrives: true
        });
      } catch {
        // Se o arquivo externo ja nao existir, ainda removemos o registro local.
      }
    }

    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    return { ok: true };
  }

  private async saveAttachmentInline(params: {
    attachmentId: string;
    appointmentId: string;
    fileName: string;
    mimeType: string;
    buffer?: Buffer;
    baseUrl: string | null;
  }) {
    if (!params.buffer?.length) throw new InternalServerErrorException('Arquivo invalido para upload');

    const publicPath = `/api/attachments/files/${params.attachmentId}`;
    return {
      fileId: `${INLINE_ATTACHMENT_PREFIX}${params.attachmentId}`,
      folderPath: `${INLINE_ATTACHMENT_PREFIX}${params.buffer.toString('base64')}`,
      publicUrl: params.baseUrl ? `${params.baseUrl}${publicPath}` : publicPath
    };
  }

  private readInlineAttachmentBuffer(encoded: string) {
    if (!encoded.startsWith(INLINE_ATTACHMENT_PREFIX)) {
      throw new InternalServerErrorException('Conteudo inline do anexo invalido');
    }
    return Buffer.from(encoded.slice(INLINE_ATTACHMENT_PREFIX.length), 'base64');
  }

  private buildAttachmentPublicPath(attachmentId: string) {
    return `/api/attachments/files/${attachmentId}`;
  }

  private tryReadLegacyInlineAttachmentBuffer(encoded: string) {
    if (!encoded.startsWith(INLINE_ATTACHMENT_PREFIX)) return null;
    return Buffer.from(encoded.slice(INLINE_ATTACHMENT_PREFIX.length), 'base64');
  }

  private async uploadToDrive(params: {
    appointmentId: string;
    clientName: string;
    osNumber: string;
    technicianName: string;
    fileName: string;
    mimeType: string;
    buffer?: Buffer;
  }) {
    return this.uploadToDriveWithClient(params);
  }

  private async uploadToDriveWithClient(
    params: {
      appointmentId: string;
      clientName: string;
      osNumber: string;
      technicianName: string;
      fileName: string;
      mimeType: string;
      buffer?: Buffer;
    }
  ) {
    const drive = this.getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID nao configurado');
    if (!params.buffer || !params.buffer.length) throw new Error('Arquivo invalido para upload');

    const safeClient = this.sanitizeFolderName(params.clientName || 'Cliente');
    const safeOs = this.sanitizeFolderName('OS ' + (params.osNumber || params.appointmentId) + ' - ' + params.technicianName);
    const clientFolderId = await this.findOrCreateFolder(drive, safeClient, rootFolderId);
    const osFolderId = await this.findOrCreateFolder(drive, safeOs, clientFolderId);

    const shouldConvertToGoogleDoc = params.mimeType === 'text/html';
    const driveFileName = shouldConvertToGoogleDoc
      ? params.fileName.replace(/\.(html?|docx)$/i, '')
      : params.fileName;
    const createFile = (convertToGoogleDoc: boolean) =>
      drive.files.create({
        requestBody: {
          name: convertToGoogleDoc ? driveFileName : params.fileName,
          parents: [osFolderId],
          ...(convertToGoogleDoc ? { mimeType: 'application/vnd.google-apps.document' } : {})
        },
        media: {
          mimeType: params.mimeType,
          body: Readable.from(params.buffer!)
        },
        supportsAllDrives: true,
        fields: 'id,webViewLink,webContentLink'
      });

    let created;
    try {
      created = await createFile(shouldConvertToGoogleDoc);
    } catch (error) {
      if (!shouldConvertToGoogleDoc) throw error;
      created = await createFile(false);
    }

    const fileId = created.data.id;
    if (!fileId) throw new Error('Falha ao criar arquivo no Google Drive');

    return {
      fileId,
      folderPath: `${safeClient}/${safeOs}`,
      publicUrl: created.data.webViewLink || created.data.webContentLink || null
    };
  }

  private async findOrCreateFolder(drive: ReturnType<typeof google.drive>, folderName: string, parentId: string) {
    const escaped = folderName.replace(/'/g, "\\'");
    const query = [
      `mimeType = 'application/vnd.google-apps.folder'`,
      `name = '${escaped}'`,
      `'${parentId}' in parents`,
      `trashed = false`
    ].join(' and ');

    const found = await drive.files.list({
      q: query,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: 'files(id,name)',
      pageSize: 1
    });
    const existingId = found.data.files?.[0]?.id;
    if (existingId) return existingId;

    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      supportsAllDrives: true,
      fields: 'id'
    });
    if (!created.data.id) throw new Error(`Falha ao criar pasta no Google Drive: ${folderName}`);
    return created.data.id;
  }

  private getDriveClient() {
    if (this.driveClient) return this.driveClient;

    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

    if (oauthClientId && oauthClientSecret && oauthRefreshToken) {
      const oauth2Client = new google.auth.OAuth2({
        clientId: oauthClientId,
        clientSecret: oauthClientSecret
      });
      oauth2Client.setCredentials({
        refresh_token: oauthRefreshToken
      });
      this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
      return this.driveClient;
    }

    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
    if (!clientEmail || !privateKeyRaw) {
      throw new Error(
        'Credenciais do Google Drive nao configuradas. Defina GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_OAUTH_REFRESH_TOKEN ou GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY.'
      );
    }
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    this.driveClient = google.drive({ version: 'v3', auth });
    return this.driveClient;
  }

  private isInvalidGrantError(error: unknown) {
    if (!error || typeof error !== 'object') return false;

    const maybeError = error as {
      message?: string;
      response?: { data?: unknown };
      errors?: Array<{ message?: string }>;
    };

    const responseData =
      typeof maybeError.response?.data === 'string'
        ? maybeError.response.data
        : JSON.stringify(maybeError.response?.data ?? {});

    return [maybeError.message, responseData, ...(maybeError.errors?.map((item) => item.message) ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes('invalid_grant'));
  }

  private sanitizeFolderName(value: string) {
    return (
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\\/:*?"<>|#]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'Pasta'
    );
  }

  private isSameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private async resolvePoint(appointment: {
    id: string;
    city: string;
    fullAddress: string;
    latitude: number | null;
    longitude: number | null;
    client: { address?: string | null; latitude: number | null; longitude: number | null };
  }) {
    const lat = appointment.latitude ?? appointment.client?.latitude;
    const lng = appointment.longitude ?? appointment.client?.longitude;
    if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };

    const point = await this.geocodeAddress(appointment.fullAddress || appointment.client?.address || '', appointment.city);
    if (!point) return null;

    void this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { latitude: point.lat, longitude: point.lng }
    }).catch(() => undefined);

    return point;
  }

  private buildMapsQuery(address?: string | null, city?: string | null) {
    const normalizedCity = String(city ?? '')
      .replace(/\s*\/\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
    return [String(address ?? '').trim(), normalizedCity, 'Brasil'].filter(Boolean).join(', ');
  }

  private async geocodeAddress(address?: string | null, city?: string | null) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const query = this.buildMapsQuery(address, city);
    if (!key || !query) return null;

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      if (payload.status !== 'OK') return null;
      const location = payload.results?.[0]?.geometry?.location;
      if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return null;
      return { lat: location.lat, lng: location.lng };
    } catch {
      return null;
    }
  }

  private haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const radius = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  private normalizeVehicleCreatePayload(payload: {
    name?: string;
    year?: number | string | null;
    plate?: string;
    mileage?: number | string | null;
  }): Prisma.VehicleUncheckedCreateInput {
    const name = payload.name?.trim();
    const plate = payload.plate?.trim().toUpperCase();
    const year = payload.year == null || payload.year === '' ? null : Number(payload.year);
    const mileage = payload.mileage == null || payload.mileage === '' ? 0 : Number(payload.mileage);

    if (!name) throw new InternalServerErrorException('Nome do veiculo e obrigatorio');
    if (!plate) throw new InternalServerErrorException('Placa e obrigatoria');

    if (year != null && (!Number.isInteger(year) || year < 1900 || year > 3000)) {
      throw new InternalServerErrorException('Ano do veiculo invalido');
    }

    if (!Number.isFinite(mileage) || mileage < 0) {
      throw new InternalServerErrorException('Quilometragem invalida');
    }

    return {
      name,
      plate,
      year,
      mileage: Math.round(mileage)
    };
  }

  private normalizeVehicleUpdatePayload(payload: {
    name?: string;
    year?: number | string | null;
    plate?: string;
    mileage?: number | string | null;
  }): Prisma.VehicleUncheckedUpdateInput {
    const data: Prisma.VehicleUncheckedUpdateInput = {};

    if (payload.name !== undefined) {
      const name = payload.name.trim();
      if (!name) throw new InternalServerErrorException('Nome do veiculo e obrigatorio');
      data.name = name;
    }

    if (payload.plate !== undefined) {
      const plate = payload.plate.trim().toUpperCase();
      if (!plate) throw new InternalServerErrorException('Placa e obrigatoria');
      data.plate = plate;
    }

    if (payload.year !== undefined) {
      const year = payload.year == null || payload.year === '' ? null : Number(payload.year);
      if (year != null && (!Number.isInteger(year) || year < 1900 || year > 3000)) {
        throw new InternalServerErrorException('Ano do veiculo invalido');
      }
      data.year = year;
    }

    if (payload.mileage !== undefined) {
      const mileage = payload.mileage == null || payload.mileage === '' ? 0 : Number(payload.mileage);
      if (!Number.isFinite(mileage) || mileage < 0) {
        throw new InternalServerErrorException('Quilometragem invalida');
      }
      data.mileage = Math.round(mileage);
    }

    return data;
  }
}


