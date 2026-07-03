import { Injectable } from '@nestjs/common';
import { promises as dns, setServers } from 'dns';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeliverabilityService {
  // Short-lived cache so repeated page loads don't re-run DNS for every domain.
  private authCache = new Map<
    string,
    { at: number; value: Awaited<ReturnType<DeliverabilityService['emailAuth']>> }
  >();
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(private prisma: PrismaService) {
    // Node's default c-ares resolver can't reach the system DNS in some
    // environments (lookups fail with ECONNREFUSED → every record shows as
    // missing). Pin public resolvers so SPF/DKIM/DMARC/MX checks actually work.
    const servers = (process.env.DNS_SERVERS ?? '8.8.8.8,1.1.1.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (servers.length) setServers(servers);
    } catch {
      /* keep system defaults if this fails */
    }
  }

  /**
   * Checks the three records that govern cold-email deliverability for a domain:
   * SPF (TXT), DMARC (_dmarc TXT), and DKIM (best-effort, common selectors).
   */
  async emailAuth(domain: string) {
    const clean = domain.trim().toLowerCase();
    const [spf, dmarc, dkim] = await Promise.all([
      this.lookupSpf(clean),
      this.lookupDmarc(clean),
      this.lookupDkim(clean),
    ]);

    const present = [spf.found, dmarc.found, dkim.found].filter(Boolean).length;
    return {
      domain: clean,
      score: Math.round((present / 3) * 100),
      spf,
      dmarc,
      dkim,
      advice:
        present === 3
          ? 'All core authentication records found. Good foundation for deliverability.'
          : 'Missing records hurt deliverability and increase spam-folder placement.',
    };
  }

  /** Cached domain-auth lookup (shared by the per-mailbox badges). */
  private async emailAuthCached(domain: string) {
    const key = domain.trim().toLowerCase();
    const hit = this.authCache.get(key);
    if (hit && Date.now() - hit.at < this.CACHE_TTL_MS) return hit.value;
    const value = await this.emailAuth(key);
    this.authCache.set(key, { at: Date.now(), value });
    return value;
  }

  /**
   * SPF/DKIM/DMARC status for every configured mailbox domain in a tenant, so
   * the Mailboxes page can flag misconfigured senders at a glance.
   */
  async mailboxAuth(tenantId: string) {
    const accounts = await this.prisma.emailAccount.findMany({
      where: { tenantId },
      select: { emailAddress: true },
    });
    const domains = [
      ...new Set(
        accounts
          .map((a) => a.emailAddress.split('@')[1]?.toLowerCase())
          .filter((d): d is string => !!d),
      ),
    ];
    const results = await Promise.all(
      domains.map(async (domain) => {
        const r = await this.emailAuthCached(domain);
        return {
          domain,
          score: r.score,
          spf: r.spf.found,
          dkim: r.dkim.found,
          dmarc: r.dmarc.found,
        };
      }),
    );
    // Keyed by domain for easy lookup from a mailbox's address.
    return Object.fromEntries(results.map((r) => [r.domain, r]));
  }

  /** Syntax + MX validation — does the domain actually accept mail? */
  async validateEmail(email: string) {
    const syntaxOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!syntaxOk) {
      return { email, valid: false, syntaxOk: false, mxFound: false, reason: 'Invalid syntax' };
    }
    const domain = email.split('@')[1];
    try {
      const mx = await dns.resolveMx(domain);
      const mxFound = mx.length > 0;
      return {
        email,
        valid: mxFound,
        syntaxOk: true,
        mxFound,
        mxHosts: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange),
        reason: mxFound ? 'Deliverable domain' : 'No MX records',
      };
    } catch {
      return { email, valid: false, syntaxOk: true, mxFound: false, reason: 'Domain has no MX / does not resolve' };
    }
  }

  private async lookupSpf(domain: string) {
    try {
      const records = await dns.resolveTxt(domain);
      const flat = records.map((r) => r.join(''));
      const spf = flat.find((r) => r.toLowerCase().startsWith('v=spf1'));
      return { found: Boolean(spf), record: spf ?? null };
    } catch {
      return { found: false, record: null };
    }
  }

  private async lookupDmarc(domain: string) {
    try {
      const records = await dns.resolveTxt(`_dmarc.${domain}`);
      const flat = records.map((r) => r.join(''));
      const dmarc = flat.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
      return { found: Boolean(dmarc), record: dmarc ?? null };
    } catch {
      return { found: false, record: null };
    }
  }

  /** DKIM is selector-specific; probe the most common selectors. */
  private async lookupDkim(domain: string) {
    // Common provider selectors. NOTE: AWS SES "Easy DKIM" uses random tokens
    // (e.g. <token>._domainkey) that can't be guessed — those won't be detected.
    const selectors = [
      'default', 'google', 'selector1', 'selector2', 'k1', 'k2',
      's1', 's2', 'mail', 'dkim', 'smtp', 'zmail', 'zoho', 'mxvault',
    ];
    for (const selector of selectors) {
      try {
        const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
        const flat = records.map((r) => r.join(''));
        if (flat.some((r) => r.toLowerCase().includes('v=dkim1') || r.includes('p='))) {
          return { found: true, selector, record: flat[0] };
        }
      } catch {
        /* try next selector */
      }
    }
    return { found: false, selector: null, record: null };
  }
}
