import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

type LoginBody = {
  email: string;
  password: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.service.login(body.email, body.password);
  }
}
