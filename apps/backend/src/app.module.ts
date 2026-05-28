import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ClientsModule } from './modules/clients/clients.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MapsModule } from './modules/maps/maps.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { LegacyModule } from './modules/legacy/legacy.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { QueueModule } from './infra/queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    TechniciansModule,
    AppointmentsModule,
    DashboardModule,
    NotificationsModule,
    MapsModule,
    UploadsModule,
    CalendarModule,
    LegacyModule
  ]
})
export class AppModule {}
