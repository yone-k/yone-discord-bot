import "@typespec/http";
import "@typespec/openapi";
using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Discord Core API" })
@info(#{ version: "1.0.0" })
@useAuth(Core.BearerAuth)
namespace Core;

@doc("Shared service token. The lowercase scheme is compatible with OpenAPI validators.")
model BearerAuth { type: AuthType.http; scheme: "bearer"; }

@doc("Arbitrary precision, unsigned decimal. Never convert through a binary float.")
@pattern("^[0-9]+(?:\\.[0-9]+)?$")
scalar Quantity extends string;
@doc("Opaque legacy business ID or Discord ID; never assume globally unique or UUID.")
scalar Id extends string;
@doc("Path representation of an ID. For '.', '..', an ID containing '/' or '%', or an ID starting with '~', use '~' followed by unpadded base64url of the UTF-8 ID. Otherwise use ordinary URI component encoding. JSON and query IDs retain their original values.")
scalar PathId extends string;
@pattern("^[0-9]+$")
scalar Revision extends string;
@pattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
scalar BusinessDate extends string;
@pattern("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
scalar BusinessTime extends string;
@doc("RFC3339 timestamp with exactly millisecond precision; business timezone is Asia/Tokyo.")
@pattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}(?:Z|[+-][0-9]{2}:[0-9]{2})$")
scalar Timestamp extends string;
@doc("List deadline (YYYY-MM-DD) or reminder deadline (RFC3339 with milliseconds). kind selects the applicable representation.")
@pattern("^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}(?:Z|[+-][0-9]{2}:[0-9]{2}))?$")
scalar NotificationDeadline extends string;
@minValue(1) scalar IntervalDays extends int32;
@minValue(0) @maxValue(10080) scalar ReminderMinutes extends int32;
@minValue(0) scalar NonnegativeInteger extends int32;

model ChannelSettings { channelId: Id; messageId: Id | null; listTitle: string; operationLogThreadId: Id | null; }
model ListChannel { ...ChannelSettings; defaultCategory: string; editVersion: Revision; }
model InventoryChannel { ...ChannelSettings; defaultCategory: string; }
model RemindChannel { ...ChannelSettings; remindNoticeThreadId: Id | null; remindNoticeMessageId: Id | null; linkedInventoryChannelId: Id | null; }
model ChannelPatch { messageId?: Id | null; listTitle?: string; operationLogThreadId?: Id | null; }
model ListChannelPatch { ...ChannelPatch; defaultCategory?: string; }
model InventoryChannelPatch { ...ChannelPatch; defaultCategory?: string; }
model RemindChannelPatch { ...ChannelPatch; remindNoticeThreadId?: Id | null; remindNoticeMessageId?: Id | null; }
model ListChannelInput { ...ChannelSettings; defaultCategory: string; }
model ListEditItem { name: string; category: string | null; until: BusinessDate | null; isCompleted: boolean; }
model StoredListItem { ...ListEditItem; id: Id; channelId: Id; lastNotifiedAt: Timestamp | null; position: NonnegativeInteger; }
model ListSnapshot { items: StoredListItem[]; editVersion: Revision; }
model SaveListInput { expectedVersion: Revision; items: ListEditItem[]; }
model InventoryItemInput { name: string; stock: Quantity; category: string | null; }
model InventoryEditItem {
  ...InventoryItemInput;
  @doc("Existing opaque ID.")
  @minLength(1)
  id: Id;
}
model StoredInventoryItem { ...InventoryEditItem; channelId: Id; position: NonnegativeInteger; }
model ApplyInventoryItem {
  ...InventoryItemInput;
  @doc("Omit for a new item; the server allocates UUIDv7. Otherwise identify an existing item.")
  @minLength(1)
  id?: Id;
}
model ApplyInventoryInput { expected: InventoryEditItem[]; items: ApplyInventoryItem[]; }
model BulkInventoryInput { items: InventoryEditItem[]; }
model ResolveInventoryInput { name: string; }
model ReorderInput { ids: Id[]; }
model InventoryConsumption { inventoryId: Id; consume: Quantity; }
model CreateTaskInput { title: string; description: string | null; intervalDays: IntervalDays; timeOfDay: BusinessTime; remindBeforeMinutes: ReminderMinutes; inventoryItems: InventoryConsumption[]; }
model StoredRemindTask {
  ...CreateTaskInput;
  channelId: Id; id: Id; messageId: Id | null;
  startAt: Timestamp; nextDueAt: Timestamp; lastDoneAt: Timestamp | null;
  lastRemindDueAt: Timestamp | null; overdueNotifyCount: NonnegativeInteger; overdueNotifyLimit: NonnegativeInteger | null;
  lastOverdueNotifiedAt: Timestamp | null; isPaused: boolean;
  createdAt: Timestamp; updatedAt: Timestamp; revision: Revision; position: NonnegativeInteger;
}
@doc("Setting lastDoneAt or nextDueAt resets lastRemindDueAt, overdueNotifyCount and lastOverdueNotifiedAt. lastDoneAt must not exceed nextDueAt; invalid overrides return 422 invalid_input.")
model TaskPatch {
  messageId?: Id | null; title?: string; description?: string | null;
  intervalDays?: IntervalDays; timeOfDay?: BusinessTime; remindBeforeMinutes?: ReminderMinutes;
  overdueNotifyLimit?: NonnegativeInteger | null;
  @doc("Explicit manual override from the task detail settings UI, not task completion.")
  lastDoneAt?: Timestamp | null;
  @doc("Explicit manual deadline override from the task detail settings UI.")
  nextDueAt?: Timestamp;
}
model PatchTaskInput { expectedRevision: Revision; patch: TaskPatch; }
model ExpectedRevisionInput { expectedRevision: Revision; }
@doc("Parsed completion entry. null means the user omitted a quantity; the server applies the stored consumption rules.")
model ConsumptionOverride { name: string; consume: Quantity | null; }
model CompleteTaskInput { expectedRevision: Revision; consumeOverrides?: ConsumptionOverride[]; }
model RemindInventoryEdit { name: string; stock?: Quantity; consume: Quantity; }
model EditTaskInventoryInput { expectedRevision: Revision; items: RemindInventoryEdit[]; }
model RemindInventoryEditResult { task: StoredRemindTask; inventoryChannelId: Id | null; stockChanged: boolean; }
model LinkInventoryInput { inventoryChannelId: Id | null; }
model Shortage { inventoryId: Id; name: string; required: Quantity; available: Quantity; }
model ShortageResult { shortages: Shortage[]; }
model TaskDisplay { channel: RemindChannel; task: StoredRemindTask; shortages: Shortage[]; }
model ListDisplay { channel: ListChannel; items: StoredListItem[]; }
model InventoryDisplay { channel: InventoryChannel; items: StoredInventoryItem[]; }
model Initialization { lists: ListDisplay[]; inventories: InventoryDisplay[]; reminders: TaskDisplay[]; remindChannels: RemindChannel[]; }
model NotificationToken {
  kind: "list" | "before" | "overdue"; channelId: Id; id: Id;
  evaluatedAt: Timestamp;
  @doc("BusinessDate for list notifications, Timestamp for reminder notifications.")
  targetDueAt: NotificationDeadline;
  @doc("null for list notifications; the captured task revision for reminders.")
  expectedRevision: Revision | null;
}
@doc("kind=list requires non-null list and item with null reminder. kind=before or overdue requires non-null reminder with null list and item. Reminder deadlines are timestamps and revisions are non-null; list deadlines are dates and revisions are null.")
model Notification {
  ...NotificationToken;
  list: ListDisplay | null; item: StoredListItem | null; reminder: TaskDisplay | null;
}
model ProgressUpdate { kind: "progress"; reminder: TaskDisplay; evaluatedAt: Timestamp; }
model NotificationPlan { evaluatedAt: Timestamp; notifications: Notification[]; progress: ProgressUpdate[]; }
model NotificationAckResult { item: StoredListItem | null; task: StoredRemindTask | null; }
model RequestOptions { @header("X-Core-Timeout-Ms") @minValue(1) @maxValue(5000) timeoutMs?: int32; }
model Health { ready: boolean; }
model ApiError {
  code: "invalid_input" | "not_found" | "conflict" | "shortage" | "referenced" | "unauthorized" | "unavailable" | "internal";
  @doc("duplicate_name distinguishes a duplicate name from other invalid_input failures. Inventory-add callers can skip that item and continue; other failures must not be silently skipped.")
  reason?: "duplicate_name";
  target?: string; channelId?: Id; id?: Id; shortages?: Shortage[]; references?: StoredRemindTask[];
}
@error model Failure { @statusCode status: 400 | 401 | 404 | 409 | 422 | 500 | 503; @body body: ApiError; }
model HealthUnavailable { @statusCode status: 503; @body body: Health; }
@route("/health") @get @useAuth(NoAuth) op health(): Health | HealthUnavailable;

@route("/v1/lists") @get op listListChannels(...RequestOptions): ListChannel[] | Failure;
@route("/v1/lists/{channelId}") @get op getListChannel(...RequestOptions, @path channelId: PathId): ListChannel | Failure;
@route("/v1/lists/{channelId}") @put op createListChannel(...RequestOptions, @path channelId: PathId, @body body: ListChannelInput): ListChannel | Failure;
@route("/v1/lists/{channelId}") @patch op patchListChannel(...RequestOptions, @path channelId: PathId, @body body: ListChannelPatch): ListChannel | Failure;
@route("/v1/lists/{channelId}") @delete op deleteListChannel(...RequestOptions, @path channelId: PathId): void | Failure;
@route("/v1/lists/{channelId}/items") @get op getListItems(...RequestOptions, @path channelId: PathId): StoredListItem[] | Failure;
@route("/v1/lists/{channelId}/snapshot") @get op getListSnapshot(...RequestOptions, @path channelId: PathId): ListSnapshot | Failure;
@route("/v1/lists/{channelId}/save") @post op saveList(...RequestOptions, @path channelId: PathId, @body body: SaveListInput): ListSnapshot | Failure;
@route("/v1/lists/{channelId}/items") @post op appendListItem(...RequestOptions, @path channelId: PathId, @body body: ListEditItem): StoredListItem | Failure;
@route("/v1/lists/{channelId}/items/{id}") @put op updateListItem(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: ListEditItem): StoredListItem | Failure;
@route("/v1/lists/{channelId}/items/{id}") @delete op deleteListItem(...RequestOptions, @path channelId: PathId, @path id: PathId): ListSnapshot | Failure;
@route("/v1/lists/{channelId}/reorder") @post op reorderList(...RequestOptions, @path channelId: PathId, @body body: ReorderInput): ListSnapshot | Failure;

@route("/v1/inventories") @get op listInventoryChannels(...RequestOptions): InventoryChannel[] | Failure;
@route("/v1/inventories/{channelId}") @get op getInventoryChannel(...RequestOptions, @path channelId: PathId): InventoryChannel | Failure;
@route("/v1/inventories/{channelId}") @put op createInventoryChannel(...RequestOptions, @path channelId: PathId, @body body: InventoryChannel): InventoryChannel | Failure;
@route("/v1/inventories/{channelId}") @patch op patchInventoryChannel(...RequestOptions, @path channelId: PathId, @body body: InventoryChannelPatch): InventoryChannel | Failure;
@route("/v1/inventories/{channelId}") @delete op deleteInventoryChannel(...RequestOptions, @path channelId: PathId): void | Failure;
@route("/v1/inventories/{channelId}/items") @get op getInventoryItems(...RequestOptions, @path channelId: PathId): StoredInventoryItem[] | Failure;
@route("/v1/inventories/{channelId}/items/{id}") @get op getInventoryItem(...RequestOptions, @path channelId: PathId, @path id: PathId): StoredInventoryItem | Failure;
@route("/v1/inventories/{channelId}/by-name") @get op getInventoryByName(...RequestOptions, @path channelId: PathId, @query name: string): StoredInventoryItem | Failure;
@route("/v1/inventories/{channelId}/items") @post op appendInventoryItem(...RequestOptions, @path channelId: PathId, @body body: InventoryItemInput): StoredInventoryItem | Failure;
@route("/v1/inventories/{channelId}/items/{id}") @put op updateInventoryItem(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: InventoryItemInput): StoredInventoryItem | Failure;
@route("/v1/inventories/{channelId}/bulk") @post op bulkUpdateInventory(...RequestOptions, @path channelId: PathId, @body body: BulkInventoryInput): StoredInventoryItem[] | Failure;
@route("/v1/inventories/{channelId}/apply") @post op applyInventory(...RequestOptions, @path channelId: PathId, @body body: ApplyInventoryInput): StoredInventoryItem[] | Failure;
@route("/v1/inventories/{channelId}/items/{id}") @delete op deleteInventoryItem(...RequestOptions, @path channelId: PathId, @path id: PathId): StoredInventoryItem[] | Failure;
@route("/v1/inventories/{channelId}/reorder") @post op reorderInventory(...RequestOptions, @path channelId: PathId, @body body: ReorderInput): StoredInventoryItem[] | Failure;
@route("/v1/inventories/{channelId}/resolve") @post op resolveInventory(...RequestOptions, @path channelId: PathId, @body body: ResolveInventoryInput): StoredInventoryItem | Failure;
@route("/v1/inventories/{channelId}/linked-reminders") @get op getLinkedReminders(...RequestOptions, @path channelId: PathId): RemindChannel[] | Failure;
@route("/v1/inventories/{channelId}/items/{id}/references") @get op getInventoryReferences(...RequestOptions, @path channelId: PathId, @path id: PathId): StoredRemindTask[] | Failure;
@route("/v1/inventories/{channelId}/related-tasks") @get op getRelatedTasks(...RequestOptions, @path channelId: PathId): TaskDisplay[] | Failure;

@route("/v1/reminders") @get op listRemindChannels(...RequestOptions): RemindChannel[] | Failure;
@route("/v1/reminders/{channelId}") @get op getRemindChannel(...RequestOptions, @path channelId: PathId): RemindChannel | Failure;
@route("/v1/reminders/{channelId}") @put op createRemindChannel(...RequestOptions, @path channelId: PathId, @body body: RemindChannel): RemindChannel | Failure;
@route("/v1/reminders/{channelId}") @patch op patchRemindChannel(...RequestOptions, @path channelId: PathId, @body body: RemindChannelPatch): RemindChannel | Failure;
@route("/v1/reminders/{channelId}") @delete op deleteRemindChannel(...RequestOptions, @path channelId: PathId): void | Failure;
@route("/v1/reminders/{channelId}/inventory-link") @put op linkInventory(...RequestOptions, @path channelId: PathId, @body body: LinkInventoryInput): RemindChannel | Failure;
@route("/v1/reminders/{channelId}/tasks") @get op getTasks(...RequestOptions, @path channelId: PathId): StoredRemindTask[] | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}") @get op getTask(...RequestOptions, @path channelId: PathId, @path id: PathId): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/by-message") @get op getTaskByMessage(...RequestOptions, @path channelId: PathId, @query messageId: Id): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks") @post op createTask(...RequestOptions, @path channelId: PathId, @body body: CreateTaskInput): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}") @patch op patchTask(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: PatchTaskInput): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}/pause") @post op pauseTask(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: ExpectedRevisionInput): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}/resume") @post op resumeTask(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: ExpectedRevisionInput): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}/inventory-settings") @post op editTaskInventory(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: EditTaskInventoryInput): RemindInventoryEditResult | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}") @delete op deleteTask(...RequestOptions, @path channelId: PathId, @path id: PathId): void | Failure;
@route("/v1/reminders/{channelId}/reorder") @post op reorderTasks(...RequestOptions, @path channelId: PathId, @body body: ReorderInput): StoredRemindTask[] | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}/complete") @post op completeTask(...RequestOptions, @path channelId: PathId, @path id: PathId, @body body: CompleteTaskInput): StoredRemindTask | Failure;
@route("/v1/reminders/{channelId}/tasks/{id}/shortage-check") @get op checkTaskShortage(...RequestOptions, @path channelId: PathId, @path id: PathId): ShortageResult | Failure;

@route("/v1/display/initialization") @get op getInitialization(...RequestOptions): Initialization | Failure;
@route("/v1/notifications/poll") @post op pollNotifications(...RequestOptions): NotificationPlan | Failure;
@route("/v1/notifications/ack") @post op ackNotification(...RequestOptions, @body body: NotificationToken): NotificationAckResult | Failure;
