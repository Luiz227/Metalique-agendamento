import { Controller, Get } from '@nestjs/common';
import { CalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get('health')
  health() {
    return this.service.health();
  }
}
