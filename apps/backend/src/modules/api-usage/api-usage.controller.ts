import { Controller, Get, Query } from '@nestjs/common';
import { ApiUsageService } from './api-usage.service';

@Controller('api-usage')
export class ApiUsageController {
  constructor(private readonly apiUsage: ApiUsageService) {}

  @Get()
  summary(@Query('days') days?: string) {
    return this.apiUsage.summary(Number(days) || 30);
  }
}
