import { NextResponse } from 'next/server';

const API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidPhone(v: string) {
  const digits = v.replace(/[^\d]/g, '');
  return /^[+\d][\d\s\-()]{6,}$/.test(v.trim()) && digits.length >= 7 && digits.length <= 15;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';

  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!isValidPhone(phone)) errors.phone = 'Please enter a valid contact number.';
  if (!isValidEmail(email)) errors.email = 'Please enter a valid email address.';

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  // Forward to the app API, which emails the lead to the configured sales inbox
  // (LEADS_NOTIFY_EMAIL). Done server-side over the internal network.
  try {
    await fetch(`${API_URL}/marketing/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone, email }),
      cache: 'no-store',
    });
  } catch (e) {
    // Don't fail the visitor's submission if the API is briefly unreachable.
    console.error('Lead forward failed:', e);
  }
  console.log('Demo request captured:', { name, phone, email, submittedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
