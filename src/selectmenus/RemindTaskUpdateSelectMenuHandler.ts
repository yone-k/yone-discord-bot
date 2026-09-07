import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BaseSelectMenuHandler, SelectMenuHandlerContext } from '../base/BaseSelectMenuHandler';
import { Logger } from '../utils/logger';
import { quoteCsvCell } from '../utils/Csv';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { UiOperationEvents } from '../services/UiOperationEvents';
import { MetadataProvider } from '../services/MetadataProvider';
import { RemindTaskRepository } from '../services/RemindTaskRepository';
import { OutputApi } from '../api/OutputApi';
import { formatRemindBeforeInput } from '../utils/RemindDuration';
import { RemindTask } from '../models/RemindTask';
import { InventoryRepository } from '../services/InventoryRepository';
import { CoreApiError } from '../api/CoreClient';

export class RemindTaskUpdateSelectMenuHandler extends BaseSelectMenuHandler {
  private repository: RemindTaskRepository;
  private outputs: Pick<OutputApi, 'setCardView'>;
  private inventoryRepository: Pick<InventoryRepository, 'fetchAll'>;

  constructor(
    logger: Logger,
    operationLogService?: UiOperationEvents,
    metadataManager?: MetadataProvider,
    repository?: RemindTaskRepository,
    outputs?: Pick<OutputApi, 'setCardView'>,
    inventoryRepository: Pick<InventoryRepository, 'fetchAll'> = new InventoryRepository()
  ) {
    super('remind-task-update-select', logger, operationLogService, metadataManager);
    this.repository = repository || new RemindTaskRepository();
    this.outputs = outputs ?? new OutputApi();
    this.inventoryRepository = inventoryRepository;
    this.ephemeral = true;
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  public shouldHandle(context: SelectMenuHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId.startsWith('remind-task-update-select:');
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'update',
      actionName: 'リマインド更新'
    };
  }

  protected async executeAction(context: SelectMenuHandlerContext): Promise<OperationResult> {
    const { interaction } = context;
    const channelId = interaction.channelId;
    const messageId = this.parseMessageId(interaction.customId);
    const selection = interaction.values?.[0];
    const started = Date.now();
    let stageStarted = started;
    let stage = 'received';
    const log = (level: 'debug' | 'warn' | 'error', errorCode: string | number | null = null): void => {
      const now = Date.now();
      this.logger[level]('繰り返し更新フォームの処理時間', {
        interactionId: interaction.id ?? null, channelId, messageId, selection: selection ?? null,
        stage, stageElapsedMs: now - stageStarted, totalElapsedMs: now - started,
        replied: Boolean(interaction.replied), deferred: Boolean(interaction.deferred), errorCode
      });
      stageStarted = now;
    };
    const fail = async (message: string): Promise<OperationResult> => {
      log('warn');
      await interaction.reply({ content: `${message}。画面を開き直してください。`, flags: ['Ephemeral'] });
      return { success: false, message };
    };
    log('debug');
    try {
      if (!channelId || !messageId) return await fail('チャンネル情報が取得できません');
      if (!selection) return await fail('更新内容が選択されていません');
      if (!['basic', 'advanced', 'inventory'].includes(selection)) return await fail('更新内容が不正です');

      stage = 'task_fetch';
      const task = await this.repository.findTaskByMessageId(channelId, messageId);
      if (!task) return await fail('タスクが見つかりません');
      log('debug');
      stage = 'modal_prepare';
      const modal = selection === 'basic' ? this.buildBasicModal(task, messageId)
        : selection === 'advanced' ? this.buildAdvancedModal(task, messageId)
          : await this.buildInventoryModal(channelId, task, messageId);
      log('debug');
      stage = 'initial_response';
      await interaction.showModal(modal);
      log('debug');

      // 通常表示への復帰予約は、フォームの初回応答を完了してから行う。
      stage = 'output_reservation';
      try {
        await this.outputs.setCardView(channelId, 'task', task.id, { mode: 'normal' });
        log('debug');
      } catch (error) {
        log(error instanceof CoreApiError ? 'warn' : 'error', error instanceof CoreApiError ? error.code : null);
      }
      return { success: true, message: '更新モーダルを表示しました' };
    } catch (error) {
      log(error instanceof CoreApiError ? 'warn' : 'error', error instanceof CoreApiError ? error.code : null);
      throw error;
    }
  }

  private buildBasicModal(task: RemindTask, messageId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`remind-task-update-modal:${messageId}:${task.revision}`)
      .setTitle('リマインド更新');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('タスク名')
      .setStyle(TextInputStyle.Short)
      .setValue(task.title)
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('説明（任意）')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(task.description || '')
      .setRequired(false)
      .setMaxLength(500);

