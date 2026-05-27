import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  health() {
    return { ok: true, module: 'auth' };
  }
}
