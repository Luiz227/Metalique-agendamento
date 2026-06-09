import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { interval, map } from 'rxjs';
import { Request, Response } from 'express';
import { LegacyService } from './legacy.service';

@Controller()
export class LegacyController {
  constructor(private readonly service: LegacyService) {}

  @Get('resources/vehicles')
  vehicles() {
    return this.service.resourcesVehicles();
  }

  @Post('resources/vehicles')
  createVehicle(@Body() body: { name?: string; year?: number | string | null; plate?: string; mileage?: number | string | null }) {
    return this.service.createVehicle(body);
  }

  @Put('resources/vehicles/:id')
  updateVehicle(
    @Param('id') id: string,
    @Body() body: { name?: string; year?: number | string | null; plate?: string; mileage?: number | string | null; active?: boolean }
  ) {
    return this.service.updateVehicle(id, body);
  }

  @Post('resources/vehicles/:id/toggle')
  toggleVehicle(@Param('id') id: string) {
    return this.service.toggleVehicle(id);
  }

  @Get('resources/hotels')
  hotels() {
    return this.service.resourcesHotels();
  }

  @Get('finance/expenses')
  expenses() {
    return this.service.financeExpenses();
  }

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings')
  putSettings(@Body() body: Record<string, unknown>) {
    return this.service.putSettings(body);
  }

  @Get('settings/sla')
  getSla() {
    return this.service.getSla();
  }

  @Put('settings/sla')
  putSla(@Body() body: Record<string, unknown>) {
    return this.service.putSla(body);
  }

  @Get('suggestions')
  suggestions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.listSuggestions({ from, to });
  }

  @Patch('suggestions/:id')
  patchSuggestion(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.service.updateSuggestion(id, body);
  }

  @Get('validations')
  validations() {
    return this.service.listValidations();
  }

  @Post('validations')
  createValidation(@Body() body: Record<string, unknown>) {
    return this.service.createValidation(body);
  }

  @Get('reports')
  reportsSummary() {
    return this.service.reportsSummary();
  }

  @Get('reports/technical')
  reportsTechnical() {
    return this.service.reportsTechnical();
  }

  @Get('technician/appointments')
  technicianAppointments(@Headers('authorization') authorization?: string) {
    return this.service.technicianAppointments(this.extractAuthIdentity(authorization ?? null));
  }

  @Post('technician/appointments/:id/status')
  technicianStatus(@Param('id') id: string, @Body() body: { status?: string; observation?: string }) {
    return this.service.technicianSetStatus(id, String(body?.status ?? 'TRAVELING'), body?.observation);
  }

  @Post('technician/appointments/:id/reports')
  technicianReport(
    @Param('id') id: string,
    @Body()
    body: {
      summary?: string;
      diagnosis?: string;
      solution?: string;
      pendingItems?: string;
      finishedAt?: string;
      clientSignatureDataUrl?: string;
      technicianSignatureDataUrl?: string;
    }
  ) {
    return this.service.technicianReport(id, body);
  }

  @Post('attachments/appointments/:id')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage()
    })
  )
  attachment(
    @Param('id') id: string,
    @Req() req: Request,
    @UploadedFile() file: { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer } | undefined,
    @Body('type') type?: string
  ) {
    return this.service.attachFile(id, file, type, this.buildBaseUrl(req));
  }

  @Get('attachments/files/:attachmentId')
  async attachmentFile(@Param('attachmentId') attachmentId: string, @Res() res: Response) {
    const file = await this.service.getAttachmentFile(attachmentId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.send(file.buffer);
  }

  @Delete('attachments/:attachmentId')
  deleteAttachment(@Param('attachmentId') attachmentId: string) {
    return this.service.deleteAttachment(attachmentId);
  }

  @Sse('events/stream')
  stream(@Req() _req: Request, @Query('token') _token?: string) {
    return interval(10000).pipe(
      map(() => ({
        type: 'appointments_changed',
        data: { ts: Date.now() }
      }))
    );
  }

  private extractAuthIdentity(authorization: string | null): { userId: string | null; email: string | null; name: string | null } | null {
    if (!authorization?.startsWith('Bearer ')) return null;
    const token = authorization.replace('Bearer ', '');
    const parts = token.split('.');
    if (parts.length < 2) return { userId: null, email: null, name: null };
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string; email?: string; name?: string };
      return {
        userId: payload.sub ?? null,
        email: payload.email?.toLowerCase?.() ?? null,
        name: payload.name ?? null
      };
    } catch {
      return { userId: null, email: null, name: null };
    }
  }

  private buildBaseUrl(req: Request) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || req.protocol || 'http';
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host') || 'localhost:3333';
    return `${protocol}://${host}`;
  }
}
