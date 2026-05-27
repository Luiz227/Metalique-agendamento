import { Injectable } from '@nestjs/common';

@Injectable()
export class TechniciansService {
  health() {
    return { ok: true, module: 'technicians' };
  }
}
