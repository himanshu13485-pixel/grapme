import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';

/**
 * A pass from one GrapOut app to the other, good for one minute and one use.
 *
 * GrapMe lives on grapme.com and GrapOut Trade on grapout.com. A browser will
 * not share a session across two registrable domains — not cookies, not
 * storage — so "signed in once, signed in to both" is a handover: the app you
 * are in signs a note saying who you are, the browser carries it across in the
 * URL, and the other app checks the signature before believing a word of it.
 *
 * The format matches the PHP side byte for byte, deliberately plain so neither
 * end needs a JWT library:
 *
 *     base64url(json) + "." + base64url(hmacSha256(secret, that first part))
 *
 * The signature covers the encoded payload exactly as sent, so the two
 * languages never have to agree on how JSON is spelled — only on the bytes on
 * the wire.
 *
 * Anything wrong with a pass yields null, never an exception. A stale or forged
 * pass is not a fault in this app; it is simply not a pass, and the person is
 * shown the ordinary sign-in page.
 */
@Injectable()
export class SsoTicketService implements OnModuleDestroy {
  /** Long enough for a redirect on a slow phone; too short to be worth stealing. */
  static readonly TTL_SECONDS = 60;

  private readonly logger = new Logger(SsoTicketService.name);
  private redis: Redis | null = null;
  /** Used passes, when there is no Redis to remember them in (local dev). */
  private readonly spentLocally = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  onModuleDestroy() {
    void this.redis?.quit().catch(() => undefined);
  }

  /** Whether a shared secret is set, and long enough to mean anything. */
  configured(): boolean {
    return this.secret().length >= 32;
  }

  /** A pass for this address, from GrapMe, addressed to GrapOut Trade. */
  mint(email: string): string {
    const body = this.b64(
      Buffer.from(
        JSON.stringify({
          iss: 'grapme',
          aud: 'grapout',
          email: email.trim().toLowerCase(),
          exp: Math.floor(Date.now() / 1000) + SsoTicketService.TTL_SECONDS,
          jti: randomBytes(16).toString('hex'),
        }),
      ),
    );
    return `${body}.${this.sign(body)}`;
  }

  /**
   * The address a genuine pass from Trade vouches for, or null.
   *
   * Cheapest checks first and the one-use check last, so a forged or expired
   * pass never spends a slot in the store.
   */
  async redeem(ticket: string): Promise<string | null> {
    if (!this.configured() || typeof ticket !== 'string') return null;
    const parts = ticket.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;

    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const email = claims.email;
    const jti = claims.jti;
    if (
      claims.iss !== 'grapout' ||
      claims.aud !== 'grapme' ||
      typeof claims.exp !== 'number' || claims.exp < now ||
      typeof jti !== 'string' || jti.length < 16 ||
      typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ) {
      return null;
    }

    if (!(await this.spendOnce(jti))) return null;
    return email.toLowerCase();
  }

  /**
   * Record a pass as used; true only the first time.
   *
   * SET NX in Redis is atomic, so of two requests racing with the same pass
   * exactly one wins. Without Redis (local development) a map does the same
   * job for a single process, which is all local development is.
   */
  private async spendOnce(jti: string): Promise<boolean> {
    const key = `sso:jti:${jti}`;
    const ttl = SsoTicketService.TTL_SECONDS * 2;

    const redis = this.client();
    if (redis) {
      try {
        return (await redis.set(key, '1', 'EX', ttl, 'NX')) === 'OK';
      } catch (e) {
        // Refusing is the safe failure: a pass that cannot be recorded as used
        // could be used again, so it is not honoured at all.
        this.logger.warn(`Could not record a sign-in pass as used: ${(e as Error).message}`);
        return false;
      }
    }

    const now = Date.now();
    for (const [k, until] of this.spentLocally) if (until < now) this.spentLocally.delete(k);
    if (this.spentLocally.has(key)) return false;
    this.spentLocally.set(key, now + ttl * 1000);
    return true;
  }

  private client(): Redis | null {
    if (this.redis) return this.redis;
    if (process.env.QUEUE_ENABLED === 'false') return null;
    const host = this.config.get<string>('REDIS_HOST');
    if (!host) return null;
    this.redis = new Redis({
      host,
      port: Number(this.config.get<string>('REDIS_PORT') ?? 6379),
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    // An idle connection dropping is not worth a crash; the next call reconnects.
    this.redis.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
    return this.redis;
  }

  private secret(): string {
    return this.config.get<string>('SSO_SHARED_SECRET') ?? '';
  }

  private sign(body: string): string {
    return this.b64(createHmac('sha256', this.secret()).update(body).digest());
  }

  private b64(buf: Buffer): string {
    return buf.toString('base64url');
  }
}
