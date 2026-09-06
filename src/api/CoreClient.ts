import { AsyncLocalStorage } from 'node:async_hooks';
import type { components } from './generated/schema';
import { formatDecimal, subtractDecimal, compareDecimal } from '../utils/Decimal';
import { readCoreApiConfig } from '../utils/config';

export type CoreErrorCode = 'conflict' | 'not_found' | 'shortage' | 'invalid_input' | 'referenced' | 'unavailable' | 'unauthorized' | 'internal';
const messages: Record<CoreErrorCode, string> = {
  conflict: '他の操作で内容が更新されました。画面を開き直してください。',
  not_found: '対象が見つかりません。画面を開き直してください。',
  shortage: '在庫が不足しています。',
  invalid_input: '入力内容を確認してください。',
  referenced: '他の項目から参照されているため変更できません。',
  unavailable: 'バックエンドに接続できません。しばらくしてから画面を開き直してください。',
  unauthorized: 'バックエンドの認証に失敗しました。管理者にお問い合わせください。',
  internal: '処理中にエラーが発生しました。画面を開き直してください。'
};

export class CoreApiError extends Error {
  constructor(public readonly code: CoreErrorCode, public readonly status: number,
    public readonly uncertain = false, public readonly details?: components['schemas']['ApiError']) {
    super(uncertain ? '更新結果を確認できません。再実行する前にデータを再取得するか、画面を開き直してください。' : errorMessage(code, details));
    this.name = 'CoreApiError';
  }
}

function errorMessage(code: CoreErrorCode, details?: components['schemas']['ApiError']): string {
  if (code === 'invalid_input' && details?.reason === 'duplicate_name') return '同名のアイテムが既に存在します';
  if (code === 'invalid_input') {
    switch (details?.target) {
    case 'quantity': return '数量は0以上の数値で入力してください。';
    case 'lastDoneAt': return '前回完了日時を確認してください。';
    case 'nextDueAt': return '次回期限を確認してください。';
    }
  }
  if (code === 'referenced' && details?.references?.length) {
    return `${messages[code]}\n${details.references.map(task => `- ${task.channelId}: ${task.title}`).join('\n')}`;
  }
  if (code === 'shortage' && details?.shortages?.length) {
    return `${messages[code]}\n${details.shortages.map(item => `${item.name}: ${formatDecimal(compareDecimal(item.required, item.available) > 0 ? subtractDecimal(item.required, item.available) : '0')}個不足`).join('\n')}`;
  }
  return messages[code];
}

// A preparation workflow shares one deadline across all API calls before showing a modal.
const deadlines = new AsyncLocalStorage<{ deadline: number; acknowledged?: () => boolean }>();
export function withApiDeadline<T>(milliseconds: number, operation: () => Promise<T>): Promise<T> {
  return deadlines.run({ deadline: Math.min(deadlines.getStore()?.deadline ?? Infinity, Date.now() + milliseconds) }, operation);
}
export function withInteractionDeadline<T>(interaction: { deferred?: boolean; replied?: boolean } | undefined, operation: () => Promise<T>): Promise<T> {
  return deadlines.run({ deadline: Date.now() + 2000, acknowledged: () => !interaction || Boolean(interaction.deferred || interaction.replied) }, operation);
}

export class CoreClient {
  constructor(private readonly baseUrl: string, private readonly token: string,
    private readonly fetcher: typeof fetch = fetch) {}

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<T> {
    const workflow = deadlines.getStore();
    const deadline = workflow?.acknowledged?.() ? Infinity : workflow?.deadline ?? Infinity;
    const remaining = Math.floor(Math.min(5000, timeoutMs, deadline - Date.now()));
    if (!Number.isFinite(remaining) || remaining < 1) throw new CoreApiError('unavailable', 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const writing = !['GET', 'HEAD'].includes(method);
    try {
      const response = await this.fetcher(new URL(path, this.baseUrl), {
        method, signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-Core-Timeout-Ms': String(Math.floor(remaining)) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code = payload && typeof payload === 'object' && 'code' in payload ? payload.code : undefined;
        const safeCode: CoreErrorCode = typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code) ? code as CoreErrorCode
          : response.status === 401 ? 'unauthorized' : response.status === 503 ? 'unavailable' : 'internal';
        const details = payload && typeof payload === 'object' && code === safeCode
          ? payload as components['schemas']['ApiError'] : undefined;
        throw new CoreApiError(safeCode, response.status, writing && response.status >= 500, details);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof CoreApiError) throw error;
      throw new CoreApiError('unavailable', 0, writing);
    } finally { clearTimeout(timer); }
  }

  async assertReady(): Promise<void> {
    const result = await this.request<{ ready: boolean }>('GET', '/health');
    if (!result.ready) throw new CoreApiError('unavailable', 503);
  }
}

export function coreClient(): CoreClient {
  const { coreApiUrl, coreApiToken } = readCoreApiConfig();
  return new CoreClient(coreApiUrl, coreApiToken);
}
