import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(from, to);
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
}
