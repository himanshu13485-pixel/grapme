import { Injectable } from '@nestjs/common';
import geoip from 'geoip-lite';

export interface GeoEvent {
  ip?: string | null;
  eventType: 'OPEN' | 'CLICK';
}

export interface CountryStat {
  code: string;
  name: string;
  lat: number;
  lng: number;
  opens: number;
  clicks: number;
}
export interface IpStat {
  ip: string;
  country: string;
  city?: string;
  opens: number;
  clicks: number;
}
export interface GeoResult {
  located: number; // events we could geolocate
  unlocated: number; // events with no/unresolvable IP
  countries: CountryStat[];
  ips: IpStat[];
}

// Common ISO-3166 alpha-2 → country name. Falls back to the code for others.
const COUNTRY: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', IN: 'India', CA: 'Canada',
  AU: 'Australia', DE: 'Germany', FR: 'France', IT: 'Italy', ES: 'Spain',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IE: 'Ireland',
  PT: 'Portugal', PL: 'Poland', CZ: 'Czechia', RO: 'Romania', GR: 'Greece',
  HU: 'Hungary', RU: 'Russia', UA: 'Ukraine', TR: 'Turkey', IL: 'Israel',
  AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait',
  BH: 'Bahrain', OM: 'Oman', EG: 'Egypt', ZA: 'South Africa', NG: 'Nigeria',
  KE: 'Kenya', GH: 'Ghana', MA: 'Morocco', TN: 'Tunisia', ET: 'Ethiopia',
  CN: 'China', JP: 'Japan', KR: 'South Korea', SG: 'Singapore',
  MY: 'Malaysia', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam',
  PH: 'Philippines', BD: 'Bangladesh', PK: 'Pakistan', LK: 'Sri Lanka',
  NP: 'Nepal', HK: 'Hong Kong', TW: 'Taiwan', BR: 'Brazil', MX: 'Mexico',
  AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru', VE: 'Venezuela',
  NZ: 'New Zealand',
};

/** Resolves tracking-event IPs to country/coords and aggregates them. */
@Injectable()
export class GeoService {
  private clean(ip?: string | null): string | undefined {
    if (!ip) return undefined;
    const s = ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
    // Private/loopback ranges can't be geolocated.
    if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(s)) return undefined;
    return s;
  }

  aggregate(events: GeoEvent[]): GeoResult {
    const byCountry = new Map<string, CountryStat>();
    const byIp = new Map<string, IpStat>();
    let located = 0;
    let unlocated = 0;

    for (const e of events) {
      const ip = this.clean(e.ip);
      if (!ip) {
        unlocated++;
        continue;
      }
      const geo = geoip.lookup(ip);
      if (!geo) {
        unlocated++;
        continue;
      }
      located++;
      const code = geo.country || 'ZZ';
      const name = COUNTRY[code] ?? code;
      const c =
        byCountry.get(code) ??
        { code, name, lat: geo.ll?.[0] ?? 0, lng: geo.ll?.[1] ?? 0, opens: 0, clicks: 0 };
      const ir =
        byIp.get(ip) ?? { ip, country: name, city: geo.city || undefined, opens: 0, clicks: 0 };
      if (e.eventType === 'OPEN') {
        c.opens++;
        ir.opens++;
      } else {
        c.clicks++;
        ir.clicks++;
      }
      byCountry.set(code, c);
      byIp.set(ip, ir);
    }

    const rank = (a: { opens: number; clicks: number }, b: { opens: number; clicks: number }) =>
      b.opens + b.clicks - (a.opens + a.clicks);
    return {
      located,
      unlocated,
      countries: [...byCountry.values()].sort(rank),
      ips: [...byIp.values()].sort(rank).slice(0, 50),
    };
  }
}
