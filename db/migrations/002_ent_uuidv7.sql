-- Internal entity identity changes only; existing Discord and business IDs remain stable.
ALTER TABLE remind_task_inventory_items DROP CONSTRAINT task_inventory_task_fk;
ALTER TABLE remind_task_inventory_items DROP CONSTRAINT task_inventory_item_fk;

ALTER TABLE inventory_items ADD COLUMN entity_id uuid NOT NULL DEFAULT uuidv7();
ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_pkey;
ALTER TABLE inventory_items ADD PRIMARY KEY (entity_id);
ALTER TABLE inventory_items ADD CONSTRAINT inventory_item_legacy_id_uq UNIQUE (channel_id, id);

ALTER TABLE remind_tasks ADD COLUMN entity_id uuid NOT NULL DEFAULT uuidv7();
ALTER TABLE remind_tasks DROP CONSTRAINT remind_tasks_pkey;
ALTER TABLE remind_tasks ADD PRIMARY KEY (entity_id);
ALTER TABLE remind_tasks ADD CONSTRAINT remind_task_legacy_id_uq UNIQUE (channel_id, id);

ALTER TABLE remind_task_inventory_items ADD COLUMN entity_id uuid NOT NULL DEFAULT uuidv7();
ALTER TABLE remind_task_inventory_items DROP CONSTRAINT remind_task_inventory_items_pkey;
ALTER TABLE remind_task_inventory_items ADD PRIMARY KEY (entity_id);
ALTER TABLE remind_task_inventory_items ADD CONSTRAINT task_inventory_legacy_position_uq UNIQUE (task_channel_id, task_id, position);
ALTER TABLE remind_task_inventory_items ADD CONSTRAINT task_inventory_task_fk
  FOREIGN KEY (task_channel_id, task_id) REFERENCES remind_tasks(channel_id, id) ON UPDATE RESTRICT ON DELETE CASCADE;
ALTER TABLE remind_task_inventory_items ADD CONSTRAINT task_inventory_item_fk
  FOREIGN KEY (inventory_channel_id, inventory_id) REFERENCES inventory_items(channel_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE list_items ALTER COLUMN id SET DEFAULT uuidv7();
