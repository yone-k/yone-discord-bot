package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

type RemindChannel struct{ ent.Schema }

func (RemindChannel) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "remind_channels"}}
}
func (RemindChannel) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("channel_id").Immutable(),
		field.String("message_id").Optional().Nillable(),
		field.String("list_title"),
		field.String("operation_log_thread_id").Optional().Nillable(),
		field.String("remind_notice_thread_id").Optional().Nillable(),
		field.String("remind_notice_message_id").Optional().Nillable(),
		field.String("linked_inventory_channel_id").Optional().Nillable(),
	}
}
