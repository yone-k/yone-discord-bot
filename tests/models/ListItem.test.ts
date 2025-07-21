import { describe, it, expect } from 'vitest'
import { ListItem, createListItem, validateListItem } from '../../src/models/ListItem'
import { CategoryType } from '../../src/models/CategoryType'

describe('ListItem', () => {
  describe('interface validation', () => {
    it('should create a valid ListItem object', () => {
      const now = new Date()
      const listItem: ListItem = {
        id: 'test-id-123',
        name: 'テスト商品',
        quantity: 3,
        category: CategoryType.PRIMARY,
        addedAt: now
      }

      expect(listItem.id).toBe('test-id-123')
      expect(listItem.name).toBe('テスト商品')
      expect(listItem.quantity).toBe(3)
      expect(listItem.category).toBe(CategoryType.PRIMARY)
      expect(listItem.addedAt).toBe(now)
    })

    it('should require all mandatory fields', () => {
      const now = new Date()
      const listItem: ListItem = {
        id: 'test-id',
        name: 'テスト',
        quantity: 1,
        category: CategoryType.OTHER,
        addedAt: now
      }

      expect(listItem).toHaveProperty('id')
      expect(listItem).toHaveProperty('name')
      expect(listItem).toHaveProperty('quantity')
      expect(listItem).toHaveProperty('category')
      expect(listItem).toHaveProperty('addedAt')
    })
  })

  describe('createListItem helper', () => {
    it('should create ListItem with generated ID and current JST timestamp', () => {
      const result = createListItem('りんご', 5, CategoryType.PRIMARY)

      expect(result.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
      expect(result.name).toBe('りんご')
      expect(result.quantity).toBe(5)
      expect(result.category).toBe(CategoryType.PRIMARY)
      expect(result.addedAt).toBeInstanceOf(Date)
      expect(Math.abs(result.addedAt.getTime() - Date.now())).toBeLessThan(1000)
    })

    it('should trim whitespace from name', () => {
      const result = createListItem('  牛乳  ', 2, CategoryType.SECONDARY)

      expect(result.name).toBe('牛乳')
    })
  })

  describe('validateListItem helper', () => {
    it('should validate a correct ListItem', () => {
      const validItem: ListItem = {
        id: 'valid-id',
        name: 'バナナ',
        quantity: 3,
        category: CategoryType.PRIMARY,
        addedAt: new Date()
      }

      expect(() => validateListItem(validItem)).not.toThrow()
    })

    it('should throw error for empty name', () => {
      const invalidItem: ListItem = {
        id: 'test-id',
        name: '',
        quantity: 1,
        category: CategoryType.PRIMARY,
        addedAt: new Date()
      }

      expect(() => validateListItem(invalidItem)).toThrow('商品名は必須です')
    })

    it('should throw error for zero or negative quantity', () => {
      const invalidItem: ListItem = {
        id: 'test-id',
        name: 'テスト商品',
        quantity: 0,
        category: CategoryType.PRIMARY,
        addedAt: new Date()
      }

      expect(() => validateListItem(invalidItem)).toThrow('数量は1以上である必要があります')
    })

    it('should throw error for invalid ID format', () => {
      const invalidItem: ListItem = {
        id: '',
        name: 'テスト商品',
        quantity: 1,
        category: CategoryType.PRIMARY,
        addedAt: new Date()
      }

      expect(() => validateListItem(invalidItem)).toThrow('IDは必須です')
    })
  })
})