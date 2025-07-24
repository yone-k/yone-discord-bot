import { Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { MessageManager } from '../services/MessageManager';
import { MetadataManager } from '../services/MetadataManager';
import { ListFormatter } from '../ui/ListFormatter';
import { ListItem, createListItem, validateListItem } from '../models/ListItem';
import { normalizeCategory, CategoryType } from '../models/CategoryType';

export class AddListModalHandler extends BaseModalHandler {
  private googleSheetsService: GoogleSheetsService;
  private messageManager: MessageManager;
  private metadataManager: MetadataManager;

  constructor(
    logger: Logger, 
    googleSheetsService?: GoogleSheetsService,
    messageManager?: MessageManager,
    metadataManager?: MetadataManager
  ) {
    super('add-list-modal', logger);
    this.deleteOnSuccess = true;
    this.ephemeral = false;
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
    this.messageManager = messageManager || new MessageManager();
    this.metadataManager = metadataManager || new MetadataManager();
  }

  protected async executeAction(context: ModalHandlerContext): Promise<void> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    // モーダルからデータを取得
    const categoryText = context.interaction.fields.getTextInputValue('category');
    const itemsText = context.interaction.fields.getTextInputValue('items');
    
    if (!itemsText || itemsText.trim() === '') {
      throw new Error('追加するアイテムが入力されていません');
    }

    // カテゴリーの処理
    const category: CategoryType | null = categoryText && categoryText.trim() !== '' 
      ? normalizeCategory(categoryText)
      : null;

    // 既存のリストデータを取得
    const existingData = await this.googleSheetsService.getSheetData(channelId);
    const existingItems = this.convertToListItems(existingData);
    const existingNames = new Set(existingItems.map(item => item.name));

    // 新しいアイテムをパース
    const newItems = this.parseItemsText(itemsText, category);
    
    // 重複チェックとフィルタリング
    const filteredNewItems = newItems.filter(item => {
      if (existingNames.has(item.name)) {
        this.logger.warn('Duplicate name found, skipping', { name: item.name });
        return false;
      }
      return true;
    });

    // 合計アイテム数チェック
    const totalItemsCount = existingItems.length + filteredNewItems.length;
    if (totalItemsCount > 100) {
      throw new Error('アイテム数が多すぎます（最大100件）');
    }

    // データをバリデーション
    this.validateItems(filteredNewItems);
    
    // 既存データと新しいデータをマージ
    const allItems = [...existingItems, ...filteredNewItems];
    
    // Google Sheetsに書き込み
    await this.updateSheetData(channelId, allItems);
    
    // Discord上のリストメッセージを更新
    await this.updateDiscordMessage(channelId, allItems, context.interaction.client);

    this.logger.info('List items added successfully', {
      channelId,
      newItemsCount: filteredNewItems.length,
      totalItemsCount: allItems.length,
      userId: context.interaction.user.id
    });
  }

  protected getSuccessMessage(): string {
    return '✅ リストに項目が追加されました！';
  }

  private parseItemsText(itemsText: string, defaultCategory: CategoryType | null): ListItem[] {
    const items: ListItem[] = [];
    const lines = itemsText.trim().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 空行をスキップ
      if (!line) {
        continue;
      }

      try {
        const parts = line.split(',').map(part => part.trim());
        
        if (parts.length < 1) {
          this.logger.warn('Invalid line format, skipping', { lineNumber: i + 1, line });
          continue;
        }

        const name = parts[0];
        const untilStr = parts.length > 1 && parts[1] ? parts[1] : null;

        if (!name || name.trim() === '') {
          this.logger.warn('Empty name found, skipping', { lineNumber: i + 1, line });
          continue;
        }

        const until = untilStr ? this.parseDate(untilStr) : null;
        const item = createListItem(name, defaultCategory, until);
        
        validateListItem(item);
        
        items.push(item);
      } catch (error) {
        this.logger.warn('Failed to parse line, skipping', { 
          lineNumber: i + 1, 
          line,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return items;
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') {
      return null;
    }
    
    try {
      const date = new Date(dateStr.trim());
      return isNaN(date.getTime()) ? null : date;
    } catch {
      this.logger.warn('Failed to parse date', { dateStr });
      return null;
    }
  }

  private convertToListItems(data: string[][]): ListItem[] {
    const items: ListItem[] = [];
    
    // ヘッダー行をスキップ（存在する場合）
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;
    
    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 1 && row[0]) {
        try {
          const name = row[0].trim();
          const category = row.length > 1 && row[1] && row[1].trim() !== '' ? normalizeCategory(row[1]) : null;
          const until = row.length > 2 && row[2] ? this.parseDate(row[2]) : null;

          const item: ListItem = {
            name,
            category,
            until
          };

          items.push(item);
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
    const headers = ['name', 'category', 'until', '名前', 'カテゴリ'];
    return row.some(cell => 
      headers.some(header => 
        cell && cell.toLowerCase().includes(header.toLowerCase())
      )
    );
  }

  private validateItems(items: ListItem[]): void {
    // 各アイテムのバリデーション
    for (const item of items) {
      validateListItem(item);
    }
  }

  private async updateSheetData(channelId: string, items: ListItem[]): Promise<void> {
    // シートデータを完全に置き換える
    const sheetData = this.convertItemsToSheetData(items);
    
    const result = await this.googleSheetsService.updateSheetData(channelId, sheetData);
    if (!result.success) {
      throw new Error(`スプレッドシートの更新に失敗しました: ${result.message}`);
    }
  }

  private convertItemsToSheetData(items: ListItem[]): string[][] {
    const data: string[][] = [];
    
    // ヘッダー行を追加
    data.push(['name', 'category', 'until']);
    
    // データ行を追加
    for (const item of items) {
      const row = [
        item.name,
        item.category || '',
        item.until ? this.formatDateForSheet(item.until) : ''
      ];
      data.push(row);
    }

    return data;
  }

  private formatDateForSheet(date: Date): string {
    // タイムゾーンの影響を受けないよう、ローカルの年月日を直接使用
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async updateDiscordMessage(channelId: string, items: ListItem[], client: Client): Promise<void> {
    try {
      // チャンネル名を取得してタイトルを生成
      let listTitle = 'リスト';
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && 'name' in channel) {
          listTitle = `${channel.name}リスト`;
        }
      } catch (channelError) {
        this.logger.warn('Failed to fetch channel name, using default title', {
          channelId,
          error: channelError instanceof Error ? channelError.message : 'Unknown error'
        });
      }

      // metadataからdefaultCategoryを取得
      let defaultCategory;
      try {
        const metadataResult = await this.metadataManager.getChannelMetadata(channelId);
        if (metadataResult.success && metadataResult.metadata?.defaultCategory) {
          defaultCategory = metadataResult.metadata.defaultCategory;
        }
      } catch (error) {
        this.logger.warn('Failed to get metadata for defaultCategory', {
          channelId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Embedを作成
      const embed = items.length > 0 
        ? await ListFormatter.formatDataList(listTitle, items, channelId, defaultCategory)
        : await ListFormatter.formatEmptyList(listTitle, channelId, undefined, defaultCategory);

      // MessageManagerを使用してメッセージを更新
      const messageResult = await this.messageManager.createOrUpdateMessageWithMetadata(
        channelId,
        embed,
        listTitle,
        client,
        'list'
      );

      if (messageResult.success) {
        this.logger.info('Discord message updated successfully after add', {
          channelId,
          messageId: messageResult.message?.id,
          itemCount: items.length
        });
      } else {
        this.logger.warn('Failed to update Discord message after add', {
          channelId,
          errorMessage: messageResult.errorMessage
        });
      }
    } catch (error) {
      this.logger.warn('Failed to update Discord message after add', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Discord側の更新が失敗してもシート更新は成功しているので続行
    }
  }
}