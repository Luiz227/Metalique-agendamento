import { Injectable } from '@nestjs/common';

@Injectable()
export class CalendarService {
  health() {
    return { ok: true, module: 'calendar' };
  }
}
