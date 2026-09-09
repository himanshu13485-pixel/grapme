/**
 * When staff-facing mail is allowed to go out.
 *
 * The team asked for their reminders in the 8–9am slot, Indian time. The API
 * container has no TZ set, so `new Date().getHours()` is UTC and cannot be
 * trusted for this — the offset is applied explicitly instead. India has no
 * DST, so a fixed +5:30 is exact all year.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** The hour staff reminders belong to, in IST. 8 = the 08:00–08:59 slot. */
export const STAFF_MAIL_IST_HOUR = 8;

/**
 * Spread within the slot. The hourly sweep lands at 08:30 IST, so a random
 * 0–25 minutes keeps every send inside 8–9 while making sure a batch never
 * leaves as one synchronised burst — which is what gets a sender filed as
 * automation.
 */
export const STAFF_MAIL_JITTER_MS = 25 * 60_000;

/** Wall-clock parts in India, whatever the server's own timezone is. */
export function istNow(now: Date = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    dayOfMonth: ist.getUTCDate(),
    weekday: ist.getUTCDay(),
  };
}

/** True inside the 08:00–08:59 IST slot that staff mail is sent in. */
export function inStaffMailHour(now: Date = new Date()): boolean {
  return istNow(now).hour === STAFF_MAIL_IST_HOUR;
}

/** A random delay inside the slot, for one recipient. */
export function staffMailJitterMs(): number {
  return Math.floor(Math.random() * STAFF_MAIL_JITTER_MS);
}
