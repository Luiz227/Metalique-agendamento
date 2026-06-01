import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { google } from 'googleapis';
import { Readable } from 'stream';

@Injectable()
export class LegacyService {
  constructor(private readonly prisma: PrismaService) {}

  private driveClient: ReturnType<typeof google.drive> | null = null;

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
    await this.rebuildSuggestionsFromAppointments();

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

  private async rebuildSuggestionsFromAppointments() {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.WAITING, AppointmentStatus.READY] }
      },
      include: { client: true, technician: true, statusLogs: true },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }]
    });

    const keepPairs = new Set<string>();

    for (let i = 0; i < appointments.length; i += 1) {
      for (let j = i + 1; j < appointments.length; j += 1) {
        const a = appointments[i];
        const b = appointments[j];
        if (!this.isSameDay(a.date, b.date)) continue;

        const pointA = this.resolvePoint(a);
        const pointB = this.resolvePoint(b);
        if (!pointA || !pointB) continue;

        const distanceKm = this.haversineKm(pointA, pointB);
        if (!Number.isFinite(distanceKm) || distanceKm > 30) continue;

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

    let technician =
      identity.userId
        ? await this.prisma.technician.findFirst({
            where: { userId: identity.userId }
          })
        : null;

    if (!technician && identity.email) {
      const userByEmail = await this.prisma.user.findUnique({
        where: { email: identity.email }
      });

      if (userByEmail) {
        technician = await this.prisma.technician.findFirst({
          where: {
            OR: [{ userId: userByEmail.id }]
          }
        });

        if (!technician && identity.name?.trim()) {
          technician = await this.prisma.technician.findFirst({
            where: { name: { equals: identity.name.trim(), mode: 'insensitive' } }
          });
        }

        if (technician && !technician.userId) {
          technician = await this.prisma.technician.update({
            where: { id: technician.id },
            data: { userId: userByEmail.id }
          });
        }
      }
    }

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

    if (summary?.trim()) {
      const reportBytes = Buffer.from(summary.trim(), 'utf8');
      await this.attachFile(
        id,
        {
          originalname: `relato-tecnico-${new Date().toISOString().slice(0, 10)}.txt`,
          mimetype: 'text/plain',
          size: reportBytes.length,
          buffer: reportBytes
        },
        'relato-tecnico'
      );
    }

    return { ok: true };
  }

  async attachFile(
    appointmentId: string,
    file?: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer },
    type?: string
  ) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { client: true }
    });
    if (!appointment) throw new NotFoundException('Agendamento não encontrado');

    const originalName = file?.originalname ?? 'arquivo.bin';
    const mimeType = file?.mimetype ?? 'application/octet-stream';
    const size = file?.size ?? 0;
    let uploadResult: { fileId: string; folderPath: string; publicUrl: string | null };
    try {
      uploadResult = await this.uploadToDrive({
        appointmentId,
        clientName: appointment.client.name,
        osNumber: appointment.osNumber || appointment.id,
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
      }
      throw new InternalServerErrorException(message);
    }

    await this.prisma.attachment.create({
      data: {
        appointmentId,
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

  private async uploadToDrive(params: {
    appointmentId: string;
    clientName: string;
    osNumber: string;
    fileName: string;
    mimeType: string;
    buffer?: Buffer;
  }) {
    const drive = this.getDriveClient();
    const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID não configurado');
    if (!params.buffer || !params.buffer.length) throw new Error('Arquivo inválido para upload');

    const safeClient = this.sanitizeFolderName(params.clientName || 'Cliente');
    const safeOs = this.sanitizeFolderName(params.osNumber || params.appointmentId);
    const clientFolderId = await this.findOrCreateFolder(drive, safeClient, rootFolderId);
    const osFolderId = await this.findOrCreateFolder(drive, safeOs, clientFolderId);

    const created = await drive.files.create({
      requestBody: {
        name: params.fileName,
        parents: [osFolderId]
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

  private resolvePoint(appointment: {
    latitude: number | null;
    longitude: number | null;
    client: { latitude: number | null; longitude: number | null };
  }) {
    const lat = appointment.latitude ?? appointment.client?.latitude;
    const lng = appointment.longitude ?? appointment.client?.longitude;
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng) };
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
}

