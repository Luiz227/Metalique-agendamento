import { Injectable } from '@nestjs/common';

@Injectable()
export class DashboardService {
  health() {
    return { ok: true, module: 'dashboard' };
  }
}
