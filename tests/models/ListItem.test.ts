import { describe, it, expect } from 'vitest'
import { ListItem, createListItem, validateListItem } from '../../src/models/ListItem'
import { CategoryType } from '../../src/models/CategoryType'

describe('ListItem', () => {
  describe('interface validation', () => {
    it('should create a valid ListItem object', () => {
      const now = new Date()
      const until = new Date(Date.now() + 86400000) // +1 day
      const listItem: ListItem = {
        name: 'テスト商品',
        quantity: '3',
        category: '重要',
        addedAt: now,
        until: until
      }

      expect(listItem.name).toBe('テスト商品')
      expect(listItem.quantity).toBe('3')
      expect(listItem.category).toBe('重要')
      expect(listItem.addedAt).toBe(now)
      expect(listItem.until).toBe(until)
    })

    it('should allow null values for quantity, category, addedAt and until', () => {
      const listItem: ListItem = {
        name: 'テスト',
        quantity: null,
        category: null,
        addedAt: null,
        until: null
      }

      expect(listItem).toHaveProperty('name')
      expect(listItem).toHaveProperty('quantity')
      expect(listItem).toHaveProperty('category')
      expect(listItem).toHaveProperty('addedAt')
      expect(listItem).toHaveProperty('until')
      expect(listItem.quantity).toBeNull()
      expect(listItem.category).toBeNull()
      expect(listItem.addedAt).toBeNull()
      expect(listItem.until).toBeNull()
    })
  })

  describe('createListItem helper', () => {
    it('should create ListItem with current timestamp and null until', () => {
      const result = createListItem('りんご', '5', '重要')

      expect(result.name).toBe('りんご')
      expect(result.quantity).toBe('5')
      expect(result.category).toBe('重要')
      expect(result.addedAt).toBeInstanceOf(Date)
      expect(result.until).toBeNull()
      expect(Math.abs(result.addedAt!.getTime() - Date.now())).toBeLessThan(1000)
    })

    it('should create ListItem with name only', () => {
      const result = createListItem('ミニマルテスト')

      expect(result.name).toBe('ミニマルテスト')
      expect(result.quantity).toBeNull()
      expect(result.category).toBeNull()
      expect(result.addedAt).toBeInstanceOf(Date)
      expect(result.until).toBeNull()
    })

    it('should create ListItem with until date', () => {
      const until = new Date('2024-12-31')
      const result = createListItem('期限テスト', '1個', 'テスト', until)

      expect(result.name).toBe('期限テスト')
      expect(result.quantity).toBe('1個')
      expect(result.category).toBe('テスト')
      expect(result.until).toBe(until)
    })

    it('should trim whitespace from name', () => {
      const result = createListItem('  牛乳  ', '2', '通常')

      expect(result.name).toBe('牛乳')
      expect(result.quantity).toBe('2')
      expect(result.category).toBe('通常')
    })
  })

  describe('validateListItem helper', () => {
    it('should validate a correct ListItem', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        quantity: '3',
        category: '重要',
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should validate ListItem with null values', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        quantity: null,
        category: null,
        addedAt: null,
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should validate ListItem with partial null values', () => {
      const validItem: ListItem = {
        name: 'バナナ',
        quantity: '3',
        category: null,
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should throw error for empty name', () => {
      const invalidItem: ListItem = {
        name: '',
        quantity: '1',
        category: '重要',
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(invalidItem)).toThrow('商品名は必須です')
    })

    it('should validate string quantity', () => {
      const validItem: ListItem = {
        name: 'テスト商品',
        quantity: '0',
        category: '重要',
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should validate null quantity', () => {
      const validItem: ListItem = {
        name: 'テスト商品',
        quantity: null,
        category: '重要',
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should validate null category', () => {
      const validItem: ListItem = {
        name: 'テスト商品',
        quantity: '1',
        category: null,
        addedAt: new Date(),
        until: null
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should throw error for invalid addedAt when not null', () => {
      const invalidItem: ListItem = {
        name: 'テスト商品',
        quantity: '1',
        category: '重要',
        addedAt: new Date('invalid'),
        until: null
      }

      expect(() => validateListItem(invalidItem)).toThrow('追加日時が無効です')
    })

    it('should throw error for invalid until when not null', () => {
      const invalidItem: ListItem = {
        name: 'テスト商品',
        quantity: '1',
        category: '重要',
        addedAt: new Date(),
        until: new Date('invalid')
      }

      expect(() => validateListItem(invalidItem)).toThrow('期限日時が無効です')
    })
  })
})