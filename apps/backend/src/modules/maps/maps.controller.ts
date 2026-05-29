import { Controller, Get, Query } from '@nestjs/common';
import { MapsService } from './maps.service';

@Controller('maps')
export class MapsController {
  constructor(private readonly service: MapsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get('geocode')
  geocode(@Query('q') q?: string) {
    return this.service.geocode(q ?? '');
  }

  @Get('travel-time')
  travelTime(@Query('origin') origin?: string, @Query('destination') destination?: string) {
    return this.service.travelTime(origin ?? '', destination ?? '');
  }
}
