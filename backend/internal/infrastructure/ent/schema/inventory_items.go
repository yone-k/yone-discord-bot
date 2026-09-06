package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type InventoryItem struct{ ent.Schema }

func (InventoryItem) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "inventory_items"}}
}
func (InventoryItem) Fields() []ent.Field {
	return []ent.Field{field.UUID("id", uuid.UUID{}).StorageKey("entity_id").Immutable(), field.String("legacy_id").StorageKey("id"), field.String("channel_id"), field.String("name"), field.String("stock").SchemaType(map[string]string{dialect.Postgres: "numeric"}), field.String("category").Optional().Nillable(), field.Int("position")}
}
