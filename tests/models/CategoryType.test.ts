import { describe, it, expect } from 'vitest'
import { CategoryType } from '../../src/models/CategoryType'

describe('CategoryType', () => {
  describe('enum values', () => {
    it('should have PRIMARY value', () => {
      expect(CategoryType.PRIMARY).toBe('primary')
    })

    it('should have SECONDARY value', () => {
      expect(CategoryType.SECONDARY).toBe('secondary')
    })

    it('should have OTHER value', () => {
      expect(CategoryType.OTHER).toBe('other')
    })
  })

  describe('type safety', () => {
    it('should only allow valid enum values', () => {
      const validCategories: CategoryType[] = [
        CategoryType.PRIMARY,
        CategoryType.SECONDARY,
        CategoryType.OTHER
      ]
      
      expect(validCategories).toHaveLength(3)
      expect(validCategories).toContain('primary')
      expect(validCategories).toContain('secondary')
      expect(validCategories).toContain('other')
    })
  })
})