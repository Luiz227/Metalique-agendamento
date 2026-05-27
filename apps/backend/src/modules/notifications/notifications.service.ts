import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  health() {
    return { ok: true, module: 'notifications' };
  }
}
