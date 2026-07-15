import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../sending/mailer.service';

export interface LeadInput {
  name: string;
  phone: string;
  email: string;
  message?: string;
  captchaToken: string;
  captchaAnswer: string;
}

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /** A tamper-proof arithmetic captcha: the answer is signed into the token. */
  async getCaptcha() {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const token = await this.jwt.signAsync(
      { sum: a + b, kind: 'captcha' },
      { secret: this.config.get('JWT_ACCESS_SECRET'), expiresIn: '10m' },
    );
    return { token, question: `${a} + ${b}` };
  }

  private async assertCaptcha(token: string, answer: string) {
    try {
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_ACCESS_SECRET') });
      if (payload.kind !== 'captcha' || Number(answer) !== payload.sum) {
        throw new Error('bad');
      }
    } catch {
      throw new BadRequestException('Incorrect captcha answer — please try again.');
    }
  }

  /** Sending mailbox for system mail on a tenant (report mailbox, else the first). */
  private async systemMailbox(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (tenant?.reportMailboxId) {
      const acct = await this.prisma.emailAccount.findUnique({ where: { id: tenant.reportMailboxId } });
      if (acct) return acct;
    }
    return this.prisma.emailAccount.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  /** A grapme.com "Book a demo" / "Get in touch" submission → email the sales inbox. */
  async lead(dto: LeadInput) {
    await this.assertCaptcha(dto.captchaToken, dto.captchaAnswer);
    const to = (this.config.get<string>('LEADS_NOTIFY_EMAIL') || 'harsh@grapmail.com').trim();
    const esc = (s: string) => (s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
    // Always log so leads survive even if SMTP isn't configured.
    this.logger.log(`Demo request: ${dto.name} <${dto.email}> ${dto.phone}`);

    const tenant = await this.prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    const account = tenant ? await this.systemMailbox(tenant.id) : null;
    if (!account) {
      this.logger.warn('No sending mailbox configured — demo request only logged, not emailed.');
      return { ok: true, emailed: false };
    }
    try {
      await this.mailer.send({
        account,
        to,
        subject: `New demo request — ${dto.name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
            <h2 style="color:#0f766e;margin:0 0 12px">New demo request</h2>
            <table style="font-size:14px;line-height:1.6;color:#111">
              <tr><td style="color:#666;padding-right:12px">Name</td><td><b>${esc(dto.name)}</b></td></tr>
              <tr><td style="color:#666;padding-right:12px">Phone</td><td>${esc(dto.phone)}</td></tr>
              <tr><td style="color:#666;padding-right:12px">Work email</td><td>${esc(dto.email)}</td></tr>
              ${dto.message ? `<tr><td style="color:#666;padding-right:12px;vertical-align:top">Message</td><td>${esc(dto.message)}</td></tr>` : ''}
            </table>
            <p style="color:#999;font-size:12px;margin-top:20px">Sent from grapme.com · ${new Date().toISOString()}</p>
          </div>`,
        headers: { 'Reply-To': dto.email },
      });
      return { ok: true, emailed: true };
    } catch (e) {
      this.logger.error(`Failed to email demo request: ${e instanceof Error ? e.message : e}`);
      return { ok: true, emailed: false };
    }
  }
}
