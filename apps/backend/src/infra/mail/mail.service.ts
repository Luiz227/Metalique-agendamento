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
  flightOutboundAirport: string | null;
  flightReturnAirport: string | null;
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
    if (!recipients.length) {
      this.logger.warn(`E-mail de confirmacao nao enviado para ${appointment.id}: nenhum destinatario configurado.`);
      return { sent: false, reason: 'no_recipients' };
    }

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
        <tr>
          <td style="padding:7px 0;color:#52525b;width:150px">Aeroporto de ida:</td>
          <td style="padding:7px 0;color:#18181b;font-weight:600">${this.escapeHtml(appointment.flightOutboundAirport || appointment.flightAirport || 'Nao informado')}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#52525b;width:150px">Aeroporto de volta:</td>
          <td style="padding:7px 0;color:#18181b;font-weight:600">${this.escapeHtml(appointment.flightReturnAirport || appointment.flightAirport || 'Nao informado')}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#52525b">Data de ida:</td>
          <td style="padding:7px 0;color:#18181b;font-weight:600">${this.formatOptionalDate(appointment.flightDepartureAt)}</td>
        </tr>
        <tr>
          <td style="padding:7px 0;color:#52525b">Data de volta:</td>
          <td style="padding:7px 0;color:#18181b;font-weight:600">${this.formatOptionalDate(appointment.flightReturnAt)}</td>
        </tr>
      `
      : '';

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: recipients.join(', '),
        subject,
        html: `<!doctype html>
          <html lang="pt-BR">
            <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
                      <tr>
                        <td style="padding:24px 30px;background:#d3113a;color:#ffffff">
                          <div style="font-size:24px;line-height:1.25;font-weight:700">Agendamento confirmado</div>
                          <div style="margin-top:6px;font-size:14px;color:#ffe4e9">Agenda Metalique</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:30px">
                          <p style="margin:0 0 16px;font-size:16px;line-height:1.6">Ol&aacute;, ${this.escapeHtml(technicianName)}.</p>
                          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46">
                            Um atendimento foi confirmado e vinculado &agrave; sua agenda. Confira abaixo as informa&ccedil;&otilde;es principais.
                          </p>

                          <div style="padding:20px;border-left:4px solid #d3113a;background:#f7f7f8;border-radius:8px">
                            <div style="margin-bottom:12px;font-size:17px;font-weight:700;color:#d3113a">Dados do agendamento</div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px">
                              <tr><td style="padding:7px 0;color:#52525b;width:150px">Cliente:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.client.name)}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">T&eacute;cnico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(technicianName)}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">Servi&ccedil;o:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.serviceType)}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">Data:</td><td style="padding:7px 0;font-weight:600">${this.formatDate(appointment.date)}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">Dias em campo:</td><td style="padding:7px 0;font-weight:600">${appointment.daysOut}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">Cidade:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.city)}</td></tr>
                              <tr><td style="padding:7px 0;color:#52525b">Endere&ccedil;o:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.fullAddress)}</td></tr>
                              ${flightDetails}
                            </table>
                          </div>

                          <div style="margin-top:24px;padding:18px;border:1px solid #fecdd3;background:#fff1f2;border-radius:8px">
                            <strong style="color:#9f1239">Importante</strong>
                            <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#4c0519">
                              Mais informa&ccedil;&otilde;es sobre o agendamento, orienta&ccedil;&otilde;es, documentos e atualiza&ccedil;&otilde;es estar&atilde;o dispon&iacute;veis no aplicativo do t&eacute;cnico.
                            </p>
                          </div>

                          <p style="margin:28px 0 0;font-size:14px;line-height:1.6;color:#52525b">
                            Atenciosamente,<br><strong style="color:#18181b">Agenda Metalique</strong>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          </html>`
      });
      this.logger.log(`E-mail de confirmacao do agendamento ${appointment.id} enviado para ${recipients.length} destinatario(s).`);
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

  private formatOptionalDate(value: Date | null) {
    if (!value) return 'Nao informado';
    return this.formatDate(value);
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
