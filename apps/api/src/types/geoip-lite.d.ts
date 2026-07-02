declare module 'geoip-lite' {
  export interface GeoIpLookup {
    range: [number, number];
    country: string;
    region: string;
    eu: string;
    timezone: string;
    city: string;
    ll: [number, number];
    metro: number;
    area: number;
  }
  export function lookup(ip: string): GeoIpLookup | null;
  export function pretty(ip: string): string;
  const _default: { lookup: typeof lookup; pretty: typeof pretty };
  export default _default;
}
