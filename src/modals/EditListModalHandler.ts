import { Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { MessageManager } from '../services/MessageManager';
import { ListFormatter } from '../ui/ListFormatter';
import { ListItem, createListItem, validateListItem } from '../models/ListItem';
import { normalizeCategory } from '../models/CategoryType';

export class EditListModalHandler extends BaseModalHandler {
  private googleSheetsService: GoogleSheetsService;
  private messageManager: MessageManager;

  constructor(
    logger: Logger, 
    googleSheetsService?: GoogleSheetsService,
    messageManager?: MessageManager
  ) {
    super('edit-list-modal', logger);
    this.deleteOnSuccess = true;
    this.ephemeral = false;
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
    this.messageManager = messageManager || new MessageManager();
  }

  protected async executeAction(context: ModalHandlerContext): Promise<void> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    // モーダルからデータを取得
    const listDataText = context.interaction.fields.getTextInputValue('list-data');
    
    // CSVテキストをListItemsに変換
    const listItems = this.parseCsvText(listDataText);
    
    // データをバリデーション
    this.validateItems(listItems);
    
    // Google Sheetsに書き込み
    await this.updateSheetData(channelId, listItems);
    
    // Discord上のリストメッセージを更新
    await this.updateDiscordMessage(channelId, listItems, context.interaction.client);

    this.logger.info('List edited successfully', {
      channelId,
      itemCount: listItems.length,
      userId: context.interaction.user.id
    });
  }

  protected getSuccessMessage(): string {
    return '✅ リストが正常に更新されました！';
  }

  private parseCsvText(csvText: string): ListItem[] {
    const items: ListItem[] = [];
    const lines = csvText.trim().split('\n');
    const seenNames = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // 空行やコメント行をスキップ
      if (!line || line.startsWith('#') || line.startsWith('//')) {
        continue;
      }

      // ヘッダー行っぽいものをスキップ
      if (this.isHeaderLine(line)) {
        continue;
      }

      // 例行をスキップ
      if (line.startsWith('例:') || line.includes('例:')) {
        continue;
      }

      try {
        const parts = line.split(',').map(part => part.trim());
        
        // nameのみは必須、他はオプション
        if (parts.length < 1) {
          this.logger.warn('Invalid CSV line format, skipping', { lineNumber: i + 1, line });
          continue;
        }

        const name = parts[0];
        const quantity = parts.length > 1 && parts[1] ? parts[1] : null;
        const categoryStr = parts.length > 2 && parts[2] ? parts[2] : null;
        const untilStr = parts.length > 3 && parts[3] ? parts[3] : null;

        if (!name || name.trim() === '') {
          this.logger.warn('Empty name found, skipping', { lineNumber: i + 1, line });
          continue;
        }

        // 重複チェック
        if (seenNames.has(name)) {
          this.logger.warn('Duplicate name found, skipping', { lineNumber: i + 1, name });
          continue;
        }

        const category = categoryStr ? normalizeCategory(categoryStr) : null;
        const until = untilStr ? this.parseDate(untilStr) : null;
        const item = createListItem(name, quantity, category, until);
        
        validateListItem(item);
        
        items.push(item);
        seenNames.add(name);
      } catch (error) {
        this.logger.warn('Failed to parse CSV line, skipping', { 
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

  private isHeaderLine(line: string): boolean {
    const lowerLine = line.toLowerCase();
    const headerKeywords = ['商品名', 'name', '数量', 'quantity', 'カテゴリ', 'category'];
    return headerKeywords.some(keyword => lowerLine.includes(keyword));
  }

  private validateItems(items: ListItem[]): void {
    if (items.length === 0) {
      throw new Error('有効なデータが見つかりません。正しい形式で入力してください。');
    }

    if (items.length > 100) {
      throw new Error('アイテム数が多すぎます（最大100件）。');
    }

    // 各アイテムのバリデーション（既にcreateListItemとvalidateListItemで行われているが、念のため）
    for (const item of items) {
      validateListItem(item);
    }
  }

  private async updateSheetData(channelId: string, items: ListItem[]): Promise<void> {
    // 現在のシートデータを完全に置き換える
    const sheetData = this.convertItemsToSheetData(items);
    
    const result = await this.googleSheetsService.updateSheetData(channelId, sheetData);
    if (!result.success) {
      throw new Error(`スプレッドシートの更新に失敗しました: ${result.message}`);
    }
  }

  private convertItemsToSheetData(items: ListItem[]): string[][] {
    const data: string[][] = [];
    
    // ヘッダー行を追加
    data.push(['name', 'quantity', 'category', 'added_at', 'until']);
    
    // データ行を追加
    for (const item of items) {
      const row = [
        item.name,
        item.quantity || '',
        item.category || '',
        item.addedAt ? item.addedAt.toISOString() : '',
        item.until ? item.until.toISOString() : ''
      ];
      data.push(row);
    }

    return data;
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

      // Embedを作成
      const embed = items.length > 0 
        ? await ListFormatter.formatDataList(listTitle, items)
        : ListFormatter.formatEmptyList(listTitle);

      // MessageManagerを使用してメッセージを更新
      const messageResult = await this.messageManager.createOrUpdateMessageWithMetadata(
        channelId,
        embed,
        listTitle,
        client,
        'list'
      );

      if (messageResult.success) {
        this.logger.info('Discord message updated successfully after edit', {
          channelId,
          messageId: messageResult.message?.id,
          itemCount: items.length
        });
      } else {
        this.logger.warn('Failed to update Discord message after edit', {
          channelId,
          errorMessage: messageResult.errorMessage
        });
      }
    } catch (error) {
      this.logger.warn('Failed to update Discord message after edit', {
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Discord側の更新が失敗してもシート更新は成功しているので続行
    }
  }
}