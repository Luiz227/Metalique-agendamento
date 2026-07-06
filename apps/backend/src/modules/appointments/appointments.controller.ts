import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly service: AppointmentsService,
    private readonly jwt: JwtService
  ) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(from, to);
  }

  @Delete()
  async deleteAll(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { confirmation?: string }
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Sessao nao identificada');
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(authorization.slice(7));
      if (!payload.sub) throw new UnauthorizedException('Sessao invalida');
      return this.service.deleteAll(payload.sub, body?.confirmation);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Sessao invalida ou expirada');
    }
  }

  @Delete('system-data')
  async resetSystemData(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { confirmation?: string }
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Sessao nao identificada');
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(authorization.slice(7));
      if (!payload.sub) throw new UnauthorizedException('Sessao invalida');
      return this.service.resetSystemData(payload.sub, body?.confirmation);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Sessao invalida ou expirada');
    }
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.update(id, body);
  }

  @Put(':id/checklist')
  checklist(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.patchChecklist(id, body);
  }

  @Post(':id/checklist')
  checklistPost(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.patchChecklist(id, body);
  }

  @Post(':id/remind-missing')
  remind(@Param('id') id: string) {
    return this.service.remindMissing(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.cancel(id, body?.reason);
  }

  @Post(':id/reschedule')
  reschedule(@Param('id') id: string, @Body() body: { date: string; startTime: string; endTime: string }) {
    return this.service.reschedule(id, body.date, body.startTime, body.endTime);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.service.confirm(id);
  }

  @Post(':id/confirmation-email')
  resendConfirmationEmail(@Param('id') id: string) {
    return this.service.sendConfirmationEmail(id);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string) {
    return this.service.reopen(id);
  }
}
