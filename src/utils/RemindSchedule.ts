export function normalizeTimeOfDay(timeOfDay: string): string {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(timeOfDay);
  if (!match) {
    throw new Error(`Invalid timeOfDay: ${timeOfDay}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid timeOfDay: ${timeOfDay}`);
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
