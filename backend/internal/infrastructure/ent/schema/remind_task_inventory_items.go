package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type RemindTaskInventoryItem struct{ ent.Schema }

func (RemindTaskInventoryItem) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "remind_task_inventory_items"}}
}
func (RemindTaskInventoryItem) Fields() []ent.Field {
	return []ent.Field{field.UUID("id", uuid.UUID{}).StorageKey("entity_id").Immutable(), field.String("task_channel_id"), field.String("task_id"), field.String("inventory_channel_id"), field.String("inventory_id"), field.String("consume").SchemaType(map[string]string{dialect.Postgres: "numeric"}), field.Int("position")}
}
