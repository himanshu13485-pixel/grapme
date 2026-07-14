import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
  iat?: number; // issued-at (seconds) — set by the signer, used for force-logout
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Reject tokens for deleted users, suspended accounts, or any token issued
    // before a force-logout cutoff (admin "log out of all sessions").
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, sessionsRevokedAt: true },
    });
    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Account is not active');
    }
    if (
      user.sessionsRevokedAt &&
      payload.iat &&
      payload.iat * 1000 < user.sessionsRevokedAt.getTime()
    ) {
      throw new UnauthorizedException('Session was ended — please sign in again');
    }
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
    };
  }
}
