package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

type ListChannel struct{ ent.Schema }

func (ListChannel) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "list_channels"}}
}
func (ListChannel) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("channel_id").Immutable(),
		field.String("message_id").Optional().Nillable(),
		field.String("list_title"),
		field.String("operation_log_thread_id").Optional().Nillable(),
		field.String("default_category").Default("その他"),
		field.Int64("edit_version").Default(0),
	}
}
