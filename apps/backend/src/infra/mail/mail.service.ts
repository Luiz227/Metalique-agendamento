import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

type ConfirmedAppointmentEmail = {
  id: string;
  city: string;
  fullAddress: string;
  serviceType: string;
  date: Date;
  startTime: Date;
  endTime: Date;
  daysOut: number;
  transportMode: string | null;
  flightAirport: string | null;
  flightDepartureAt: Date | null;
  flightReturnAt: Date | null;
  client: { name: string };
  technician: { name: string; user: { email: string } | null } | null;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendAppointmentConfirmed(appointment: ConfirmedAppointmentEmail) {
    const recipients = await this.resolveRecipients(appointment.technician?.user?.email);
    if (!recipients.length) return { sent: false, reason: 'no_recipients' };

    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const password = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
    if (!host || !user || !password) {
      this.logger.warn('E-mail de confirmacao nao enviado: SMTP_HOST, SMTP_USER ou SMTP_PASSWORD ausente.');
      return { sent: false, reason: 'smtp_not_configured' };
    }

    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password }
    });

    const technicianName = appointment.technician?.name || 'Tecnico ainda nao informado';
    const subject = `Agendamento confirmado - ${appointment.client.name} - ${this.formatDate(appointment.date)}`;
    const flightDetails = appointment.transportMode === 'AIR'
      ? `
        <h3>Viagem aerea</h3>
        <p><strong>Aeroporto:</strong> ${this.escapeHtml(appointment.flightAirport || 'Nao informado')}</p>
        <p><strong>Voo de ida:</strong> ${this.formatDateTime(appointment.flightDepartureAt)}</p>
        <p><strong>Voo de volta:</strong> ${this.formatDateTime(appointment.flightReturnAt)}</p>
      `
      : '';

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: recipients.join(', '),
        subject,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:680px;color:#18181b">
            <h2>Agendamento confirmado</h2>
            <p>O atendimento abaixo foi confirmado no Agenda Metalique.</p>
            <p><strong>Cliente:</strong> ${this.escapeHtml(appointment.client.name)}</p>
            <p><strong>Tecnico:</strong> ${this.escapeHtml(technicianName)}</p>
            <p><strong>Servico:</strong> ${this.escapeHtml(appointment.serviceType)}</p>
            <p><strong>Data:</strong> ${this.formatDate(appointment.date)}</p>
            <p><strong>Horario:</strong> ${this.formatTime(appointment.startTime)} ate ${this.formatTime(appointment.endTime)}</p>
            <p><strong>Dias em campo:</strong> ${appointment.daysOut}</p>
            <p><strong>Cidade:</strong> ${this.escapeHtml(appointment.city)}</p>
            <p><strong>Endereco:</strong> ${this.escapeHtml(appointment.fullAddress)}</p>
            ${flightDetails}
            <div style="margin-top:24px;padding:16px;border-left:4px solid #c8142f;background:#fff1f2;border-radius:6px">
              <strong style="color:#9f1239">Importante</strong>
              <p style="margin:8px 0 0;line-height:1.5">
                Mais informacoes sobre o agendamento, orientacoes, documentos e atualizacoes estarao disponiveis no aplicativo do tecnico.
              </p>
            </div>
          </div>
        `
      });
      return { sent: true, recipients: recipients.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao enviar confirmacao do agendamento ${appointment.id}: ${message}`);
      return { sent: false, reason: 'send_failed' };
    }
  }

  private async resolveRecipients(technicianEmail?: string | null) {
    const latest = await this.prisma.auditLog.findFirst({
      where: { entity: 'settings', action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true }
    });
    const metadata = this.asRecord(latest?.metadata);
    const configured = String(metadata.notificationEmails ?? '')
      .split(/[;,\n]/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const recipients = [technicianEmail?.trim().toLowerCase(), ...configured].filter(Boolean) as string[];
    return Array.from(new Set(recipients));
  }

  private asRecord(value: Prisma.JsonValue | null | undefined): Record<string, Prisma.JsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : {};
  }

  private formatDate(value: Date) {
    return value.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  private formatTime(value: Date) {
    return value.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }

  private formatDateTime(value: Date | null) {
    if (!value) return 'Nao informado';
    return value.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short'
    });
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
