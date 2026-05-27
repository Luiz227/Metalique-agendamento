import { Controller, Get } from '@nestjs/common';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(private readonly service: ClientsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }
}
