import { ContainerBuilder, TextDisplayBuilder } from 'discord.js';

export interface NurseryMenuView {
  date: string;
  lunch: string | null;
  snack: string | null;
  lunchIngredients: string | null;
  snackIngredients: string | null;
}

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** Tokyo calendar date (YYYY-MM-DD) of `now`, shifted by whole days. */
export function tokyoDate(now: Date, offsetDays = 0): string {
  return new Date(now.getTime() + TOKYO_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatNurseryMenuDate(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${day.getUTCMonth() + 1}/${day.getUTCDate()}(${WEEKDAYS[day.getUTCDay()]})`;
}

/** Same layout as the Core API morning post, without the @everyone mention. */
export function buildNurseryMenuContainer(menu: NurseryMenuView): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🍱 ${formatNurseryMenuDate(menu.date)} の献立`)
  );
  const sections = [['昼食', menu.lunch, menu.lunchIngredients], ['おやつ', menu.snack, menu.snackIngredients]] as const;
  for (const [label, text, ingredients] of sections) {
    if (text) {
      const dish = `### ${label}\n**🍽️ 献立**\n${text}`;
      const content = ingredients ? `${dish}\n**🥕 材料**\n${ingredients}` : dish;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
  }
  return container;
}
