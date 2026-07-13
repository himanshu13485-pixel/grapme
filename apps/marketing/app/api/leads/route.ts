import { NextResponse } from 'next/server';

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

  // TODO: persist the lead — forward to the CRM / AEO contacts API / notification
  // email once that endpoint exists. Logging keeps this deployable in the meantime.
  console.log('Demo request captured:', { name, phone, email, submittedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
