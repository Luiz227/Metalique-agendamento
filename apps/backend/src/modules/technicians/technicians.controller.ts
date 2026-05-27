import { Controller, Get } from '@nestjs/common';
import { TechniciansService } from './technicians.service';

@Controller('technicians')
export class TechniciansController {
  constructor(private readonly service: TechniciansService) {}

  @Get('health')
  health() {
    return this.service.health();
  }
}
