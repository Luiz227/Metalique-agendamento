import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  health() {
    return { ok: true, module: 'auth' };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const payload = { sub: user.id, email: user.email, name: user.name, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.jwt.signAsync(payload, {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d'
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken }
    });

    return {
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword
      }
    };
  }

  async changePassword(authorization: string | undefined, newPassword: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Sessao invalida');
    }
    const password = String(newPassword ?? '');
    if (password.length < 8) {
      throw new BadRequestException('A nova senha deve ter pelo menos 8 caracteres.');
    }

    let payload: { sub?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string }>(authorization.slice(7));
    } catch {
      throw new UnauthorizedException('Sessao expirada. Entre novamente.');
    }
    if (!payload.sub) throw new UnauthorizedException('Usuario nao identificado');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException('Usuario inativo ou nao encontrado');
    if (await bcrypt.compare(password, user.passwordHash)) {
      throw new BadRequestException('A nova senha deve ser diferente da senha provisoria.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: false
      }
    });

    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: false
      }
    };
  }
}
