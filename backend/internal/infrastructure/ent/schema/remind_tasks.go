package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type RemindTask struct{ ent.Schema }

func (RemindTask) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "remind_tasks"}}
}
func (RemindTask) Fields() []ent.Field {
	return []ent.Field{field.UUID("id", uuid.UUID{}).StorageKey("entity_id").Immutable(), field.String("legacy_id").StorageKey("id"), field.String("channel_id"), field.String("message_id").Optional().Nillable(), field.String("title"), field.String("description").Optional().Nillable(), field.Int("interval_days"), field.String("time_of_day").SchemaType(map[string]string{dialect.Postgres: "time(0)"}), field.Int("remind_before_minutes"), field.Time("start_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}), field.Time("next_due_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}), field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}), field.Time("updated_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}), field.Time("last_done_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}).Optional().Nillable(), field.Time("last_remind_due_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}).Optional().Nillable(), field.Time("last_overdue_notified_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz(3)"}).Optional().Nillable(), field.Int("overdue_notify_count").Default(0), field.Int("overdue_notify_limit").Optional().Nillable(), field.Bool("is_paused").Default(false), field.Int64("revision").Default(0), field.Int("position")}
}
