import { Injectable } from '@nestjs/common';

@Injectable()
export class ClientsService {
  health() {
    return { ok: true, module: 'clients' };
  }
}
