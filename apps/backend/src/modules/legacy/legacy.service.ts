import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';

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

      const templateAttachment = appointment.attachments.find((attachment) => attachment.kind === ATTACHMENT_KIND.SERVICE_ORDER_TEMPLATE);

      if (templateAttachment?.mimeType === 'application/pdf') {
        const reportPdf = await this.buildFilledServiceOrderPdf(appointment, templateAttachment, {
          summary,
          finishedAt: report?.finishedAt,
          clientSignatureDataUrl: report?.clientSignatureDataUrl,
          technicianSignatureDataUrl: report?.technicianSignatureDataUrl
        });

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
      } else {
        const reportText = this.buildServiceOrderHtml(appointment, {
          summary,
          finishedAt: report?.finishedAt,
          clientSignatureDataUrl: report?.clientSignatureDataUrl,
          technicianSignatureDataUrl: report?.technicianSignatureDataUrl
        });
        const reportBytes = Buffer.from(reportText, 'utf8');
        await this.attachFile(
          id,
          {
            originalname: 'ordem-servico-' + (appointment.osNumber || appointment.id) + '-' + new Date().toISOString().slice(0, 10) + '.html',
            mimetype: 'text/html',
            size: reportBytes.length,
            buffer: reportBytes
          },
          ATTACHMENT_KIND.TECHNICAL_REPORT
        );
      }
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

    const notesText = report.summary?.trim() || 'Nao informado';
    const noteFontSize = Math.max(10, Math.min(12, width / 58));
    const notesBox = {
      x: width * 0.02,
      y: height * 0.275,
      width: width * 0.96,
      height: height * 0.14
    };
    this.drawWrappedText(page, notesText, {
      x: notesBox.x + 12,
      y: notesBox.y + notesBox.height - 16,
      maxWidth: notesBox.width - 20,
      lineHeight: noteFontSize + 6,
      maxLines: 4,
      font,
      fontSize: noteFontSize,
      color: rgb(0.08, 0.08, 0.08)
    });

    const acceptanceDate = report.finishedAt ? new Date(report.finishedAt) : new Date();
    const acceptanceDateText = this.formatDateOnly(acceptanceDate);
    page.drawText(acceptanceDateText, {
      x: width * 0.49,
      y: height * 0.205,
      font: boldFont,
      size: 12,
      color: rgb(0.08, 0.08, 0.08)
    });

    await this.drawSignatureOnPdf(pdf, page, report.technicianSignatureDataUrl, {
      x: width * 0.04,
      y: height * 0.075,
      width: width * 0.32,
      height: height * 0.055
    });
    await this.drawSignatureOnPdf(pdf, page, report.clientSignatureDataUrl, {
      x: width * 0.64,
      y: height * 0.075,
      width: width * 0.28,
      height: height * 0.055
    });

    return Buffer.from(await pdf.save());
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
        if (message.includes('Service Accounts do not have storage quota')) {
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
    machineName: string | null;
    machineModel: string | null;
    machineSerial: string | null;
    transportMode: string | null;
    flightAirport: string | null;
    flightDepartureAt: Date | null;
    flightReturnAt: Date | null;
    hotelName: string | null;
    hotelAddress: string | null;
    hotelCheckIn: Date | null;
    hotelCheckOut: Date | null;
    hotelNotes: string | null;
    client: { id: string; name: string; city: string; address: string; phone: string | null; email: string | null };
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
      machineName: row.machineName,
      machineModel: row.machineModel,
      machineSerial: row.machineSerial,
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
        publicUrl: attachment.publicUrl,
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

    throw new NotFoundException('Este anexo nao esta disponivel para download local');
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
    const driveFileName = shouldConvertToGoogleDoc ? params.fileName.replace(/\.html?$/i, '') : params.fileName;
    const created = await drive.files.create({
      requestBody: {
        name: driveFileName,
        parents: [osFolderId],
        ...(shouldConvertToGoogleDoc ? { mimeType: 'application/vnd.google-apps.document' } : {})
      },
      media: {
        mimeType: params.mimeType,
        body: Readable.from(params.buffer)
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink,webContentLink'
    });

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


