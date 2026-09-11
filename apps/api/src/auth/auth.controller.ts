import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  HttpCode,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
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

  /** Admin: re-send the confirmation email to an unverified client login. */
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @HttpCode(200)
  @Post('client/:userId/resend-verification')
  resendClientVerification(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.auth.resendClientVerification(user, userId);
  }

  /**
   * Admin "Log in as" — returns a real session for another login (client,
   * salesperson or sub-admin) so the admin can view the app exactly as that
   * person does. The browser swaps to it; "Back to Admin" restores the admin's
   * own session. The service decides who may impersonate whom.
   */
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @HttpCode(200)
  @Post('users/:userId/impersonate')
  impersonate(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.auth.impersonate(user, userId, this.sessionCtx(req));
  }

  /** Legacy route kept so a browser running an older bundle keeps working. */
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @HttpCode(200)
  @Post('client/:userId/impersonate')
  impersonateClient(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.auth.impersonate(user, userId, this.sessionCtx(req));
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
