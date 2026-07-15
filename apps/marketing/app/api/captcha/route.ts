import { NextResponse } from 'next/server';

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Same-origin proxy for the demo-form captcha challenge. */
export async function GET() {
  try {
    const res = await fetch(`${API_URL}/marketing/captcha`, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
