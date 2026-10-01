package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type NurseryMenu struct{ ent.Schema }

func (NurseryMenu) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "nursery_menus"}}
}
func (NurseryMenu) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Immutable(), field.Time("menu_date").SchemaType(map[string]string{dialect.Postgres: "date"}).Unique(),
		field.String("lunch").Default(""), field.String("snack").Default(""),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}), field.Time("updated_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}

// NurseryMenuSetting has exactly one row; SQL restricts its key to "nursery_menu".
type NurseryMenuSetting struct{ ent.Schema }

func (NurseryMenuSetting) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "nursery_menu_settings"}}
}
func (NurseryMenuSetting) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("key").Immutable(), field.String("channel_id"),
		field.Time("updated_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}),
	}
}
