import { EmbedBuilder } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
import { shouldSendPreReminder } from '../utils/RemindNotification';

export class RemindTaskFormatter {
  private static readonly EMBED_COLOR = 0xFFA726;

  public static formatTaskEmbed(task: RemindTask, now: Date = new Date()): EmbedBuilder {
    const status = this.buildStatus(task, now);
    const nextDueText = this.formatTokyoDateTime(task.nextDueAt);

    const description = [
      status,
      `次回期限: ${nextDueText}`,
      `周期: ${task.intervalDays}日`,
      `時刻: ${task.timeOfDay}`,
      `事前通知: ${task.remindBeforeMinutes}分前`
    ].filter(Boolean).join('\n');

    return new EmbedBuilder()
      .setTitle(task.title)
      .setDescription(description)
      .setColor(this.EMBED_COLOR)
      .setTimestamp();
  }

  private static buildStatus(task: RemindTask, now: Date): string {
    if (now.getTime() > task.nextDueAt.getTime()) {
      return '❗期限超過';
    }

    if (shouldSendPreReminder(task, now)) {
      return '⌛ 期限が近づいています';
    }

    return '✅ 期限まで余裕があります';
  }

  private static formatTokyoDateTime(date: Date): string {
    const tokyoOffset = 9 * 60;
    const tokyoDate = new Date(date.getTime() + tokyoOffset * 60 * 1000);
    const year = tokyoDate.getUTCFullYear();
    const month = tokyoDate.getUTCMonth() + 1;
    const day = tokyoDate.getUTCDate();
    const hours = String(tokyoDate.getUTCHours()).padStart(2, '0');
    const minutes = String(tokyoDate.getUTCMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  }
}
