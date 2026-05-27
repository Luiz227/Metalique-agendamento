import { Controller, Get } from '@nestjs/common';
import { MapsService } from './maps.service';

@Controller('maps')
export class MapsController {
  constructor(private readonly service: MapsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }
}
