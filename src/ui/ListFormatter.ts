import { ListItem } from '../models/ListItem';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  fields: DiscordEmbedField[];
  color?: number;
}

export class ListFormatter {
  static formatToDiscordEmbed(items: ListItem[]): DiscordEmbed {
    const fields: DiscordEmbedField[] = items.map(item => {
      const valueParts: string[] = [
        `📦 数量: ${item.quantity}`,
        `📂 カテゴリ: ${item.category}`,
        `📅 追加日: ${item.addedAt.toLocaleDateString('ja-JP')}`
      ];
      
      return {
        name: item.name,
        value: valueParts.join('\n'),
        inline: false
      };
    });

    return {
      title: 'リスト一覧',
      fields: fields,
      color: 0x3498db
    };
  }
}