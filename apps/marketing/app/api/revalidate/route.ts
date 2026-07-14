import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * On-demand revalidation for the live pricing page. The app's API calls this
 * after a plan is created / updated / deleted so grapme.com/pricing refreshes
 * immediately instead of waiting for the ISR window.
 *
 * Guarded by REVALIDATE_SECRET when set (prod). If unset (local dev), it's open.
 */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (secret) {
    const provided =
      req.headers.get('x-revalidate-secret') ??
      new URL(req.url).searchParams.get('secret');
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }
  const body = (await req.json().catch(() => ({}))) as { tag?: string };
  const tags = body.tag ? [body.tag] : ['public-plans', 'public-posts'];
  tags.forEach((t) => revalidateTag(t));
  return NextResponse.json({ ok: true, revalidated: tags, at: Date.now() });
}
