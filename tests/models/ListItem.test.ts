import { describe, it, expect } from 'vitest';
import { ListItem, createListItem, validateListItem } from '../../src/models/ListItem';

describe('ListItem', () => {
  describe('interface validation', () => {
    it('should create a valid ListItem object', () => {
      const until = new Date(Date.now() + 86400000); // +1 day
      const listItem: ListItem = {
        name: 'テスト商品',
        category: '重要',
        until: until
      };

      expect(listItem.name).toBe('テスト商品');
      expect(listItem.category).toBe('重要');
      expect(listItem.until).toBe(until);
    });

    it('should allow null values for category and until', () => {
      const listItem: ListItem = {
        name: 'テスト',
        category: null,
        until: null
      };

      expect(listItem).toHaveProperty('name');
      expect(listItem).toHaveProperty('category');
      expect(listItem).toHaveProperty('until');
      expect(listItem.category).toBeNull();
      expect(listItem.until).toBeNull();
    });
  });

  describe('createListItem helper', () => {
    it('should create ListItem with null until', () => {
      const result = createListItem('りんご', '重要');

      expect(result.name).toBe('りんご');
      expect(result.category).toBe('重要');
      expect(result.until).toBeNull();
    });

    it('should create ListItem with name only', () => {
      const result = createListItem('ミニマルテスト');

      expect(result.name).toBe('ミニマルテスト');
      expect(result.category).toBeNull();
      expect(result.until).toBeNull();
    });

    it('should create ListItem with until date', () => {
      const until = new Date('2024-12-31');
      const result = createListItem('期限テスト', 'テスト', until);

      expect(result.name).toBe('期限テスト');
      expect(result.category).toBe('テスト');
      expect(result.until).toBe(until);
    });

    it('should trim whitespace from name', () => {
      const result = createListItem('  牛乳  ', '通常');

      expect(result.name).toBe('牛乳');
      expect(result.category).toBe('通常');
    });
  });

  describe('validateListItem helper', () => {
    it('should validate a correct ListItem', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: '重要',
        until: null
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should validate ListItem with null values', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: null,
        until: null
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should validate ListItem with partial null values', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        category: null,
        until: null
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should throw error for empty name', () => {
      const invalidItem: ListItem = {
        name: '',
        category: '重要',
        until: null
      };

      expect(() => validateListItem(invalidItem)).toThrow('商品名は必須です');
    });

    it('should validate null category', () => {
      const validItem: ListItem = {
        name: 'テスト商品',
        category: null,
        until: null
      };

      expect(() => validateListItem(validItem)).not.toThrow();
    });

    it('should throw error for invalid until when not null', () => {
      const invalidItem: ListItem = {
        name: 'テスト商品',
        category: '重要',
        until: new Date('invalid')
      };

      expect(() => validateListItem(invalidItem)).toThrow('期限日時が無効です');
    });
  });
});