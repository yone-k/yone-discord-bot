import { describe, it, expect } from 'vitest';

// TDD Green Phase: 型定義が実装されたため、インポートを有効化
import { OperationResult, OperationDetails, OperationInfo } from '../../../src/models/types/OperationLog';

describe('OperationLog types', () => {
  describe('OperationResult interface', () => {
    it('should have success property', () => {
      // TDD Green Phase: 型定義が実装されたため、正常にインポートできることを確認
      const operationResult: OperationResult = {
        success: true
      };

      expect(operationResult).toHaveProperty('success');
      expect(typeof operationResult.success).toBe('boolean');
      expect(operationResult.success).toBe(true);
    });

    it('should have optional message property', () => {
      const operationResult: OperationResult = {
        success: false,
        message: 'エラーメッセージ'
      };

      expect(operationResult).toHaveProperty('message');
      expect(typeof operationResult.message).toBe('string');
      expect(operationResult.message).toBe('エラーメッセージ');
    });

    it('should have optional error property', () => {
      const testError = new Error('テストエラー');
      const operationResult: OperationResult = {
        success: false,
        error: testError
      };

      expect(operationResult).toHaveProperty('error');
      expect(operationResult.error).toBeInstanceOf(Error);
      expect(operationResult.error?.message).toBe('テストエラー');
    });

    it('should have optional affectedItems property', () => {
      const operationResult: OperationResult = {
        success: true,
        affectedItems: 5
      };

      expect(operationResult).toHaveProperty('affectedItems');
      expect(typeof operationResult.affectedItems).toBe('number');
      expect(operationResult.affectedItems).toBe(5);
    });

    it('should allow creating with only success property', () => {
      const operationResult: OperationResult = {
        success: true
      };

      expect(operationResult.success).toBe(true);
      expect(operationResult.message).toBeUndefined();
      expect(operationResult.error).toBeUndefined();
      expect(operationResult.affectedItems).toBeUndefined();
    });

    it('should allow creating with all properties', () => {
      const testError = new Error('全プロパティテスト');
      const operationResult: OperationResult = {
        success: false,
        message: '操作が失敗しました',
        error: testError,
        affectedItems: 0
      };

      expect(operationResult.success).toBe(false);
      expect(operationResult.message).toBe('操作が失敗しました');
      expect(operationResult.error).toBe(testError);
      expect(operationResult.affectedItems).toBe(0);
    });
  });

  describe('OperationDetails interface', () => {
    it('should have optional items property', () => {
      const operationDetails: OperationDetails = {
        items: [
          { name: 'アイテム1', quantity: 1, category: 'カテゴリ1' },
          { name: 'アイテム2', quantity: 2, category: 'カテゴリ2', until: new Date() }
        ]
      };

      expect(operationDetails).toHaveProperty('items');
      expect(Array.isArray(operationDetails.items)).toBe(true);
      expect(operationDetails.items).toHaveLength(2);
      expect(operationDetails.items?.[0]).toHaveProperty('name');
      expect(operationDetails.items?.[0]).toHaveProperty('quantity');
      expect(operationDetails.items?.[0]).toHaveProperty('category');
    });

    it('should have optional changes property', () => {
      const changes = { 
        before: { name: '古い名前', category: '古いカテゴリ' },
        after: { name: '新しい名前', category: '新しいカテゴリ' }
      };
      const operationDetails: OperationDetails = {
        changes: changes
      };

      expect(operationDetails).toHaveProperty('changes');
      expect(typeof operationDetails.changes).toBe('object');
      expect(operationDetails.changes).toEqual(changes);
      expect(operationDetails.changes).toHaveProperty('before');
      expect(operationDetails.changes).toHaveProperty('after');
    });

    it('should have optional cancelReason property', () => {
      const operationDetails: OperationDetails = {
        cancelReason: 'ユーザーによるキャンセル'
      };

      expect(operationDetails).toHaveProperty('cancelReason');
      expect(typeof operationDetails.cancelReason).toBe('string');
      expect(operationDetails.cancelReason).toBe('ユーザーによるキャンセル');
    });

    it('should allow creating with no properties', () => {
      const operationDetails: OperationDetails = {};

      expect(operationDetails.items).toBeUndefined();
      expect(operationDetails.changes).toBeUndefined();
      expect(operationDetails.cancelReason).toBeUndefined();
    });

    it('should allow creating with all properties', () => {
      const items = [{ name: 'テストアイテム', quantity: 1, category: 'テストカテゴリ' }];
      const changes = { 
        before: { status: '進行中' },
        after: { status: '完了' }
      };
      const operationDetails: OperationDetails = {
        items: items,
        changes: changes,
        cancelReason: 'テスト完了'
      };

      expect(operationDetails.items).toEqual(items);
      expect(operationDetails.changes).toEqual(changes);
      expect(operationDetails.cancelReason).toBe('テスト完了');
    });
  });

  describe('OperationInfo interface', () => {
    it('should have operationType property', () => {
      const operationInfo: OperationInfo = {
        operationType: 'ADD_ITEM',
        actionName: 'アイテム追加'
      };

      expect(operationInfo).toHaveProperty('operationType');
      expect(typeof operationInfo.operationType).toBe('string');
      expect(operationInfo.operationType).toBe('ADD_ITEM');
    });

    it('should have actionName property', () => {
      const operationInfo: OperationInfo = {
        operationType: 'DELETE_ITEM',
        actionName: 'アイテム削除'
      };

      expect(operationInfo).toHaveProperty('actionName');
      expect(typeof operationInfo.actionName).toBe('string');
      expect(operationInfo.actionName).toBe('アイテム削除');
    });

    it('should require both operationType and actionName properties', () => {
      const operationInfo: OperationInfo = {
        operationType: 'EDIT_ITEM',
        actionName: 'アイテム編集'
      };

      expect(operationInfo.operationType).toBe('EDIT_ITEM');
      expect(operationInfo.actionName).toBe('アイテム編集');
    });

    it('should create OperationInfo with different operation types', () => {
      const addOperation: OperationInfo = {
        operationType: 'ADD',
        actionName: '追加操作'
      };

      const editOperation: OperationInfo = {
        operationType: 'EDIT',
        actionName: '編集操作'
      };

      const deleteOperation: OperationInfo = {
        operationType: 'DELETE',
        actionName: '削除操作'
      };

      expect(addOperation.operationType).toBe('ADD');
      expect(editOperation.operationType).toBe('EDIT');
      expect(deleteOperation.operationType).toBe('DELETE');
    });
  });
});