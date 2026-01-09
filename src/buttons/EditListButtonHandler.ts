import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { ListItem } from '../models/ListItem';
import { normalizeCategory, DEFAULT_CATEGORY } from '../models/CategoryType';
import { OperationInfo, OperationResult } from '../models/types/OperationLog';
import { OperationLogService } from '../services/OperationLogService';
import { MetadataManager } from '../services/MetadataManager';

export class EditListButtonHandler extends BaseButtonHandler {
  private googleSheetsService: GoogleSheetsService;

  constructor(
    logger: Logger, 
    operationLogService?: OperationLogService,
    metadataManager?: MetadataManager,
    googleSheetsService?: GoogleSheetsService
  ) {
    super('edit-list-button', logger, operationLogService, metadataManager);
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
  }

  protected getOperationInfo(): OperationInfo {
    return {
      operationType: 'edit',
      actionName: 'アイテム編集'
    };
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<OperationResult> {
    try {
      const channelId = context.interaction.channelId;
      if (!channelId) {
        return {
          success: false,
          message: 'チャンネルIDが取得できません',
          error: new Error('チャンネルIDが取得できません')
        };
      }

      // 現在のリストデータを取得
      const sheetData = await this.googleSheetsService.getSheetData(channelId);
      const listItems = this.convertToListItems(sheetData);

      // metadataからdefaultCategoryを取得
      let defaultCategory;
      try {
        if (this.metadataManager) {
          const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
          if (metadataResult.success && metadataResult.metadata?.defaultCategory) {
            defaultCategory = metadataResult.metadata.defaultCategory;
          }
        }
      } catch (error) {
        this.logger.warn('Failed to get metadata for defaultCategory', {
          channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // CSV風テキストに変換
      const csvText = this.convertToCsvText(listItems, defaultCategory);

      // モーダルを作成
      const modal = new ModalBuilder()
        .setCustomId('edit-list-modal')
        .setTitle('リスト編集');

      const textInput = new TextInputBuilder()
        .setCustomId('list-data')
        .setLabel('リスト内容（名前,カテゴリ,期限,完了 の形式）')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(csvText)
        .setPlaceholder('例: 牛乳,食品,2024-12-31,1\nパン,食品,,\nシャンプー,日用品,2024-06-30,\n※完了列：1=完了、空文字=未完了')
        .setMaxLength(4000)
        .setRequired(false);

      const firstActionRow = new ActionRowBuilder<TextInputBuilder>()
        .addComponents(textInput);

      modal.addComponents(firstActionRow);

      // モーダルを表示
      await context.interaction.showModal(modal);

      return {
        success: true,
        message: '編集モーダルを表示しました',
        affectedItems: listItems.length,
        details: {
          items: listItems.map(item => ({
            name: item.name,
            quantity: 1,
            category: item.category || 'その他',
            until: item.until || undefined
          })),
          changes: {
            before: { completionStatus: 'mixed' },
            after: { completionStatus: 'updated' }
          }
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error && error.message.includes('Google Sheets') ? 'データ取得に失敗しました' : 'モーダルの表示に失敗しました';
      return {
        success: false,
        message: errorMessage,
        error: error instanceof Error ? error : new Error('未知のエラー')
      };
    }
  }

  private convertToListItems(data: string[][]): ListItem[] {
    const items: ListItem[] = [];
    const seenNames = new Set<string>();
    
    // ヘッダー行をスキップ（存在する場合）
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;
    
    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 1 && row[0]) {
        try {
          const name = row[0].trim();
          
          if (seenNames.has(name)) {
            this.logger.warn('Duplicate name found, skipping', { rowIndex: i, name });
            continue;
          }
          
          // カテゴリの処理：空の場合は空文字列のまま保持
          const category = row.length > 1 && row[1] && row[1].trim() !== '' ? normalizeCategory(row[1]) : '';
          const until = row.length > 2 && row[2] ? this.parseDate(row[2]) : null;
          const check = row.length > 3 && row[3] && row[3].trim() === '1' ? true : false;
          const lastNotifiedAt = row.length > 4 && row[4] ? this.parseDate(row[4]) : null;

          const item: ListItem = {
            name,
            category,
            until,
            check,
            lastNotifiedAt
          };

          items.push(item);
          seenNames.add(name);
        } catch (error) {
          this.logger.warn('Failed to parse row, skipping', { 
            rowIndex: i, 
            row,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    return items;
  }

  private isHeaderRow(row: string[]): boolean {
    const headers = ['name', 'category', 'until', 'check', 'last_notified_at', '名前', 'カテゴリ', '完了'];
    return row.some(cell => 
      headers.some(header => 
        cell && cell.toLowerCase().includes(header.toLowerCase())
      )
    );
  }

  private parseDate(dateStr: string): Date | null {
    try {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  private convertToCsvText(items: ListItem[], defaultCategory?: string): string {
    if (items.length === 0) {
      return '名前,カテゴリ,期限,完了\n例: 牛乳,食品,2024-12-31,';
    }

    // ListFormatterと同じ順序でソート
    const sortedItems = this.sortItemsByCategory(items, defaultCategory);

    return sortedItems.map(item => {
      const name = item.name;
      // 空のカテゴリの場合はdefaultCategoryを使用
      const category = item.category || defaultCategory || '';
      const until = item.until ? this.formatDateForCsv(item.until) : '';
      const check = item.check ? '1' : '';
      return `${name},${category},${until},${check}`;
    }).join('\n');
  }

  /**
   * ListFormatterと同じ順序でアイテムをソート
   * 1. カテゴリ別にグループ化
   * 2. カテゴリを日本語辞書順でソート（DEFAULT_CATEGORYは最後）
   * 3. 同一カテゴリ内では元の順序を保持
   */
  private sortItemsByCategory(items: ListItem[], defaultCategory?: string): ListItem[] {
    // カテゴリ別にグループ化
    const grouped: Record<string, ListItem[]> = {};
    
    items.forEach(item => {
      const category = item.category || defaultCategory || DEFAULT_CATEGORY;
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(item);
    });
    
    // カテゴリをListFormatterと同じ順序でソート
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
      if (a === DEFAULT_CATEGORY) return 1;  // デフォルトカテゴリを最後
      if (b === DEFAULT_CATEGORY) return -1; // デフォルトカテゴリを最後
      return a.localeCompare(b, 'ja');       // 日本語ソート
    });
    
    // ソート済みカテゴリ順でアイテムを並べ直す
    const sortedItems: ListItem[] = [];
    sortedCategories.forEach(category => {
      sortedItems.push(...grouped[category]);
    });
    
    return sortedItems;
  }

  private formatDateForCsv(date: Date): string {
    // タイムゾーンの影響を受けないよう、ローカルの年月日を直接使用
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
