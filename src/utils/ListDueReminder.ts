import { ListItem } from '../models/ListItem';

const TOKYO_OFFSET_MINUTES = 9 * 60;

type TokyoDateParts = { year: number; month: number; day: number };

function getTokyoDateParts(date: Date): TokyoDateParts {
  const tokyoDate = new Date(date.getTime() + TOKYO_OFFSET_MINUTES * 60 * 1000);
  return {
    year: tokyoDate.getUTCFullYear(),
    month: tokyoDate.getUTCMonth() + 1,
    day: tokyoDate.getUTCDate()
  };
}

function isSameTokyoDate(a: Date, b: Date): boolean {
  const aParts = getTokyoDateParts(a);
  const bParts = getTokyoDateParts(b);
  return aParts.year === bParts.year && aParts.month === bParts.month && aParts.day === bParts.day;
}

export function formatTokyoDate(date: Date): string {
  const { year, month, day } = getTokyoDateParts(date);
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${year}/${paddedMonth}/${paddedDay}`;
}

export function shouldSendListDueReminder(item: ListItem, now: Date): boolean {
  if (item.check) {
    return false;
  }

  if (!item.until) {
    return false;
  }

  if (!isSameTokyoDate(item.until, now)) {
    return false;
  }

  if (item.lastNotifiedAt && isSameTokyoDate(item.lastNotifiedAt, now)) {
    return false;
  }

  return true;
}
