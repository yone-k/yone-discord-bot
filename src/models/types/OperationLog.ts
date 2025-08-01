/**
 * 操作結果を表すインターフェース
 */
export interface OperationResult {
  /** 操作が成功したかどうか */
  success: boolean;
  /** 操作に関するメッセージ（オプション） */
  message?: string;
  /** 操作中に発生したエラー（オプション） */
  error?: Error;
  /** 影響を受けたアイテム数（オプション） */
  affectedItems?: number;
}

/**
 * 操作の詳細情報を表すインターフェース
 */
export interface OperationDetails {
  /** 操作対象のアイテム一覧（オプション） */
  items?: Array<{
    name: string;
    quantity: number;
    category: string;
    until?: Date;
  }>;
  /** 操作前後の変更内容（オプション） */
  changes?: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  /** キャンセル理由（オプション） */
  cancelReason?: string;
}

/**
 * 操作情報を表すインターフェース
 */
export interface OperationInfo {
  /** 操作の種類 */
  operationType: string;
  /** アクション名 */
  actionName: string;
}