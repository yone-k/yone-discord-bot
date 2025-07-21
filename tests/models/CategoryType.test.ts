import { describe, it, expect } from 'vitest'
import { CategoryType, DEFAULT_CATEGORY, normalizeCategory, validateCategory, getCategoryEmoji } from '../../src/models/CategoryType'

describe('CategoryType', () => {
  describe('normalizeCategory', () => {
    it('should return input string when valid', () => {
      expect(normalizeCategory('食品')).toBe('食品')
      expect(normalizeCategory('日用品')).toBe('日用品')
    })

    it('should return default category for null or undefined', () => {
      expect(normalizeCategory(null)).toBe(DEFAULT_CATEGORY)
      expect(normalizeCategory(undefined)).toBe(DEFAULT_CATEGORY)
    })

    it('should trim whitespace', () => {
      expect(normalizeCategory('  食品  ')).toBe('食品')
    })
  })

  describe('validateCategory', () => {
    it('should return normalized category for valid input', () => {
      expect(validateCategory('食品')).toBe('食品')
      expect(validateCategory('  日用品  ')).toBe('日用品')
    })

    it('should return default category for empty string', () => {
      expect(validateCategory('')).toBe(DEFAULT_CATEGORY)
    })

    it('should throw error for category name over 50 characters', () => {
      const longCategory = 'a'.repeat(51)
      expect(() => validateCategory(longCategory)).toThrow('カテゴリ名は50文字以内で入力してください')
    })
  })

  describe('getCategoryEmoji', () => {
    it('should return specific emoji for known categories', () => {
      expect(getCategoryEmoji('重要')).toBe('🔥')
      expect(getCategoryEmoji('通常')).toBe('📝')
      expect(getCategoryEmoji('食品')).toBe('🍎')
    })

    it('should return default emoji for unknown categories', () => {
      expect(getCategoryEmoji('不明なカテゴリ')).toBe('📋')
    })
  })

  describe('type safety', () => {
    it('should allow any string as CategoryType', () => {
      const categories: CategoryType[] = [
        '食品',
        '日用品',
        '衣類',
        'その他'
      ]
      
      expect(categories).toHaveLength(4)
      expect(categories).toContain('食品')
      expect(categories).toContain('日用品')
    })
  })
})