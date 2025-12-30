const MAX_REMIND_BEFORE_MINUTES = 10080;
const MINUTES_PER_DAY = 24 * 60;

const INVALID_FORMAT_MESSAGE = '事前通知は日:時:分または時:分形式で指定してください';
const OUT_OF_RANGE_MESSAGE = '事前通知は0日00時間00分〜7日00時間00分の範囲で指定してください';

export function parseRemindBeforeInput(input: string): number {
  const normalized = input.trim();
  if (normalized === '') {
    throw new Error(INVALID_FORMAT_MESSAGE);
  }

  const parts = normalized.split(':');
  if (parts.length !== 2 && parts.length !== 3) {
    throw new Error(INVALID_FORMAT_MESSAGE);
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(INVALID_FORMAT_MESSAGE);
  }

  let days = 0;
  let hours = 0;
  let minutes = 0;

  if (numbers.length === 2) {
    [hours, minutes] = numbers;
  } else {
    [days, hours, minutes] = numbers;
    if (hours >= 24) {
      throw new Error(INVALID_FORMAT_MESSAGE);
    }
  }

  if (minutes >= 60) {
    throw new Error(INVALID_FORMAT_MESSAGE);
  }

  const totalMinutes = (days * 24 + hours) * 60 + minutes;
  if (totalMinutes < 0 || totalMinutes > MAX_REMIND_BEFORE_MINUTES) {
    throw new Error(OUT_OF_RANGE_MESSAGE);
  }

  return totalMinutes;
}

export function formatRemindBeforeDisplay(totalMinutes: number): string {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  if (days > 0) {
    return `${pad2(days)}日${pad2(hours)}時間${pad2(minutes)}分前`;
  }
  if (hours > 0) {
    return `${pad2(hours)}時間${pad2(minutes)}分前`;
  }
  return `${pad2(minutes)}分前`;
}

export function formatRemindBeforeInput(totalMinutes: number): string {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  if (days > 0) {
    return `${days}:${pad2(hours)}:${pad2(minutes)}`;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function formatRemainingDuration(totalMinutes: number): string {
  const { days, hours, minutes } = splitMinutes(totalMinutes);
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}日`);
  }
  if (hours > 0) {
    parts.push(`${hours}時間`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}分`);
  }

  return parts.join('');
}

function splitMinutes(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const safeMinutes = Math.max(0, totalMinutes);
  const days = Math.floor(safeMinutes / MINUTES_PER_DAY);
  const remainder = safeMinutes % MINUTES_PER_DAY;
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;
  return { days, hours, minutes };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
