import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import type { InventoryItem } from '../models/InventoryItem';
import type { OperationInfo, OperationResult } from '../models/types/OperationLog';
import type { MetadataProvider } from '../services/MetadataProvider';
import type { OperationLogService } from '../services/OperationLogService';
import { InventoryRepository } from '../services/InventoryRepository';
import { Logger } from '../utils/logger';

interface InventoryRepositoryPort {
  fetchAll(channelId: string): Promise<InventoryItem[]>;
}

export class InventoryDeleteButtonHandler extends BaseButtonHandler {
  private static readonly pageSize = 25;
  private readonly repository: InventoryRepositoryPort;

  constructor(
    logger: Logger,
    repository: InventoryRepositoryPort = new InventoryRepository(),
    operationLogService?: OperationLogService,
    metadataManager?: MetadataProvider
  ) {
    super('inventory_delete', logger, operationLogService, metadataManager);
    this.repository = repository;
    this.ephemeral = true;
  }

  public shouldHandle(context: ButtonHandlerContext): boolean {
    if (context.interaction.user.bot) {
      return false;
    }

    return context.interaction.customId === this.customId
      || context.interaction.customId.startsWith(`${this.customId}?page=`);
  }

  protected shouldSkipLogging(): boolean {
    return true;
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    const channelId = context.interaction.channelId;
    const items = await this.repository.fetchAll(channelId);

    if (items.length === 0) {
      await context.interaction.reply({
        content: '在庫アイテムがありません。',
        flags: ['Ephemeral']
      });
      return { success: false, message: '在庫アイテムがありません' };
    }

    const page = this.parsePage(context.interaction.customId);
    await context.interaction.reply(this.buildReply(items, page));
    return { success: true, message: '在庫削除セレクトメニューを表示しました' };
  }

  protected getOperationInfo(_context: ButtonHandlerContext): OperationInfo {
    return {
      operationType: 'delete',
      actionName: '在庫アイテム削除'
    };
  }

  private parsePage(customId: string): number {
    const page = new URLSearchParams(customId.split('?')[1] ?? '').get('page');
    const parsed = Number(page ?? 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  private buildReply(items: InventoryItem[], page: number): Record<string, unknown> {
    const totalPages = Math.ceil(items.length / InventoryDeleteButtonHandler.pageSize);
    const currentPage = Math.min(page, Math.max(totalPages - 1, 0));
    const pageItems = items.slice(
      currentPage * InventoryDeleteButtonHandler.pageSize,
      (currentPage + 1) * InventoryDeleteButtonHandler.pageSize
    );

    const components: unknown[] = [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `inventory_delete_select_${currentPage}`,
            placeholder: '削除する在庫を選択してください',
            min_values: 1,
            max_values: 1,
            options: pageItems.map(item => ({
              label: item.name,
              value: item.id,
              description: `${item.category || 'その他'} / 在庫: ${item.stock}`
            }))
          }
        ]
      }
    ];

    if (totalPages > 1) {
      components.push({
        type: 1,
        components: [
          ...(currentPage > 0
            ? [{
              type: 2,
              custom_id: `inventory_delete?page=${currentPage - 1}`,
              label: '前へ',
              style: 2
            }]
            : []),
          ...(currentPage < totalPages - 1
            ? [{
              type: 2,
              custom_id: `inventory_delete?page=${currentPage + 1}`,
              label: '次へ',
              style: 2
            }]
            : [])
        ]
      });
    }

    return {
      content: '削除する在庫を選択してください。',
      components,
      flags: ['Ephemeral']
    };
  }
}
