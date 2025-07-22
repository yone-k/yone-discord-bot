import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { Logger } from '../utils/logger';
import { BaseButtonHandler, ButtonHandlerContext } from '../base/BaseButtonHandler';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { ListItem } from '../models/ListItem';
import { normalizeCategory } from '../models/CategoryType';

export class EditListButtonHandler extends BaseButtonHandler {
  private googleSheetsService: GoogleSheetsService;

  constructor(logger: Logger, googleSheetsService?: GoogleSheetsService) {
    super('edit-list-button', logger);
    this.googleSheetsService = googleSheetsService || GoogleSheetsService.getInstance();
  }

  protected async executeAction(context: ButtonHandlerContext): Promise<void> {
    const channelId = context.interaction.channelId;
    if (!channelId) {
      throw new Error('チャンネルIDが取得できません');
    }

    // 現在のリストデータを取得
    const sheetData = await this.googleSheetsService.getSheetData(channelId);
    const listItems = this.convertToListItems(sheetData);

    // CSV風テキストに変換
    const csvText = this.convertToCsvText(listItems);

    // モーダルを作成
    const modal = new ModalBuilder()
      .setCustomId('edit-list-modal')
      .setTitle('リスト編集');

    const textInput = new TextInputBuilder()
      .setCustomId('list-data')
      .setLabel('リスト内容（商品名,数量,カテゴリ,期限 の形式）')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(csvText)
      .setPlaceholder('例: 牛乳,1本,食品,2024-12-31\nパン,2斤,食品\nシャンプー,1個,日用品,2024-06-30')
      .setMaxLength(4000)
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>()
      .addComponents(textInput);

    modal.addComponents(firstActionRow);

    // モーダルを表示
    await context.interaction.showModal(modal);
  }

  private convertToListItems(data: string[][]): ListItem[] {
    const items: ListItem[] = [];
    const seenNames = new Set<string>();
    
    // ヘッダー行をスキップ（存在する場合）
    const startIndex = data.length > 0 && this.isHeaderRow(data[0]) ? 1 : 0;
    
    for (let i = startIndex; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 3 && row[0]) {
        try {
          const name = row[0].trim();
          
          if (seenNames.has(name)) {
            this.logger.warn('Duplicate name found, skipping', { rowIndex: i, name });
            continue;
          }
          
          const quantity = row[1] || '';
          const category = normalizeCategory(row[2] || '');
          const addedAt = row[3] ? this.parseDate(row[3]) : new Date();
          const until = row[4] ? this.parseDate(row[4]) : null;

          const item: ListItem = {
            name,
            quantity,
            category,
            addedAt,
            until
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
    const headers = ['name', 'quantity', 'category', 'added_at', 'until', '商品名', '数量', 'カテゴリ'];
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

  private convertToCsvText(items: ListItem[]): string {
    if (items.length === 0) {
      return '商品名,数量,カテゴリ,期限\n例: 牛乳,1本,食品,2024-12-31';
    }

    return items.map(item => {
      const name = item.name;
      const quantity = item.quantity || '';
      const category = item.category || '';
      const until = item.until ? this.formatDateForCsv(item.until) : '';
      return `${name},${quantity},${category},${until}`;
    }).join('\n');
  }

  private formatDateForCsv(date: Date): string {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD形式
  }
}