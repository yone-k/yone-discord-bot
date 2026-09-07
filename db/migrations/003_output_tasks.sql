-- Discord side effects are reserved in the same transaction as business writes.
-- These records deliberately do not reference business rows with cascading FKs.
CREATE TABLE operation_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id text NOT NULL,
  actor_id text NOT NULL,
  operation_kind text NOT NULL,
  success boolean NOT NULL,
  occurred_at timestamptz NOT NULL,
  facts jsonb NOT NULL,
  interaction_id text UNIQUE
);

CREATE TABLE output_tasks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('list_render','inventory_render','task_card','reminder_notice','list_deadline_notice','operation_log','delete_all','thread_ensure')),
  target_id text NOT NULL,
  operation_id uuid REFERENCES operation_records(id),
  payload jsonb NOT NULL,
  destination_key text NOT NULL,
  dedup_key text UNIQUE,
  output_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  state text NOT NULL CHECK (state IN ('pending','running','retry_wait','uncertain','blocked','succeeded','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  executor text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX output_tasks_pending_card_uq ON output_tasks(channel_id,kind,target_id)
  WHERE state='pending' AND kind IN ('list_render','inventory_render','task_card')
    AND COALESCE(payload->>'MessageID','')='';
CREATE INDEX output_tasks_due_idx ON output_tasks(available_at,output_order)
  WHERE state IN ('pending','retry_wait');
CREATE INDEX output_tasks_destination_idx ON output_tasks(channel_id,destination_key,output_order)
  WHERE state NOT IN ('succeeded','cancelled');
CREATE INDEX output_tasks_creation_hold_idx ON output_tasks(channel_id,output_order)
  WHERE payload @> '{"HoldCreation":true}'::jsonb;

CREATE TABLE output_dispatches (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  task_id uuid NOT NULL REFERENCES output_tasks(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  nonce text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('unknown','succeeded','failed')),
  discord_message_id text NOT NULL DEFAULT '',
  UNIQUE(task_id,attempt)
);
CREATE INDEX output_dispatches_unknown_idx ON output_dispatches(task_id) WHERE outcome='unknown';

CREATE TABLE channel_output_suspensions (
  channel_id text PRIMARY KEY,
  suspended_at timestamptz NOT NULL,
  suspended_by text NOT NULL
);

CREATE TABLE discord_card_views (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  channel_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('task','inventory')),
  target_id text NOT NULL,
  mode text NOT NULL,
  page integer NOT NULL CHECK (page >= 0),
  view_version bigint NOT NULL CHECK (view_version > 0),
  UNIQUE(channel_id,target_kind,target_id),
  CHECK (mode='normal' OR (target_kind='task' AND mode='update_selection') OR (target_kind='inventory' AND mode='delete_selection'))
);
