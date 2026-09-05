-- Issue #36 初期スキーマ設計。PostgreSQL 18 / Bot専用DBのpublicスキーマ。
-- SQL適用履歴の記録とロールへのGRANTは運用CLIが行う。

CREATE TABLE list_channels (
    channel_id text PRIMARY KEY CHECK (channel_id ~ '^[0-9]+$'),
    message_id text CHECK (message_id ~ '^[0-9]+$'),
    list_title text NOT NULL CHECK (btrim(list_title) <> ''),
    default_category text NOT NULL DEFAULT 'その他' CHECK (btrim(default_category) <> ''),
    operation_log_thread_id text CHECK (operation_log_thread_id ~ '^[0-9]+$'),
    edit_version bigint NOT NULL DEFAULT 0 CHECK (edit_version >= 0)
);

CREATE TABLE inventory_channels (
    channel_id text PRIMARY KEY CHECK (channel_id ~ '^[0-9]+$'),
    message_id text CHECK (message_id ~ '^[0-9]+$'),
    list_title text NOT NULL CHECK (btrim(list_title) <> ''),
    default_category text NOT NULL DEFAULT 'その他' CHECK (btrim(default_category) <> ''),
    operation_log_thread_id text CHECK (operation_log_thread_id ~ '^[0-9]+$')
);

CREATE TABLE remind_channels (
    channel_id text PRIMARY KEY CHECK (channel_id ~ '^[0-9]+$'),
    message_id text CHECK (message_id ~ '^[0-9]+$'),
    list_title text NOT NULL CHECK (btrim(list_title) <> ''),
    operation_log_thread_id text CHECK (operation_log_thread_id ~ '^[0-9]+$'),
    remind_notice_thread_id text CHECK (remind_notice_thread_id ~ '^[0-9]+$'),
    remind_notice_message_id text CHECK (remind_notice_message_id ~ '^[0-9]+$'),
    linked_inventory_channel_id text,
    CONSTRAINT remind_channel_inventory_fk FOREIGN KEY (linked_inventory_channel_id)
        REFERENCES inventory_channels(channel_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT remind_channel_link_uq UNIQUE (channel_id, linked_inventory_channel_id)
);

CREATE TABLE list_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id text NOT NULL REFERENCES list_channels(channel_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    name text COLLATE "C" NOT NULL CHECK (btrim(name) <> ''),
    category text CHECK (category IS NULL OR btrim(category) <> ''),
    until date CHECK (isfinite(until)),
    is_completed boolean NOT NULL DEFAULT false,
    last_notified_at timestamptz(3) CHECK (isfinite(last_notified_at)),
    position integer NOT NULL CHECK (position >= 0),
    CONSTRAINT list_item_name_uq UNIQUE (channel_id, name),
    CONSTRAINT list_item_position_uq UNIQUE (channel_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE inventory_items (
    channel_id text NOT NULL REFERENCES inventory_channels(channel_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    id text COLLATE "C" NOT NULL DEFAULT gen_random_uuid()::text CHECK (btrim(id) <> ''),
    name text COLLATE "C" NOT NULL CHECK (btrim(name) <> ''),
    stock numeric NOT NULL DEFAULT 0 CHECK (stock >= 0 AND stock NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
    category text CHECK (category IS NULL OR btrim(category) <> ''),
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (channel_id, id),
    CONSTRAINT inventory_item_name_uq UNIQUE (channel_id, name),
    CONSTRAINT inventory_item_position_uq UNIQUE (channel_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE remind_tasks (
    channel_id text NOT NULL REFERENCES remind_channels(channel_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    id text COLLATE "C" NOT NULL DEFAULT gen_random_uuid()::text CHECK (btrim(id) <> ''),
    message_id text CHECK (message_id ~ '^[0-9]+$'),
    title text NOT NULL CHECK (btrim(title) <> ''),
    description text,
    interval_days integer NOT NULL CHECK (interval_days >= 1),
    time_of_day time(0) NOT NULL DEFAULT '00:00' CHECK (time_of_day < time '24:00' AND extract(second FROM time_of_day) = 0),
    remind_before_minutes integer NOT NULL DEFAULT 1440 CHECK (remind_before_minutes BETWEEN 0 AND 10080),
    start_at timestamptz(3) NOT NULL CHECK (isfinite(start_at)),
    next_due_at timestamptz(3) NOT NULL CHECK (isfinite(next_due_at)),
    last_done_at timestamptz(3) CHECK (isfinite(last_done_at)),
    last_remind_due_at timestamptz(3) CHECK (isfinite(last_remind_due_at)),
    overdue_notify_count integer NOT NULL DEFAULT 0 CHECK (overdue_notify_count >= 0),
    overdue_notify_limit integer CHECK (overdue_notify_limit >= 0),
    last_overdue_notified_at timestamptz(3) CHECK (isfinite(last_overdue_notified_at)),
    is_paused boolean NOT NULL DEFAULT false,
    created_at timestamptz(3) NOT NULL CHECK (isfinite(created_at)),
    updated_at timestamptz(3) NOT NULL CHECK (isfinite(updated_at)),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (channel_id, id),
    CONSTRAINT remind_task_message_uq UNIQUE (channel_id, message_id),
    CONSTRAINT remind_task_position_uq UNIQUE (channel_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE remind_task_inventory_items (
    task_channel_id text NOT NULL,
    task_id text COLLATE "C" NOT NULL,
    inventory_channel_id text NOT NULL,
    inventory_id text COLLATE "C" NOT NULL,
    consume numeric NOT NULL CHECK (consume >= 0 AND consume NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (task_channel_id, task_id, position),
    CONSTRAINT task_inventory_once_uq UNIQUE (task_channel_id, task_id, inventory_id),
    CONSTRAINT task_inventory_task_fk FOREIGN KEY (task_channel_id, task_id)
        REFERENCES remind_tasks(channel_id, id) ON UPDATE RESTRICT ON DELETE CASCADE,
    CONSTRAINT task_inventory_item_fk FOREIGN KEY (inventory_channel_id, inventory_id)
        REFERENCES inventory_items(channel_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT task_inventory_link_fk FOREIGN KEY (task_channel_id, inventory_channel_id)
        REFERENCES remind_channels(channel_id, linked_inventory_channel_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE schema_migrations (
    version integer PRIMARY KEY CHECK (version >= 1),
    checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP CHECK (isfinite(applied_at))
);

CREATE TABLE data_imports (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    schema_version integer NOT NULL REFERENCES schema_migrations(version) ON UPDATE RESTRICT ON DELETE RESTRICT,
    completed_at timestamptz(3) NOT NULL CHECK (isfinite(completed_at)),
    report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object')
);

CREATE INDEX list_due_idx ON list_items (until, channel_id)
    WHERE NOT is_completed AND until IS NOT NULL;
CREATE INDEX remind_linked_inventory_idx ON remind_channels (linked_inventory_channel_id)
    WHERE linked_inventory_channel_id IS NOT NULL;
CREATE INDEX remind_due_idx ON remind_tasks (channel_id, next_due_at)
    WHERE NOT is_paused AND message_id IS NOT NULL;
CREATE INDEX task_inventory_reverse_idx ON remind_task_inventory_items (inventory_channel_id, inventory_id);
