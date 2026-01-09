import { Client } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseModalHandler, ModalHandlerContext } from '../base/BaseModalHandler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { MessageManager } from '../services/MessageManager';
import { MetadataManager } from '../services/MetadataManager';
import { ListFormatter } from '../ui/ListFormatter';
import { ListItem, createListItem, validateListItem } from '../models/ListItem';
import { normalizeCategory, CategoryType } from '../models/CategoryType';
import { OperationLogService } from '../services/OperationLogService';
import { OperationResult, OperationInfo } from '../models/types/OperationLog';

export class EditListModalHandler extends BaseModalHandler {
  private googleSheetsService: GoogleSheetsService;
  private messageManager: MessageManager;

  constructor(
    logger: Logger, 
    googleSheetsService?: GoogleSheetsService,
    messageManager?: MessageManager,
    metadataManager?: MetadataManager,
    operationLogService?: OperationLogService
  ) {
    super('edit-list-modal', logger, operationLogService, metadataManager);
    this.deleteOnSuccess = true;
    this.ephemeral = false;
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
    this.messageManager = messageManager || new MessageManager();
  }

  protected async executeAction(context: ModalHandlerContext): Promise<OperationResult> {
    try {
      const channelId = context.interaction.channelId;
      if (!channelId) {
        return {
          success: false,
          message: 'チャンネルIDが取得できません',
          error: new Error('チャンネルIDが取得できません')
        };
      }

      // 編集前の既存データを取得
      const existingData = await this.googleSheetsService.getSheetData(channelId);
      const existingItems = this.convertToListItems(existingData);

      // metadata から defaultCategory を取得
      let defaultCategory: string | null = null;
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

      // モーダルからデータを取得
      const listDataText = context.interaction.fields.getTextInputValue('list-data');
      
      // CSVテキストをListItemsに変換（編集時はdefaultCategoryを使用しない）
      const editedItems = this.parseCsvText(listDataText);
      
      // データをバリデーション
      this.validateItems(editedItems);
      
      // 変更差分を計算（defaultCategoryを考慮）
      const changes = this.calculateChanges(existingItems, editedItems, defaultCategory);
      
      // Google Sheetsに書き込み
      await this.updateSheetData(channelId, editedItems);
      
      // Discord上のリストメッセージを更新
      await this.updateDiscordMessage(channelId, editedItems, context.interaction.client);

      this.logger.info('List edited successfully', {
        channelId,
        itemCount: editedItems.length,
        userId: context.interaction.user.id,
        changesCount: changes.added.length + changes.removed.length + changes.modified.length
      });

      // 操作結果を返す
      return {
        success: true,
        message: `リストを編集しました（${changes.added.length}件追加、${changes.removed.length}件削除、${changes.modified.length}件変更）`,
        affectedItems: editedItems.length,
        details: {
          changes: {
            added: changes.added,
            removed: changes.removed,
            modified: changes.modified
          },
          items: editedItems.map(item => ({
            name: item.name,
            quantity: 1,
            category: item.category || 'その他',
            until: item.until || undefined
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '編集処理中にエラーが発生しました',
        error: error instanceof Error ? error : new Error('Unknown error')
      };
    }
  }

  protected getOperationInfo(_context: ModalHandlerContext): OperationInfo {
    return {
      operationType: 'edit',
      actionName: 'アイテム編集'
    };
  }

  protected getSuccessMessage(): string {
    return '✅ リストが正常に更新されました！';
  }

  /**
   * 編集前後の変更差分を計算する
   */
  private calculateChanges(existingItems: ListItem[], editedItems: ListItem[], defaultCategory?: string | null): { added: ListItem[]; removed: ListItem[]; modified: Array<{ name: string; before: Partial<ListItem>; after: Partial<ListItem> }> } {
    const existingMap = new Map(existingItems.map(item => [item.name, item]));
    const editedMap = new Map(editedItems.map(item => [item.name, item]));

    const added: ListItem[] = [];
    const removed: ListItem[] = [];
    const modified: Array<{ name: string; before: Partial<ListItem>; after: Partial<ListItem> }> = [];

    // 追加されたアイテムを検出
    for (const [name, item] of editedMap) {
      if (!existingMap.has(name)) {
        added.push(item);
      }
    }

    // 削除されたアイテムを検出
    for (const [name, item] of existingMap) {
      if (!editedMap.has(name)) {
        removed.push(item);
      }
    }

    // 変更されたアイテムを検出
    for (const [name, editedItem] of editedMap) {
      const existingItem = existingMap.get(name);
      if (existingItem) {
        const changes = this.getItemChanges(existingItem, editedItem, defaultCategory);
        if (Object.keys(changes.before).length > 0) {
          modified.push({
            name,
            before: changes.before,
            after: changes.after
          });
        }
      }
    }

    return { added, removed, modified };
  }

  /**
   * 個別アイテムの変更を検出する
   */
  private getItemChanges(before: ListItem, after: ListItem, defaultCategory?: string | null): { before: Partial<ListItem>; after: Partial<ListItem> } {
    const beforeChanges: Partial<ListItem> = {};
    const afterChanges: Partial<ListItem> = {};

    if (!this.areCategoriesEquivalent(before.category, after.category, defaultCategory)) {
      beforeChanges.category = before.category;
      afterChanges.category = after.category;
    }

    if (before.check !== after.check) {
      beforeChanges.check = before.check;
      afterChanges.check = after.check;
    }

    const beforeUntilStr = before.until?.toISOString();
    const afterUntilStr = after.until?.toISOString();
    if (beforeUntilStr !== afterUntilStr) {
      beforeChanges.until = before.until;
      afterChanges.until = after.until;
    }

    return { before: beforeChanges, after: afterChanges };
  }

  /**
   * 2つのカテゴリがdefaultCategoryを考慮して等価かどうかを判定する
   * null/undefinedとdefaultCategoryは等価として扱う
   */
  private areCategoriesEquivalent(category1: string | null, category2: string | null, defaultCategory?: string | null): boolean {
    // defaultCategoryが設定されていない場合は厳密等価で比較
    if (!defaultCategory) {
      return category1 === category2;
    }
    
    // 両方ともnull/undefinedの場合は等価
    if (!category1 && !category2) {
      return true;
    }
    
    // 一方がnull/undefined、もう一方がdefaultCategoryの場合は等価
    if (!category1 && category2 === defaultCategory) {
      return true;
    }
    
    if (category1 === defaultCategory && !category2) {
      return true;
    }
    
    // 両方とも値があり、かつ同じ値の場合は等価
    if (category1 && category2 && category1 === category2) {
      return true;
    }
    
    return false;
  }

  /**
   * Google Sheetsのデータを ListItem[] に変換する（AddListModalHandlerから移植）
   */
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

  /**
   * ヘッダー行かどうかを判定する
   */
  private isHeaderRow(row: string[]): boolean {
    const headers = ['name', 'category', 'until', 'check', 'last_notified_at', '名前', 'カテゴリ', '完了'];
    return row.some(cell => 
      headers.some(header => 
        cell && cell.toLowerCase().includes(header.toLowerCase())
      )
    );
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
        const categoryStr = parts.length > 1 && parts[1] ? parts[1] : null;
        const untilStr = parts.length > 2 && parts[2] ? parts[2] : null;
        const checkStr = parts.length > 3 && parts[3] ? parts[3] : null;

        if (!name || name.trim() === '') {
          this.logger.warn('Empty name found, skipping', { lineNumber: i + 1, line });
          continue;
        }

        // 重複チェック
        if (seenNames.has(name)) {
          this.logger.warn('Duplicate name found, skipping', { lineNumber: i + 1, name });
          continue;
        }

        // カテゴリの処理：編集時は空の場合はnullのまま保持（defaultCategoryは使用しない）
        let category: CategoryType | null;
        if (categoryStr && categoryStr.trim() !== '') {
          category = normalizeCategory(categoryStr);
        } else {
          category = null;
        }

        const until = untilStr ? this.parseDate(untilStr) : null;
        const check = this.parseCheck(checkStr);
        const item = createListItem(name, category, until, check);
        
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

  private parseCheck(checkStr: string | null): boolean {
    if (!checkStr || checkStr.trim() === '') {
      return false;
    }
    
    const trimmed = checkStr.trim();
    if (trimmed === '1') {
      return true;
    } else if (trimmed === '0') {
      return false;
    } else {
      // 0,1以外の値の場合はfalse
      return false;
    }
  }

  private isHeaderLine(line: string): boolean {
    const lowerLine = line.toLowerCase();
    const headerKeywords = ['名前', 'name', 'カテゴリ', 'category'];
    return headerKeywords.some(keyword => lowerLine.includes(keyword));
  }

  private validateItems(items: ListItem[]): void {
    // 空のリストも許可する
    if (items.length > 100) {
      throw new Error('アイテム数が多すぎます（最大100件）。');
    }

    // 各アイテムのバリデーション（既にcreateListItemとvalidateListItemで行われているが、念のため）
    for (const item of items) {
      validateListItem(item);
    }
  }

  private async updateSheetData(channelId: string, items: ListItem[]): Promise<void> {
    // metadata から defaultCategory を取得
    let defaultCategory: string | null = null;
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

    // 既存の通知日時を保持するために現在のシートを取得
    const existingData = await this.googleSheetsService.getSheetData(channelId);
    const existingItems = this.convertToListItems(existingData);
    const notifiedMap = new Map<string, Date | null>(
      existingItems.map(item => [item.name, item.lastNotifiedAt ?? null])
    );

    const mergedItems = items.map(item => ({
      ...item,
      lastNotifiedAt: item.lastNotifiedAt ?? notifiedMap.get(item.name) ?? null
    }));

    // 現在のシートデータを完全に置き換える
    const sheetData = this.convertItemsToSheetData(mergedItems, channelId, defaultCategory);
    
    const result = await this.googleSheetsService.updateSheetData(channelId, sheetData);
    if (!result.success) {
      throw new Error(`スプレッドシートの更新に失敗しました: ${result.message}`);
    }
  }

  private convertItemsToSheetData(items: ListItem[], channelId?: string, defaultCategory?: string | null): (string | number)[][] {
    const data: (string | number)[][] = [];
    
    // ヘッダー行を追加
    data.push(['name', 'category', 'until', 'check', 'last_notified_at']);
    
    // データ行を追加
    for (const item of items) {
      const category = this.determineSheetCategory(item.category, defaultCategory);
      const row = [
        item.name,
        category,
        item.until ? this.formatDateForSheet(item.until) : '',
        item.check ? 1 : 0,
        item.lastNotifiedAt ? item.lastNotifiedAt.toISOString() : ''
      ];
      data.push(row);
    }

    return data;
  }

  /**
   * アイテムのカテゴリとdefaultCategoryを比較して、スプレッドシートに保存すべきカテゴリを決定する
   * defaultCategoryと一致する場合は空文字列、異なる場合は元のカテゴリを返す
   */
  private determineSheetCategory(itemCategory: string | null, defaultCategory?: string | null): string {
    // defaultCategoryが設定されていない場合は通常通り
    if (!defaultCategory) {
      return itemCategory || '';
    }
    
    // itemCategoryがnullまたは空文字列の場合は空文字列を返す
    if (!itemCategory) {
      return '';
    }
    
    // defaultCategoryと一致する場合は空文字列を返す
    if (itemCategory === defaultCategory) {
      return '';
    }
    
    // 一致しない場合は元のカテゴリを返す
    return itemCategory;
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

      // コンポーネントV2用の表示を作成
      const content = items.length > 0 
        ? await ListFormatter.formatDataListContent(listTitle, items, channelId, defaultCategory)
        : await ListFormatter.formatEmptyListContent(listTitle, channelId, undefined, defaultCategory);
      const components = ListFormatter.buildListComponents(content);

      // MessageManagerを使用してメッセージを更新
      const messageResult = await this.messageManager.createOrUpdateMessageWithMetadataV2(
        channelId,
        components,
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
