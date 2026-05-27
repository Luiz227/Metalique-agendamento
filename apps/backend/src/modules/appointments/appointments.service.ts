import { Injectable } from '@nestjs/common';

@Injectable()
export class AppointmentsService {
  health() {
    return { ok: true, module: 'appointments' };
  }
}