    const intervalInput = new TextInputBuilder()
      .setCustomId('interval-days')
      .setLabel('周期（日）')
      .setStyle(TextInputStyle.Short)
      .setValue(String(task.intervalDays))
      .setRequired(true)
      .setMaxLength(4);

    const timeInput = new TextInputBuilder()
      .setCustomId('time-of-day')
      .setLabel('期限時刻（時:分）')
      .setStyle(TextInputStyle.Short)
      .setValue(task.timeOfDay)
      .setRequired(true)
      .setMaxLength(5);

    const remindInput = new TextInputBuilder()
      .setCustomId('remind-before')
      .setLabel('事前通知（日:時:分 もしくは 時:分）')
      .setStyle(TextInputStyle.Short)
      .setValue(formatRemindBeforeInput(task.remindBeforeMinutes))
      .setRequired(false)
      .setMaxLength(8);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(intervalInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(remindInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    return modal;
  }

  private buildAdvancedModal(task: RemindTask, messageId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`remind-task-update-override-modal:${messageId}:${task.revision}`)
      .setTitle('詳細設定');

    const lastDoneValue = task.lastDoneAt ? this.formatTokyoDateTime(task.lastDoneAt) : '';
    const nextDueValue = this.formatTokyoDateTime(task.nextDueAt);

    const lastDoneInput = new TextInputBuilder()
      .setCustomId('last-done-at')
      .setLabel('前回完了日（YYYY/MM/DD もしくは YYYY/MM/DD HH:MM）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(16);

    if (lastDoneValue) {
      lastDoneInput.setValue(lastDoneValue);
    }

    const nextDueInput = new TextInputBuilder()
      .setCustomId('next-due-at')
      .setLabel('次回期限（YYYY/MM/DD もしくは YYYY/MM/DD HH:MM）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(16)
      .setValue(nextDueValue);

    const limitInput = new TextInputBuilder()
      .setCustomId('overdue-notify-limit')
      .setLabel('期限超過通知の上限回数（空欄で無制限）')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(5);

    if (task.overdueNotifyLimit !== undefined) {
      limitInput.setValue(String(task.overdueNotifyLimit));
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(lastDoneInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(nextDueInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(limitInput)
    );

    return modal;
  }

  private async buildInventoryModal(channelId: string, task: RemindTask, messageId: string): Promise<ModalBuilder> {
    const modal = new ModalBuilder()
      .setCustomId(`remind-task-inventory-modal:${messageId}:${task.revision}`)
      .setTitle('在庫設定');

    const inventoryInput = new TextInputBuilder()
      .setCustomId('inventory-items')
      .setLabel('在庫CSV（名前,在庫数,消費数。1行1件）')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000)
      .setPlaceholder('例: "牛乳,低脂肪",5,1.5')
      .setValue(await this.formatInventoryInputForModal(channelId, task));

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(inventoryInput)
    );

    return modal;
  }

  private async formatInventoryInputForModal(channelId: string, task: RemindTask): Promise<string> {
    const metadataResult = await this.metadataManager?.getChannelMetadata(channelId);
    const linkedInventoryChannelId = (metadataResult?.metadata as { linkedInventoryChannelId?: string } | undefined)
      ?.linkedInventoryChannelId;
    if (!linkedInventoryChannelId || task.inventoryItems.length === 0) {
      return '';
    }

    const inventory = await this.inventoryRepository.fetchAll(linkedInventoryChannelId);
    const byId = new Map(inventory.map(item => [item.id, item]));
    const lines = task.inventoryItems.map(item => {
      const inventoryItem = byId.get(item.inventoryId);
      const name = inventoryItem?.name ?? `[不明な在庫:${item.inventoryId.slice(0, 8)}]`;
      if (!inventoryItem) {
        return `${quoteCsvCell(name)},${item.consume}`;
      }
      return `${quoteCsvCell(name)},${inventoryItem.stock},${item.consume}`;
    });
    return lines.join('\n');
  }

  private parseMessageId(customId: string): string | null {
    const parts = customId.split(':');
    return parts.length === 2 ? parts[1] : null;
  }

  private formatTokyoDateTime(date: Date): string {
    const tokyoOffset = 9 * 60;
    const tokyoDate = new Date(date.getTime() + tokyoOffset * 60 * 1000);
    const year = tokyoDate.getUTCFullYear();
    const month = String(tokyoDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(tokyoDate.getUTCDate()).padStart(2, '0');
    const hours = String(tokyoDate.getUTCHours()).padStart(2, '0');
    const minutes = String(tokyoDate.getUTCMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
  }
}
