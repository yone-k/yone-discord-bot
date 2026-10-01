-- One nursery's menu per Tokyo calendar day; an empty entry omits that section.
CREATE TABLE nursery_menus (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  menu_date date NOT NULL UNIQUE,
  lunch text NOT NULL DEFAULT '',
  snack text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (lunch <> '' OR snack <> ''),
  CHECK (char_length(lunch) <= 1000),
  CHECK (char_length(snack) <= 1000)
);

-- The daily post goes to at most one channel: the fixed key admits one row.
CREATE TABLE nursery_menu_settings (
  key text PRIMARY KEY DEFAULT 'nursery_menu' CHECK (key = 'nursery_menu'),
  channel_id text NOT NULL,
  updated_at timestamptz NOT NULL
);

ALTER TABLE output_tasks DROP CONSTRAINT output_tasks_kind_check;
ALTER TABLE output_tasks ADD CONSTRAINT output_tasks_kind_check
  CHECK (kind IN ('list_render','inventory_render','task_card','reminder_notice','list_deadline_notice','operation_log','delete_all','thread_ensure','nursery_menu_notice'));
