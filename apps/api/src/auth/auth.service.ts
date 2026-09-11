import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ApprovalEntity, ApprovalStatus, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import {
  LoginDto,
  RegisterDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ClientRegisterDto,
} from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

/** Request context captured with a session (for the admin Live Clients view). */
export type SessionCtx = { ip?: string; userAgent?: string };

/** A session with no refresh within this many minutes is considered idle/offline. */
export const SESSION_IDLE_MINUTES = 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mailer: MailerService,
    private approvals: ApprovalsService,
    private activity: ActivityService,
  ) {}

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async signTokens(payload: JwtPayload) {
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TTL', '7d'),
    });
    return { accessToken, refreshToken };
  }

  private async persistRefreshToken(
    userId: string,
    token: string,
    ctx?: SessionCtx,
  ) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.sha256(token),
        expiresAt,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      },
    });
  }

  /** Whether public "create a new admin workspace" signup is allowed.
   *  Off by default (admins are preset / seeded); set ALLOW_ADMIN_SIGNUP=true to
   *  re-enable the "Create workspace" flow. */
  adminSignupAllowed(): boolean {
    return this.config.get<string>('ALLOW_ADMIN_SIGNUP') === 'true';
  }

  /**
   * On boot, ensure the preset super-admin exists (from ADMIN_EMAIL /
   * ADMIN_PASSWORD). Runs once — it never resets the password on later boots, so
   * a password you change in-app survives restarts. No-op if the env is unset.
   */
  async ensureBootstrapAdmin(): Promise<void> {
    const email = this.config.get<string>('ADMIN_EMAIL')?.trim().toLowerCase();
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return; // already provisioned — leave its password alone

    let tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!tenant) {
      tenant = await this.prisma.tenant.create({ data: { name: 'GRAPOUT' } });
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Admin',
        email,
        passwordHash,
        role: Role.SUPER_ADMIN,
        emailVerified: true,
        status: 'ACTIVE',
      },
    });
    this.logger.log(`Bootstrapped super-admin ${email}`);
  }

  /** First user of a new tenant becomes SUPER_ADMIN. */
  async register(dto: RegisterDto) {
    if (!this.adminSignupAllowed()) {
      throw new ForbiddenException('Public registration is disabled.');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.tenantName ?? `${dto.name}'s workspace` },
      });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          name: dto.name,
          email: dto.email,
          passwordHash,
          role: Role.SUPER_ADMIN,
        },
      });
    });

    return this.issueSession(user);
  }

  async login(dto: LoginDto, ctx?: SessionCtx) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // Self-registered clients must confirm their email before first sign-in.
    if (user.role === Role.CLIENT && !user.emailVerified) {
      throw new UnauthorizedException(
        'Please confirm your email first — check your inbox for the confirmation link.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(user, ctx);
  }

  private async issueSession(
    user: {
    id: string;
    tenantId: string;
    role: Role;
    email: string;
    name: string;
    fullAccess?: boolean;
    accessModules?: unknown;
    canDelete?: boolean;
    canEdit?: boolean;
    },
    ctx?: SessionCtx,
  ) {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
    };
    const tokens = await this.signTokens(payload);
    await this.persistRefreshToken(user.id, tokens.refreshToken, ctx);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        fullAccess: user.fullAccess ?? false,
        accessModules: user.accessModules ?? [],
        canDelete: user.canDelete ?? false,
        canEdit: user.canEdit ?? true,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string, ctx?: SessionCtx) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash: this.sha256(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!stored) throw new UnauthorizedException('Refresh token revoked');

    // Idle timeout: the app refreshes every ~15 min while a tab is open, so a
    // token older than the idle window means the session went quiet (tab closed).
    // Reject and revoke so the user must sign in again.
    const idleMs = SESSION_IDLE_MINUTES * 60 * 1000;
    if (Date.now() - stored.createdAt.getTime() > idleMs) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Session timed out — please sign in again');
    }

    // Rotate: revoke the old token, issue a fresh pair. Carry the original
    // login IP / user-agent forward so a session keeps its identity.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const newPayload: JwtPayload = {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
    };
    const tokens = await this.signTokens(newPayload);
    await this.persistRefreshToken(payload.sub, tokens.refreshToken, {
      ip: ctx?.ip ?? stored.ip ?? undefined,
      userAgent: ctx?.userAgent ?? stored.userAgent ?? undefined,
    });
    return tokens;
  }

  /**
   * Force-logout every active session for a user (admin "log this client out").
   * Revokes all their refresh tokens, so within one access-token lifetime
   * (≤15 min) they can no longer refresh and are signed out everywhere.
   * Returns the number of sessions revoked.
   */
  async revokeAllSessions(userId: string): Promise<number> {
    const now = new Date();
    const [res] = await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      // Invalidate any access token already in the client's hands: the JWT strategy
      // rejects tokens issued (iat) before this cutoff, so logout is immediate.
      this.prisma.user.update({
        where: { id: userId },
        data: { sessionsRevokedAt: now },
      }),
    ]);
    return res.count;
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Always returns success to avoid email enumeration. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (user) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: this.sha256(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await this.sendPasswordResetEmail(
        user.tenantId,
        user.email,
        user.name,
        token,
      );
    }
    return { success: true };
  }

  private async sendPasswordResetEmail(
    tenantId: string,
    email: string,
    name: string,
    token: string,
  ) {
    const link = `${this.webUrl()}/reset?token=${token}`;
    // Dev fallback: the link is always logged so reset works without SMTP.
    this.logger.log(`[password-reset] reset link for ${email}: ${link}`);
    try {
      const account = await this.systemMailbox(tenantId);
      if (!account) return;
      await this.mailer.send({
        account,
        to: email,
        subject: 'Reset your GrapMe password',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#0f766e">Password reset</h2>
            <p>Hi${name ? ` ${name}` : ''}, we received a request to reset your
            GrapMe password. Click below to choose a new one.</p>
            <p style="margin:24px 0">
              <a href="${link}"
                 style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
                Reset my password
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">
              Or paste this link into your browser:<br>${link}
            </p>
            <p style="color:#94a3b8;font-size:12px">
              This link expires in 1 hour. If you didn't request it, ignore this email.
            </p>
          </div>`,
      });
    } catch (err) {
      this.logger.warn(`Password-reset email to ${email} failed: ${err}`);
    }
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordReset.findFirst({
      where: {
        tokenHash: this.sha256(dto.token),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!record) throw new UnauthorizedException('Invalid or expired token');

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  // ─── Client self-registration (public) ────────────────────────────────────

  /** A tamper-proof arithmetic captcha: the answer is signed into the token. */
  async getCaptcha() {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const token = await this.jwt.signAsync(
      { sum: a + b, kind: 'captcha' },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: '10m',
      },
    );
    return { token, question: `${a} + ${b}` };
  }

  private async assertCaptcha(token: string, answer: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sum: number; kind: string }>(
        token,
        { secret: this.config.get('JWT_ACCESS_SECRET') },
      );
      if (payload.kind !== 'captcha' || Number(answer) !== payload.sum) {
        throw new Error('mismatch');
      }
    } catch {
      throw new BadRequestException('Captcha answer is incorrect. Please try again.');
    }
  }

  private webUrl(): string {
    return (
      this.config.get<string>('WEB_PUBLIC_URL') ||
      this.config.get<string>('CORS_ORIGIN') ||
      'http://localhost:3000'
    );
  }

  /** The mailbox used to send system/admin mail for a tenant, if any. */
  private async systemMailbox(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({
        where: { id: tenant.reportMailboxId },
      });
      if (acct) return acct;
    }
    return this.prisma.emailAccount.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async sendVerificationEmail(
    tenantId: string,
    email: string,
    name: string,
    token: string,
  ) {
    const link = `${this.webUrl()}/verify?token=${token}`;
    // Dev fallback: the link is always logged so registration works without SMTP.
    this.logger.log(`[client-verify] confirmation link for ${email}: ${link}`);
    try {
      const account = await this.systemMailbox(tenantId);
      if (!account) return;
      await this.mailer.send({
        account,
        to: email,
        subject: 'Confirm your GrapMe client account',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#0f766e">Welcome to GrapMe${name ? `, ${name}` : ''}!</h2>
            <p>Please confirm your email address to activate your client account.</p>
            <p style="margin:24px 0">
              <a href="${link}"
                 style="background:#0f766e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
                Confirm my email
              </a>
            </p>
            <p style="color:#64748b;font-size:13px">
              Or paste this link into your browser:<br>${link}
            </p>
            <p style="color:#94a3b8;font-size:12px">This link expires in 24 hours.</p>
          </div>`,
      });
    } catch (err) {
      // Never fail registration because the mailbox is misconfigured; the link
      // is already logged for manual delivery.
      this.logger.warn(`Verification email to ${email} failed: ${err}`);
    }
  }

  /** Public sign-up: creates a CLIENT login (unverified) in the agency tenant. */
  async registerClient(dto: ClientRegisterDto) {
    await this.assertCaptcha(dto.captchaToken, dto.captchaAnswer);
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    // Self-registered clients join the agency workspace (the oldest tenant).
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!tenant) {
      throw new BadRequestException('Client registration is not open yet.');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });
    const token = randomBytes(32).toString('hex');
    const created = await this.prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: dto.contactName,
        email,
        passwordHash,
        role: Role.CLIENT,
        companyName: dto.companyName,
        contactMobile: dto.mobile ?? null,
        emailVerified: false,
        verifyTokenHash: this.sha256(token),
        verifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    // Fallback path: if the client can't confirm via email for any reason, the
    // pending signup also lands in the admin approval queue. Approving there
    // activates the login directly.
    await this.approvals.submit({
      tenantId: tenant.id,
      submittedById: created.id,
      entityType: ApprovalEntity.CLIENT_ACTIVATION,
      entityId: created.id,
    });
    await this.sendVerificationEmail(tenant.id, email, dto.contactName, token);
    return { success: true, email };
  }

  /**
   * Admin: re-send the confirmation email to an unverified client login (from
   * Registered Clients, when the original never arrived). Issues a fresh 24h token.
   */
  /**
   * "Log in as": issue a real session for another login so an admin can see the
   * app exactly as that person does — a client's portal, a salesperson's panel
   * or a sub-admin's scoped admin view. Same tenant only, and always recorded
   * in the activity log.
   *
   * Who may impersonate whom:
   *   SUPER_ADMIN -> CLIENT, SALES, SUB_ADMIN
   *   SUB_ADMIN   -> CLIENT only
   * A SUPER_ADMIN is never a target, and nobody impersonates themselves — so
   * the feature can't be used to climb to more access than the actor has.
   *
   * The browser swaps to the returned session; the web app stashes the admin's
   * own tokens so the banner's "Back to Admin" restores them in one click.
   */
  async impersonate(admin: AuthUser, userId: string, ctx?: SessionCtx) {
    if (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
    if (userId === admin.userId) {
      throw new BadRequestException('You are already signed in as yourself.');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: admin.tenantId },
    });
    if (!target) throw new NotFoundException('Login not found');

    const allowed: Role[] =
      admin.role === Role.SUPER_ADMIN
        ? [Role.CLIENT, Role.SALES, Role.SUB_ADMIN]
        : [Role.CLIENT];
    if (!allowed.includes(target.role)) {
      throw new ForbiddenException(
        admin.role === Role.SUB_ADMIN
          ? 'Sub-admins can only log in as a client.'
          : 'This account cannot be viewed with "Log in as".',
      );
    }
    if (target.status === 'SUSPENDED') {
      throw new BadRequestException('This login is suspended.');
    }

    await this.activity.log({
      tenantId: admin.tenantId,
      actorId: admin.userId,
      action: 'IMPERSONATE_USER',
      entityType: 'User',
      entityId: target.id,
      after: { email: target.email, role: target.role },
    });
    this.logger.warn(
      `${admin.email} logged in as ${target.role} ${target.email}`,
    );
    return this.issueSession(target, ctx);
  }

  async resendClientVerification(admin: AuthUser, userId: string) {
    if (admin.role !== Role.SUPER_ADMIN && admin.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: admin.tenantId, role: Role.CLIENT },
      select: { id: true, email: true, name: true, emailVerified: true },
    });
    if (!user) throw new NotFoundException('Client login not found');
    if (user.emailVerified) {
      throw new BadRequestException('This client is already verified.');
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verifyTokenHash: this.sha256(token),
        verifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await this.sendVerificationEmail(admin.tenantId, user.email, user.name, token);
    return { ok: true, email: user.email };
  }

  /** Confirms the email from the link and signs the client in immediately. */
  async verifyClientEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        verifyTokenHash: this.sha256(token),
        verifyExpires: { gt: new Date() },
      },
    });
    if (!user) {
      throw new UnauthorizedException(
        'This confirmation link is invalid or has expired.',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verifyTokenHash: null,
        verifyExpires: null,
        lastLoginAt: new Date(),
      },
    });
    // Close the fallback approval so it no longer shows as pending for admins.
    await this.prisma.approval.updateMany({
      where: {
        entityType: ApprovalEntity.CLIENT_ACTIVATION,
        entityId: user.id,
        status: ApprovalStatus.PENDING,
      },
      data: { status: ApprovalStatus.APPROVED, decidedAt: new Date() },
    });
    return this.issueSession(updated);
  }

  /**
   * Client confirms an admin-initiated login-email change via the emailed link:
   * apply the pending email, clear the pending state, and close the fallback approval.
   */
  async confirmEmailChange(token: string) {
    const user = await this.prisma.user.findFirst({
      where: { pendingEmailTokenHash: this.sha256(token), pendingEmailExpires: { gt: new Date() } },
    });
    if (!user || !user.pendingEmail) {
      throw new UnauthorizedException('This confirmation link is invalid or has expired.');
    }
    const taken = await this.prisma.user.findFirst({ where: { email: user.pendingEmail, id: { not: user.id } } });
    if (taken) throw new BadRequestException('That email is now in use by another account.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: user.pendingEmail,
        emailVerified: true,
        pendingEmail: null,
        pendingEmailTokenHash: null,
        pendingEmailExpires: null,
      },
    });
    await this.prisma.approval.updateMany({
      where: { entityType: ApprovalEntity.CLIENT_LOGIN_EMAIL, entityId: user.id, status: ApprovalStatus.PENDING },
      data: { status: ApprovalStatus.APPROVED, decidedAt: new Date() },
    });
    return { ok: true, email: user.pendingEmail };
  }

  /** Self-service password change (no approval). Verifies the current one. */
  async changePassword(
    userId: string,
    dto: { currentPassword: string; newPassword: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!ok) throw new BadRequestException('Current password is incorrect.');
    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    // Sign out other sessions for safety.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /** Self-service update of the signed-in user's own name / email. */
  async updateAccount(userId: string, dto: { name?: string; email?: string }) {
    const email = dto.email?.toLowerCase();
    if (email) {
      const clash = await this.prisma.user.findFirst({
        where: { email, id: { not: userId } },
      });
      if (clash) throw new BadRequestException('That email is already in use.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(email ? { email } : {}),
      },
    });
    return this.me(userId);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tenantId: true,
        timezone: true,
        avatarUrl: true,
        lastLoginAt: true,
        fullAccess: true,
        accessModules: true,
        canDelete: true,
        canEdit: true,
        profileLimit: true,
        companyName: true,
        contactMobile: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
