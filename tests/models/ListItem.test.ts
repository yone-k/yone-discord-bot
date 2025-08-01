import { describe, it, expect } from 'vitest';
import { ListItem, createListItem, validateListItem } from '../../src/models/ListItem';

describe('ListItem', () => {
  describe('interface validation', () => {
    it('should create a valid ListItem object', () => {
      const until = new Date(Date.now() + 86400000); // +1 day
      const listItem: ListItem = {
        name: 'テスト商品',
        category: '重要',
        until: until,
        check: false
      };

      expect(listItem.name).toBe('テスト商品');
      expect(listItem.category).toBe('重要');
      expect(listItem.until).toBe(until);
      expect(listItem.check).toBe(false);
    });

    it('should create a ListItem object with check=true', () => {
      const listItem: ListItem = {
        name: 'チェック済みアイテム',
        category: null,
        until: null,
        check: true
      };

      expect(listItem.name).toBe('チェック済みアイテム');
      expect(listItem.check).toBe(true);
    });

    it('should allow null values for category and until', () => {
      const listItem: ListItem = {
        name: 'テスト',
        category: null,
        until: null,
        check: false
      };

      expect(listItem).toHaveProperty('name');
      expect(listItem).toHaveProperty('category');
      expect(listItem).toHaveProperty('until');
      expect(listItem).toHaveProperty('check');
      expect(listItem.category).toBeNull();
      expect(listItem.until).toBeNull();
      expect(listItem.check).toBe(false);
    });
  });

  describe('createListItem helper', () => {
    it('should create ListItem with null until', () => {
      const result = createListItem('りんご', '重要');

      expect(result.name).toBe('りんご');
      expect(result.category).toBe('重要');
      expect(result.until).toBeNull();
      expect(result.check).toBe(false);
    });

    it('should create ListItem with name only', () => {
      const result = createListItem('ミニマルテスト');

      expect(result.name).toBe('ミニマルテスト');
      expect(result.category).toBeNull();
      expect(result.until).toBeNull();
      expect(result.check).toBe(false);
    });

    it('should create ListItem with until date', () => {
      const until = new Date('2024-12-31');
      const result = createListItem('期限テスト', 'テスト', until);

      expect(result.name).toBe('期限テスト');
      expect(result.category).toBe('テスト');
      expect(result.until).toBe(until);
      expect(result.check).toBe(false);
    });

    it('should create ListItem with check=true', () => {
      const result = createListItem('完了済みテスト', 'テスト', null, true);

      expect(result.name).toBe('完了済みテスト');
      expect(result.category).toBe('テスト');
      expect(result.until).toBeNull();
      expect(result.check).toBe(true);
    });

    it('should create ListItem with check=false by default', () => {
      const result = createListItem('デフォルトテスト', 'テスト', null);

      expect(result.name).toBe('デフォルトテスト');
      expect(result.check).toBe(false);
    });

    it('should trim whitespace from name', () => {
      const result = createListItem('  牛乳  ', '通常');

      expect(result.name).toBe('牛乳');
      expect(result.category).toBe('通常');
      expect(result.check).toBe(false);
    });
  });

  describe('validateListItem helper', () => {
    it('should validate a correct ListItem', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: '重要',
        until: null,
        check: false
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should validate ListItem with null values', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: null,
        until: null,
        check: false
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should validate ListItem with check=true', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: null,
        until: null,
        check: true
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should throw error for empty name', () => {
      const invalidItem: ListItem = {
        name: '',
        category: '重要',
        until: null,
        check: false
      };

      expect(() => validateListItem(invalidItem)).toThrow('名前は必須です');
    });

    it('should validate null category', () => {
      const validItem: ListItem = {
        name: 'テスト商品',
        category: null,
        until: null,
        check: true
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should throw error for invalid until when not null', () => {
      const invalidItem: ListItem = {
        name: 'テスト商品',
        category: '重要',
        until: new Date('invalid'),
        check: false
      };

      expect(() => validateListItem(invalidItem)).toThrow('期限日時が無効です');
    });
  });
});