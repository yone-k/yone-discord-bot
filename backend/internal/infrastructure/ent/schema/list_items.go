package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type ListItem struct{ ent.Schema }

func (ListItem) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "list_items"}}
}
func (ListItem) Fields() []ent.Field {
	return []ent.Field{field.UUID("id", uuid.UUID{}).Immutable(), field.String("channel_id"), field.String("name"), field.String("category").Optional().Nillable(), field.Time("until").SchemaType(map[string]string{dialect.Postgres: "date"}).Optional().Nillable(), field.Bool("is_completed").Default(false), field.Time("last_notified_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}).Optional().Nillable(), field.Int("position")}
}
