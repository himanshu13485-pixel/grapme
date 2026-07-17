const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * Same-origin image proxy for uploaded assets (blog covers, inline images).
 *
 * This is a route handler rather than a next.config rewrite on purpose: Next bakes
 * rewrite destinations into the build manifest, so a runtime API_URL (set per-deploy
 * in compose) would be ignored and the destination would stay frozen at build time.
 * Reading process.env here happens per request, so the internal API URL works.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${API_URL}/assets/${encodeURIComponent(params.id)}`, { cache: 'no-store' });
    if (!res.ok) return new Response('Not found', { status: res.status });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Upstream error', { status: 502 });
  }
}
