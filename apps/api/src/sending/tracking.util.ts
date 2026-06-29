/**
 * Rewrites an outbound HTML body for tracking:
 *  - rewrites every href through the click-redirect endpoint
 *  - appends a 1x1 open pixel
 *
 * No unsubscribe footer is injected — cold 1:1 outreach is meant to read like a
 * personal email. If a template author wants an unsubscribe link they can add
 * one (the /unsubscribe/:messageId endpoint still works for any link they place).
 */
export function instrumentHtml(
  html: string,
  publicBase: string,
  messageId: string,
): string {
  const base = publicBase.replace(/\/$/, '');

  // 1. Click tracking — wrap real links.
  let out = html.replace(
    /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
    (_m, url: string) =>
      `href="${base}/api/v1/t/click/${messageId}?u=${encodeURIComponent(url)}"`,
  );

  // 2. Open pixel — appended last.
  out += `<img src="${base}/api/v1/t/open/${messageId}.png" width="1" height="1" alt="" style="display:none" />`;

  return out;
}

/** Adds randomized jitter so sends don't fire on an exact cadence. */
export function withJitter(baseSeconds: number): number {
  const jitter = Math.floor(Math.random() * 20); // 0–20s
  return (baseSeconds + jitter) * 1000;
}
