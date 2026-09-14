import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Adds `n` business days (Mon–Fri) to a date; snaps weekends forward. */
export function addBusinessDays(base: Date, n: number): Date {
  const d = new Date(base);
  // Snap the starting point to a weekday first.
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sets a random clock time within the client's send window (human-like). */
export function withSendTime(date: Date, startHour: number, endHour: number): Date {
  const d = new Date(date);
  const hi = Math.max(startHour + 1, endHour);
  d.setHours(randomInt(startHour, hi - 1), randomInt(0, 59), randomInt(0, 59), 0);
  return d;
}

/** One stage of a sequence as submitted (SequenceStepDto, or a stored change request). */
export interface SequenceStepInput {
  stageOrder: number;
  templateId?: string | null;
  templateIds?: (string | null)[] | null;
  monthOffset?: number | null;
}

/**
 * Replaces the steps for a scope (client default = cohortId null, or one
 * cohort), deriving the engine's day-gap from each stage's planned month.
 * Shared by the direct staff save and by approving a client's request.
 */
export async function persistSequenceSteps(
  prisma: PrismaService,
  scope: { clientId: string; cohortId: string | null },
  steps: SequenceStepInput[],
): Promise<void> {
  await prisma.sequenceStep.deleteMany({
    where: scope.cohortId
      ? { cohortId: scope.cohortId }
      : { clientId: scope.clientId, cohortId: null },
  });
  // Same month as previous → ~10-day in-month gap; each extra month → ~21 days.
  const sorted = [...steps].sort((a, b) => a.stageOrder - b.stageOrder);
  let prevMonth = 1;
  for (let i = 0; i < sorted.length; i++) {
    const step = sorted[i];
    const month =
      i === 0 ? 1 : Math.max(prevMonth, step.monthOffset ?? prevMonth);
    const waitDays =
      i === 0 ? 0 : month === prevMonth ? 10 : (month - prevMonth) * 21;
    // Per-mailbox variants: keep empties so a variant maps to its mailbox slot,
    // but drop trailing blanks. templateId mirrors the first for back-compat.
    const rawVariants = (step.templateIds ?? []).map((t) => (t ?? '').trim());
    while (rawVariants.length && !rawVariants[rawVariants.length - 1]) {
      rawVariants.pop();
    }
    const variants =
      rawVariants.length || !step.templateId ? rawVariants : [step.templateId];
    await prisma.sequenceStep.create({
      data: {
        clientId: scope.clientId,
        cohortId: scope.cohortId,
        stageOrder: step.stageOrder,
        templateId: variants.find((v) => v) ?? null,
        templateIds: variants,
        monthOffset: month,
        waitDays,
      },
    });
    prevMonth = month;
  }
}

/**
 * A cohort approved after its planned start would otherwise fire every day-slot
 * that has already passed at once. Re-lay its initial sends from `earliest`
 * with the same day-slot spacing; a start still in the future is left alone.
 */
export async function rebaseCohortStart(
  prisma: PrismaService,
  cohortId: string,
  earliest: Date,
): Promise<void> {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: {
      startDate: true,
      client: { select: { sendWindowStart: true, sendWindowEnd: true } },
    },
  });
  if (!cohort || cohort.startDate.getTime() >= earliest.getTime()) return;
  const rows = await prisma.enrollment.findMany({
    where: { cohortId, stage: 0, status: EnrollmentStatus.ACTIVE },
    select: { id: true, daySlot: true },
  });
  for (const r of rows) {
    await prisma.enrollment.update({
      where: { id: r.id },
      data: {
        nextTouchAt: withSendTime(
          addBusinessDays(earliest, r.daySlot - 1),
          cohort.client.sendWindowStart,
          cohort.client.sendWindowEnd,
        ),
      },
    });
  }
  await prisma.cohort.update({ where: { id: cohortId }, data: { startDate: earliest } });
}
