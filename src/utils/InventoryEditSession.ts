import { randomUUID } from 'node:crypto';
import type { InventoryItem } from '../models/InventoryItem';
export class InventoryEditSession {
  static readonly shared = new InventoryEditSession();
  private readonly entries = new Map<string, {
        channelId: string;
        userId: string;
        expires: number;
        items: InventoryItem[];
    }>();
  constructor(private readonly ttl = 15 * 60000) { }
  open(channelId: string, userId: string, items: InventoryItem[], now = Date.now()): string {
    for (const [token, entry] of this.entries)
      if (entry.expires <= now)
        this.entries.delete(token);
    if (this.entries.size >= 100)
      this.entries.delete(this.entries.keys().next().value!);
    const token = randomUUID();
    this.entries.set(token, { channelId, userId, expires: now + this.ttl, items: items.map(item => ({ ...item })) });
    return token;
  }
  get(token: string, channelId: string, userId: string, now = Date.now()): InventoryItem[] {
    const entry = this.entries.get(token);
    if (!entry || entry.expires <= now) {
      this.entries.delete(token);
      throw new Error('編集画面の期限が切れています。開き直してください。');
    }
    if (entry.channelId !== channelId || entry.userId !== userId)
      throw new Error('この編集画面は使用できません。');
    return entry.items.map(item => ({ ...item }));
  }
  close(token: string): void { this.entries.delete(token); }
}
