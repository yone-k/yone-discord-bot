export type CategoryType = string;

export const DEFAULT_CATEGORY = 'その他';

export function normalizeCategory(input: string | null | undefined): CategoryType {
  if (!input || typeof input !== 'string') {
    return DEFAULT_CATEGORY;
  }
  
  return input.trim();
}

export function validateCategory(input: string | null | undefined): CategoryType {
  const category = normalizeCategory(input);
  
  // カテゴリ名の文字数制限チェック
  if (category.length > 50) {
    throw new Error('カテゴリ名は50文字以内で入力してください');
  }
  
  // 空文字チェック
  if (category === '') {
    return DEFAULT_CATEGORY;
  }
  
  return category;
}

export function getCategoryEmoji(category: CategoryType): string {
  const emojiMap: Record<string, string> = {
    '重要': '🔥',
    '通常': '📝',
    'その他': '📦',
    '食品': '🍎',
    '日用品': '🧽',
    '衣類': '👕',
    '電化製品': '⚡',
    '本': '📚',
    '薬': '💊',
    '掃除': '🧹',
    '文房具': '✏️'
  };
  
  return emojiMap[category] || '📋';
}