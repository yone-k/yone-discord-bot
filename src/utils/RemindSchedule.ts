const TOKYO_OFFSET_MINUTES = 9 * 60;

export interface NextDueAtInput {
  intervalDays: number;
  timeOfDay: string;
  startAt: Date;
  lastDoneAt?: Date | null;
}

export function calculateStartAt(createdAt: Date, timeOfDay: string): Date {
  const { year, month, day } = getTokyoDateParts(createdAt);
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  return buildTokyoDateTime(year, month, day, hours, minutes);
}

export function calculateNextDueAt(input: NextDueAtInput, now: Date): Date {
  if (input.intervalDays < 1) {
    throw new Error('intervalDays must be >= 1');
  }

  const base = input.lastDoneAt ?? input.startAt;
  const { year, month, day } = getTokyoDateParts(base);
  const { hours, minutes } = parseTimeOfDay(input.timeOfDay);

  let nextDueAt = buildTokyoDateTime(
    year,
    month,
    day + input.intervalDays,
    hours,
    minutes
  );

  while (nextDueAt.getTime() <= now.getTime()) {
    const parts = getTokyoDateParts(nextDueAt);
    nextDueAt = buildTokyoDateTime(
      parts.year,
      parts.month,
      parts.day + input.intervalDays,
      hours,
      minutes
    );
  }

  return nextDueAt;
}

function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!match) {
    throw new Error(`Invalid timeOfDay: ${timeOfDay}`);
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2])
  };
}

function getTokyoDateParts(date: Date): { year: number; month: number; day: number } {
  const tokyoDate = new Date(date.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  return {
    year: tokyoDate.getUTCFullYear(),
    month: tokyoDate.getUTCMonth() + 1,
    day: tokyoDate.getUTCDate()
  };
}

function buildTokyoDateTime(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hours, minutes);
  return new Date(utcMillis - TOKYO_OFFSET_MINUTES * 60 * 1000);
}
