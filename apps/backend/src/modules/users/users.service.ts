import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  health() {
    return { ok: true, module: 'users' };
  }
}
