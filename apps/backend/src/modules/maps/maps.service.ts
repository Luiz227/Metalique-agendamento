import { Injectable } from '@nestjs/common';

@Injectable()
export class MapsService {
  health() {
    return { ok: true, module: 'maps' };
  }
}
