import { Injectable } from '@nestjs/common';

@Injectable()
export class UploadsService {
  health() {
    return { ok: true, module: 'uploads' };
  }
}
