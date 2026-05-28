import { Controller, Get } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get()
  list() {
    return this.service.list();
  }
}
