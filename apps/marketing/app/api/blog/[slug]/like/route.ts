import { NextResponse } from 'next/server';

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Same-origin proxy so the browser doesn't need the API's URL or CORS. */
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const res = await fetch(`${API_URL}/blog/public/${encodeURIComponent(params.slug)}/like`, {
      method: 'POST',
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ ok: false }, { status: res.status });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
