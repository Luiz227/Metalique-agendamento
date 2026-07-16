import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { ApiUsageService } from '../../modules/api-usage/api-usage.service';

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
  vendorName?: string | null;
  vendorEmail?: string | null;
  client: { name: string; email: string | null };
  technician: { name: string; user: { email: string } | null } | null;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiUsage: ApiUsageService
  ) {}

  async sendAppointmentConfirmed(appointment: ConfirmedAppointmentEmail) {
    const technicianEmail = this.normalizeEmail(appointment.technician?.user?.email);
    const clientEmail = this.normalizeEmail(appointment.client.email);
    const vendorEmail = this.normalizeEmail(appointment.vendorEmail);
    const reservedEmails = new Set([technicianEmail, clientEmail, vendorEmail].filter(Boolean));
    const configuredRecipients = (await this.resolveConfiguredRecipients())
      .filter((email) => !reservedEmails.has(email));
    const recipientCount = Number(Boolean(technicianEmail)) + Number(Boolean(clientEmail)) + Number(Boolean(vendorEmail)) + configuredRecipients.length;
    if (!recipientCount) {
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
      const deliveryPromises: Promise<unknown>[] = [];
      if (technicianEmail) deliveryPromises.push(transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: technicianEmail,
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
      }));

      if (clientEmail) deliveryPromises.push(transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: clientEmail,
        subject: `Visita tecnica confirmada - ${this.formatDate(appointment.date)}`,
        html: this.renderClientConfirmation(appointment, technicianName)
      }));

      if (vendorEmail) deliveryPromises.push(transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: vendorEmail,
        subject: `Visita tecnica agendada para seu cliente - ${appointment.client.name}`,
        html: this.renderVendorConfirmation(appointment, technicianName)
      }));

      deliveryPromises.push(...configuredRecipients.map((recipient) => transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: recipient,
        subject: `Resumo do agendamento confirmado - ${appointment.client.name} - ${this.formatDate(appointment.date)}`,
        html: this.renderManagementConfirmation(appointment, technicianName)
      })));

      const results = await Promise.allSettled(deliveryPromises);
      const delivered = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - delivered;
      await this.trackEmailUsage('appointment-confirmed', delivered, failed, appointment.id);
      if (failed) this.logger.warn(`${failed} e-mail(s) do agendamento ${appointment.id} falharam; ${delivered} foram entregues.`);
      else this.logger.log(`E-mails de confirmacao do agendamento ${appointment.id} enviados separadamente para ${delivered} destinatario(s).`);
      return {
        sent: delivered > 0,
        recipients: delivered,
        failed,
        deliveries: {
          technician: Boolean(technicianEmail),
          client: Boolean(clientEmail),
          vendor: Boolean(vendorEmail),
          additional: configuredRecipients.length
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.trackEmailUsage('appointment-confirmed', 0, 1, appointment.id, message);
      this.logger.error(`Falha ao enviar confirmacao do agendamento ${appointment.id}: ${message}`);
      return { sent: false, reason: 'send_failed' };
    }
  }

  async sendAppointmentRescheduled(appointment: ConfirmedAppointmentEmail) {
    return this.sendAppointmentUpdate(appointment, {
      event: 'reagendamento',
      title: 'Agendamento reagendado',
      subtitle: 'A data do atendimento foi atualizada',
      message: 'Um atendimento da sua agenda foi reagendado. Confira abaixo a nova data e os dados principais.',
      accent: '#d97706',
      accentSoft: '#fffbeb'
    });
  }

  async sendAppointmentCancelled(appointment: ConfirmedAppointmentEmail, reason?: string) {
    return this.sendAppointmentUpdate(appointment, {
      event: 'cancelamento',
      title: 'Agendamento cancelado',
      subtitle: 'O atendimento foi removido da agenda',
      message: 'Um atendimento foi cancelado e não aparecerá mais na agenda do técnico.',
      accent: '#be123c',
      accentSoft: '#fff1f2',
      reason: reason?.trim() || 'Motivo não informado'
    });
  }

  private async sendAppointmentUpdate(
    appointment: ConfirmedAppointmentEmail,
    options: {
      event: string;
      title: string;
      subtitle: string;
      message: string;
      accent: string;
      accentSoft: string;
      reason?: string;
    }
  ) {
    const recipients = await this.resolveRecipients(appointment.technician?.user?.email);
    if (!recipients.length) {
      this.logger.warn(`E-mail de ${options.event} não enviado para ${appointment.id}: nenhum destinatário configurado.`);
      return { sent: false, reason: 'no_recipients' };
    }

    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const password = process.env.SMTP_PASSWORD || process.env.SMTP_PASS;
    if (!host || !user || !password) {
      this.logger.warn(`E-mail de ${options.event} não enviado: configuração SMTP ausente.`);
      return { sent: false, reason: 'smtp_not_configured' };
    }

    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass: password } });
    const technicianName = appointment.technician?.name || 'Técnico ainda não informado';
    const reasonBlock = options.reason
      ? `<div style="margin-top:18px;padding:14px;border-radius:8px;background:${options.accentSoft};border:1px solid ${options.accent}33"><strong>Motivo:</strong> ${this.escapeHtml(options.reason)}</div>`
      : '';

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM?.trim() || user,
        to: recipients.join(', '),
        subject: `${options.title} - ${appointment.client.name} - ${this.formatDate(appointment.date)}`,
        html: `<!doctype html>
          <html lang="pt-BR">
            <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
                    <tr><td style="padding:24px 30px;background:${options.accent};color:#fff">
                      <div style="font-size:24px;font-weight:700">${options.title}</div>
                      <div style="margin-top:6px;font-size:14px;color:#fff;opacity:.88">${options.subtitle}</div>
                    </td></tr>
                    <tr><td style="padding:30px">
                      <p style="margin:0 0 8px;font-size:16px">Olá, ${this.escapeHtml(technicianName)}.</p>
                      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46">${options.message}</p>
                      <div style="padding:20px;border-left:4px solid ${options.accent};background:#f7f7f8;border-radius:8px">
                        <div style="margin-bottom:12px;font-size:17px;font-weight:700;color:${options.accent}">Dados do agendamento</div>
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px">
                          <tr><td style="padding:7px 0;color:#52525b;width:150px">Cliente:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.client.name)}</td></tr>
                          <tr><td style="padding:7px 0;color:#52525b">Técnico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(technicianName)}</td></tr>
                          <tr><td style="padding:7px 0;color:#52525b">Serviço:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.serviceType)}</td></tr>
                          <tr><td style="padding:7px 0;color:#52525b">Data:</td><td style="padding:7px 0;font-weight:600">${this.formatDate(appointment.date)}</td></tr>
                          <tr><td style="padding:7px 0;color:#52525b">Cidade:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.city)}</td></tr>
                          <tr><td style="padding:7px 0;color:#52525b">Endereço:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.fullAddress)}</td></tr>
                        </table>
                      </div>
                      ${reasonBlock}
                      <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#52525b">Mais informações e atualizações estarão disponíveis no aplicativo do técnico.</p>
                      <p style="margin:24px 0 0;font-size:14px;color:#52525b">Atenciosamente,<br><strong>Agenda Metalique</strong></p>
                    </td></tr>
                  </table>
                </td></tr>
              </table>
            </body>
          </html>`
      });
      await this.trackEmailUsage(`appointment-${options.event}`, recipients.length, 0, appointment.id);
      this.logger.log(`E-mail de ${options.event} do agendamento ${appointment.id} enviado para ${recipients.length} destinatário(s).`);
      return { sent: true, recipients: recipients.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.trackEmailUsage(`appointment-${options.event}`, 0, 1, appointment.id, message);
      this.logger.error(`Falha ao enviar ${options.event} do agendamento ${appointment.id}: ${message}`);
      return { sent: false, reason: 'send_failed' };
    }
  }

  private async resolveRecipients(technicianEmail?: string | null) {
    const configured = await this.resolveConfiguredRecipients();
    const recipients = [this.normalizeEmail(technicianEmail), ...configured].filter(Boolean) as string[];
    return Array.from(new Set(recipients));
  }

  private async resolveConfiguredRecipients() {
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
    return Array.from(new Set(configured));
  }

  private normalizeEmail(email?: string | null) {
    const value = email?.trim().toLowerCase() ?? '';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
  }

  private renderClientConfirmation(appointment: ConfirmedAppointmentEmail, technicianName: string) {
    return this.renderConfirmationShell({
      title: 'Visita tecnica confirmada',
      subtitle: 'Sua visita foi agendada pela Metalique',
      greeting: `Ola, ${this.escapeHtml(appointment.client.name)}.`,
      message: 'Confirmamos o agendamento da visita tecnica. Confira abaixo os dados principais do atendimento.',
      rows: `
        <tr><td style="padding:7px 0;color:#52525b;width:150px">Data:</td><td style="padding:7px 0;font-weight:600">${this.formatDate(appointment.date)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Servico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.serviceType)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Tecnico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(technicianName)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Cidade:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.city)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Endereco:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.fullAddress)}</td></tr>
      `,
      footer: 'Caso seja necessario alterar alguma informacao, entre em contato com a equipe Metalique.'
    });
  }

  private renderManagementConfirmation(appointment: ConfirmedAppointmentEmail, technicianName: string) {
    return this.renderConfirmationShell({
      title: 'Agendamento confirmado',
      subtitle: 'Resumo administrativo do atendimento',
      greeting: 'Ola, equipe.',
      message: 'Um novo atendimento foi confirmado. Estes dados sao destinados ao acompanhamento interno.',
      rows: `
        <tr><td style="padding:7px 0;color:#52525b;width:150px">Cliente:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.client.name)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Tecnico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(technicianName)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Servico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.serviceType)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Data:</td><td style="padding:7px 0;font-weight:600">${this.formatDate(appointment.date)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Dias em campo:</td><td style="padding:7px 0;font-weight:600">${appointment.daysOut}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Cidade:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.city)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Endereco:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.fullAddress)}</td></tr>
      `,
      footer: 'Acompanhe o andamento e eventuais pendencias diretamente no Agenda Metalique.'
    });
  }

  private renderVendorConfirmation(appointment: ConfirmedAppointmentEmail, technicianName: string) {
    const vendorName = appointment.vendorName?.trim() || 'vendedor';
    return this.renderConfirmationShell({
      title: 'Visita tecnica agendada',
      subtitle: 'Seu cliente ja esta com atendimento confirmado',
      greeting: `Ola, ${this.escapeHtml(vendorName)}.`,
      message: 'A visita tecnica do seu cliente foi agendada pela equipe Metalique. Seguem abaixo os principais dados para acompanhamento comercial.',
      rows: `
        <tr><td style="padding:7px 0;color:#52525b;width:150px">Cliente:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.client.name)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Data:</td><td style="padding:7px 0;font-weight:600">${this.formatDate(appointment.date)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Servico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.serviceType)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Tecnico:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(technicianName)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Cidade:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.city)}</td></tr>
        <tr><td style="padding:7px 0;color:#52525b">Endereco:</td><td style="padding:7px 0;font-weight:600">${this.escapeHtml(appointment.fullAddress)}</td></tr>
      `,
      footer: 'Este e-mail e apenas um aviso automatico. O acompanhamento operacional segue pelo Agenda Metalique.'
    });
  }

  private renderConfirmationShell(content: {
    title: string;
    subtitle: string;
    greeting: string;
    message: string;
    rows: string;
    footer: string;
  }) {
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden">
          <tr><td style="padding:24px 30px;background:#d3113a;color:#fff"><div style="font-size:24px;font-weight:700">${content.title}</div><div style="margin-top:6px;font-size:14px;color:#ffe4e9">${content.subtitle}</div></td></tr>
          <tr><td style="padding:30px"><p style="margin:0 0 8px;font-size:16px">${content.greeting}</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46">${content.message}</p>
            <div style="padding:20px;border-left:4px solid #d3113a;background:#f7f7f8;border-radius:8px"><div style="margin-bottom:12px;font-size:17px;font-weight:700;color:#d3113a">Dados do agendamento</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:14px">${content.rows}</table></div>
            <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#52525b">${content.footer}</p><p style="margin:24px 0 0;font-size:14px;color:#52525b">Atenciosamente,<br><strong>Agenda Metalique</strong></p>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`;
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

  private async trackEmailUsage(action: string, delivered: number, failed: number, appointmentId: string, errorMessage?: string) {
    if (delivered > 0) {
      await this.apiUsage.track({
        provider: 'smtp',
        service: 'email',
        action,
        status: 'SUCCESS',
        units: delivered,
        metadata: { appointmentId, delivered }
      });
    }
    if (failed > 0) {
      await this.apiUsage.track({
        provider: 'smtp',
        service: 'email',
        action,
        status: 'ERROR',
        units: failed,
        metadata: { appointmentId, failed },
        errorMessage
      });
    }
  }
}


