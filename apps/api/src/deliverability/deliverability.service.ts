import { Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';

@Injectable()
export class DeliverabilityService {
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
    const selectors = ['default', 'google', 'selector1', 'k1', 'mail'];
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
