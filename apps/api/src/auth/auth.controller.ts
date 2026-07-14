import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  HttpCode,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService, SessionCtx } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  RefreshDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ClientRegisterDto,
  ClientVerifyDto,
  ChangePasswordDto,
  UpdateAccountDto,
} from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Best-effort client IP + user-agent, honouring a reverse proxy's forwarded header. */
  private sessionCtx(req: Request): SessionCtx {
    const xff = req.headers['x-forwarded-for'];
    const fwd = Array.isArray(xff) ? xff[0] : xff;
    const ip =
      fwd?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      undefined;
    const ua = req.headers['user-agent'] || undefined;
    return { ip: ip ?? undefined, userAgent: ua };
  }

  /** Public feature flags the login page needs (e.g. whether signup is open). */
  @Public()
  @Get('config')
  config() {
    return { allowAdminSignup: this.auth.adminSignupAllowed() };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, this.sessionCtx(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.sessionCtx(req));
  }

  @HttpCode(200)
  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.userId);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  // ─── Client self-registration (public) ──────────────────────────────
  @Public()
  @Get('captcha')
  captcha() {
    return this.auth.getCaptcha();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('client/register')
  clientRegister(@Body() dto: ClientRegisterDto) {
    return this.auth.registerClient(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('client/verify')
  clientVerify(@Body() dto: ClientVerifyDto) {
    return this.auth.verifyClientEmail(dto.token);
  }

  /** Client confirms an admin-initiated change to their portal login email. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('confirm-email-change')
  confirmEmailChange(@Body() dto: ClientVerifyDto) {
    return this.auth.confirmEmailChange(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.userId, dto);
  }

  @Patch('account')
  updateAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.auth.updateAccount(user.userId, dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
