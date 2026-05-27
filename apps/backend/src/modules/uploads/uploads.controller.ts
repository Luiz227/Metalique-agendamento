import { Controller, Get } from '@nestjs/common';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Get('health')
  health() {
    return this.service.health();
  }
}
