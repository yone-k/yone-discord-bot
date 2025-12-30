import { EmbedBuilder } from 'discord.js';
import { RemindTask } from '../models/RemindTask';
import { shouldSendPreReminder } from '../utils/RemindNotification';
import { formatRemindBeforeDisplay } from '../utils/RemindDuration';

export class RemindTaskFormatter {
  private static readonly EMBED_COLOR = 0xFFA726;

  public static formatTaskEmbed(task: RemindTask, now: Date = new Date()): EmbedBuilder {
    const summary = this.formatSummaryText(task, now);
    const description = [summary.progressBar, summary.detailsText].filter(Boolean).join('\n');

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

  public static formatDetailText(task: RemindTask, now: Date = new Date()): string {
    const status = this.buildStatus(task, now);
    const nextDueText = this.formatTokyoDateTime(task.nextDueAt);

    return [
      status,
      `次回期限: ${nextDueText}`,
      `周期: ${task.intervalDays}日`,
      `時刻: ${task.timeOfDay}`,
      `事前通知: ${formatRemindBeforeDisplay(task.remindBeforeMinutes)}`
    ].filter(Boolean).join('\n');
  }

  public static formatSummaryText(
    task: RemindTask,
    now: Date = new Date()
  ): { progressBar: string; detailsText: string } {
    const progressBar = this.buildProgressBar(task, now);
    const nextDueText = this.formatTokyoDateTime(task.nextDueAt);
    const remainingDays = this.calculateRemainingDays(task, now);

    const detailsText = remainingDays !== null
      ? `-# 残り: ${remainingDays}日`
      : `-# 期限: ${nextDueText}`;

    return { progressBar, detailsText };
  }

  private static buildProgressBar(task: RemindTask, now: Date): string {
    const barLength = 40;
    const intervalStart = task.lastDoneAt ?? task.startAt;
    const total = task.nextDueAt.getTime() - intervalStart.getTime();
    const elapsed = now.getTime() - intervalStart.getTime();
    const ratio = total <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / total));
    const filled = Math.round(ratio * barLength);
    const empty = barLength - filled;
    return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  }

  private static calculateRemainingDays(task: RemindTask, now: Date): number | null {
    const remainingMillis = task.nextDueAt.getTime() - now.getTime();
    const remainingDays = Math.ceil(remainingMillis / (24 * 60 * 60 * 1000));
    if (remainingDays < 0 || remainingDays >= 30) {
      return null;
    }
    return remainingDays;
  }
}
