package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

type InventoryChannel struct{ ent.Schema }

func (InventoryChannel) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "inventory_channels"}}
}
func (InventoryChannel) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("channel_id").Immutable(),
		field.String("message_id").Optional().Nillable(),
		field.String("list_title"),
		field.String("operation_log_thread_id").Optional().Nillable(),
		field.String("default_category").Default("その他"),
	}
}
