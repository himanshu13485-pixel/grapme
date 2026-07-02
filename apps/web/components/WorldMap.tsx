'use client';

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
export interface GeoData {
  located: number;
  unlocated: number;
  countries: CountryStat[];
  ips: IpStat[];
}

const CONTINENTS: { label: string; lat: number; lng: number }[] = [
  { label: 'N. America', lat: 45, lng: -100 },
  { label: 'S. America', lat: -15, lng: -60 },
  { label: 'Europe', lat: 52, lng: 12 },
  { label: 'Africa', lat: 3, lng: 20 },
  { label: 'Asia', lat: 46, lng: 90 },
  { label: 'Oceania', lat: -25, lng: 134 },
];

/** Lightweight equirectangular bubble map of where opens/clicks came from. */
export function WorldMap({ geo, title = 'Geographic engagement' }: { geo: GeoData; title?: string }) {
  const W = 720;
  const H = 360;
  const project = (lat: number, lng: number): [number, number] => [
    ((lng + 180) / 360) * W,
    ((90 - lat) / 180) * H,
  ];
  const max = Math.max(1, ...geo.countries.map((c) => c.opens + c.clicks));
  const radius = (n: number) => 4 + Math.sqrt(n / max) * 20;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">🌍 {title}</h3>
        <span className="text-xs text-slate-400">
          {geo.located} located · {geo.unlocated} unknown
        </span>
      </div>

      {geo.located === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
          No geolocated opens/clicks yet. Location is captured from the tracking
          pixel — it only registers once <code>APP_PUBLIC_URL</code> is a public
          address recipients can reach (not localhost).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Map */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full rounded-lg bg-slate-50"
            style={{ aspectRatio: '2 / 1' }}
          >
            {/* graticule */}
            {Array.from({ length: 11 }, (_, i) => (i - 5) * 30).map((lng) => {
              const [x] = project(0, lng);
              return <line key={`v${lng}`} x1={x} y1={0} x2={x} y2={H} stroke="#e2e8f0" strokeWidth={1} />;
            })}
            {Array.from({ length: 5 }, (_, i) => (i - 2) * 30).map((lat) => {
              const [, y] = project(lat, 0);
              return <line key={`h${lat}`} x1={0} y1={y} x2={W} y2={y} stroke="#e2e8f0" strokeWidth={1} />;
            })}
            {/* continent labels for orientation */}
            {CONTINENTS.map((c) => {
              const [x, y] = project(c.lat, c.lng);
              return (
                <text key={c.label} x={x} y={y} textAnchor="middle" className="fill-slate-300" fontSize={11}>
                  {c.label}
                </text>
              );
            })}
            {/* bubbles */}
            {geo.countries.map((c) => {
              const [x, y] = project(c.lat, c.lng);
              const n = c.opens + c.clicks;
              return (
                <g key={c.code}>
                  <circle cx={x} cy={y} r={radius(n)} fill="#4f46e5" fillOpacity={0.35} stroke="#4f46e5" strokeWidth={1}>
                    <title>{`${c.name}: ${c.opens} opens, ${c.clicks} clicks`}</title>
                  </circle>
                  <circle cx={x} cy={y} r={2} fill="#4f46e5" />
                </g>
              );
            })}
          </svg>

          {/* Country table */}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Country</th>
                  <th className="px-3 py-2 text-right">Opens</th>
                  <th className="px-3 py-2 text-right">Clicks</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {geo.countries.map((c) => (
                  <tr key={c.code} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-700">{c.name}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{c.opens}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{c.clicks}</td>
                    <td className="px-3 py-2 text-right font-semibold text-brand-700">{c.opens + c.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {geo.ips.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            Top {geo.ips.length} IP addresses
          </summary>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Opens</th>
                  <th className="px-3 py-2 text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {geo.ips.map((r) => (
                  <tr key={r.ip} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-slate-700">{r.ip}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {[r.city, r.country].filter(Boolean).join(', ')}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.opens}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
