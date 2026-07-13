import { Global, Module } from '@nestjs/common';
import { ApiUsageController } from './api-usage.controller';
import { ApiUsageService } from './api-usage.service';

@Global()
@Module({
  controllers: [ApiUsageController],
  providers: [ApiUsageService],
  exports: [ApiUsageService]
})
export class ApiUsageModule {}
