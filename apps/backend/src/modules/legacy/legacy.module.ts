import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { LegacyController } from './legacy.controller';
import { LegacyService } from './legacy.service';

@Module({
  imports: [PrismaModule],
  controllers: [LegacyController],
  providers: [LegacyService]
})
export class LegacyModule {}
