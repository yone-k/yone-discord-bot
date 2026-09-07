package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

var _ application.OutputQueue = (*repository)(nil)

// Used only by scheduling/recovery transactions. Business writers do not take
// this lock, so it cannot invert the business parent-to-outbox lock order.
func (r *repository) LockOutputQueue(ctx context.Context) error {
	_, err := r.tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(44002)")
	return err
}

// Outbox SQL shares r.tx with ent business writes. Explicit ON CONFLICT clauses
// express the partial card index and preserve a successor for running work.
func (r *repository) PutOperation(ctx context.Context, op application.OperationRecord) (bool, error) {
	facts, err := json.Marshal(op.Facts)
	if err != nil {
		return false, err
	}
	result, err := r.tx.ExecContext(ctx, `INSERT INTO operation_records(id,channel_id,actor_id,operation_kind,success,occurred_at,facts,interaction_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')) ON CONFLICT(interaction_id) DO NOTHING`, op.ID, op.ChannelID, op.ActorID, op.Kind, op.Success, op.OccurredAt, facts, op.InteractionID)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n == 1, err
}

func (r *repository) GetOperation(ctx context.Context, id string) (*application.OperationRecord, error) {
	var op application.OperationRecord
	var facts []byte
	err := r.tx.QueryRowContext(ctx, `SELECT id,channel_id,actor_id,operation_kind,success,occurred_at,facts,COALESCE(interaction_id,'') FROM operation_records WHERE id=$1`, id).
		Scan(&op.ID, &op.ChannelID, &op.ActorID, &op.Kind, &op.Success, &op.OccurredAt, &facts, &op.InteractionID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(facts, &op.Facts); err != nil {
		return nil, err
	}
	op.OccurredAt = op.OccurredAt.UTC()
	return &op, nil
}

func (r *repository) EnqueueOutput(ctx context.Context, task application.OutputTask) (string, error) {
	payload, err := json.Marshal(task.Payload)
	if err != nil {
		return "", err
	}
	var dedup any
	if n := task.Payload.Notification; n != nil {
		key, err := json.Marshal([]string{task.ChannelID, string(task.Kind), task.TargetID, n.Kind, n.TargetDueAt, n.NotificationDay})
		if err != nil {
			return "", err
		}
		dedup = string(key)
	}
	conflict := `ON CONFLICT(dedup_key) DO UPDATE SET dedup_key=EXCLUDED.dedup_key`
	if task.State == application.OutputPending && task.Payload.MessageID == "" && (task.Kind == application.OutputListRender || task.Kind == application.OutputInventoryRender || task.Kind == application.OutputTaskCard) {
		conflict = `ON CONFLICT(channel_id,kind,target_id) WHERE state='pending' AND kind IN ('list_render','inventory_render','task_card') AND COALESCE(payload->>'MessageID','')=''
		DO UPDATE SET updated_at=EXCLUDED.updated_at,
		payload=EXCLUDED.payload || jsonb_build_object('PinMessage', COALESCE((output_tasks.payload->>'PinMessage')::boolean,false) OR COALESCE((EXCLUDED.payload->>'PinMessage')::boolean,false)),
		operation_id=EXCLUDED.operation_id`
	}
	var id string
	err = r.tx.QueryRowContext(ctx, `INSERT INTO output_tasks(id,channel_id,kind,target_id,operation_id,payload,destination_key,dedup_key,state,attempts,available_at,executor,last_error,created_at,updated_at)
		VALUES($1,$2,$3,$4,NULLIF($5,'')::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) `+conflict+` RETURNING id`,
		task.ID, task.ChannelID, task.Kind, task.TargetID, task.OperationID, payload, task.DestinationKey, dedup, task.State, task.Attempts, task.AvailableAt, task.Executor, task.LastError, task.CreatedAt, task.UpdatedAt).Scan(&id)
	return id, err
}

const outputColumns = `id,channel_id,kind,target_id,COALESCE(operation_id::text,''),payload,destination_key,output_order,state,attempts,available_at,executor,last_error,created_at,updated_at`

type outputScanner interface{ Scan(...any) error }

func scanOutput(row outputScanner) (*application.OutputTask, error) {
	var task application.OutputTask
	var payload []byte
	err := row.Scan(&task.ID, &task.ChannelID, &task.Kind, &task.TargetID, &task.OperationID, &payload, &task.DestinationKey, &task.Order, &task.State, &task.Attempts, &task.AvailableAt, &task.Executor, &task.LastError, &task.CreatedAt, &task.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(payload, &task.Payload); err != nil {
		return nil, err
	}
	task.AvailableAt, task.CreatedAt, task.UpdatedAt = task.AvailableAt.UTC(), task.CreatedAt.UTC(), task.UpdatedAt.UTC()
	return &task, nil
}

func (r *repository) GetOutput(ctx context.Context, id string, lock bool) (*application.OutputTask, error) {
	query := `SELECT ` + outputColumns + ` FROM output_tasks WHERE id=$1`
	if lock {
		query += ` FOR UPDATE`
	}
	return scanOutput(r.tx.QueryRowContext(ctx, query, id))
}

func (r *repository) ListOutputs(ctx context.Context, filter application.OutputFilter) ([]application.OutputTask, error) {
	query := `SELECT ` + outputColumns + ` FROM output_tasks WHERE TRUE`
	args := []any{}
	if filter.ActiveOnly {
		query += ` AND (state NOT IN ('succeeded','cancelled') OR payload @> '{"HoldCreation":true}'::jsonb)`
	}
	if filter.ClaimableAt != nil {
		args = append(args, *filter.ClaimableAt, filter.AfterOrder)
		query += ` AND state IN ('pending','retry_wait') AND available_at <= $1 AND output_order > $2
			AND NOT EXISTS (SELECT 1 FROM output_tasks busy WHERE busy.channel_id=output_tasks.channel_id AND busy.state='running')
			AND NOT EXISTS (SELECT 1 FROM output_tasks prior WHERE prior.channel_id=output_tasks.channel_id
				AND prior.destination_key=output_tasks.destination_key AND prior.output_order<output_tasks.output_order
				AND prior.state NOT IN ('succeeded','cancelled'))`
	}
	if filter.ChannelID != "" {
		args = append(args, filter.ChannelID)
		query += fmt.Sprintf(` AND channel_id=$%d`, len(args))
	}
	if len(filter.States) > 0 {
		placeholders := make([]string, len(filter.States))
		for i, state := range filter.States {
			args = append(args, state)
			placeholders[i] = fmt.Sprintf("$%d", len(args))
		}
		query += ` AND state IN (` + strings.Join(placeholders, ",") + `)`
	}
	query += ` ORDER BY output_order`
	if filter.Limit > 0 {
		args = append(args, filter.Limit)
		query += fmt.Sprintf(` LIMIT $%d`, len(args))
	}
	if filter.ClaimableAt != nil {
		// Coalescing must finish before this snapshot, or enqueue a successor
		// after the claim commits; it must not overwrite a stale pending payload.
		query += ` FOR UPDATE`
	}
	rows, err := r.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []application.OutputTask{}
	for rows.Next() {
		task, err := scanOutput(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *task)
	}
	return result, rows.Err()
}

func (r *repository) OutputCounts(ctx context.Context) (map[application.OutputState]int, error) {
	rows, err := r.tx.QueryContext(ctx, `SELECT state,count(*) FROM output_tasks GROUP BY state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[application.OutputState]int{}
	for rows.Next() {
		var state application.OutputState
		var count int
		if err := rows.Scan(&state, &count); err != nil {
			return nil, err
		}
		counts[state] = count
	}
	return counts, rows.Err()
}

func (r *repository) PriorUnresolvedCreation(ctx context.Context, channel string, order int64) (string, error) {
	var id string
	err := r.tx.QueryRowContext(ctx, `SELECT id FROM (
		SELECT id,output_order FROM output_tasks WHERE channel_id=$1 AND output_order<$2 AND payload @> '{"HoldCreation":true}'::jsonb
		UNION
		SELECT task.id,task.output_order FROM output_dispatches dispatch JOIN output_tasks task ON task.id=dispatch.task_id
		WHERE dispatch.outcome='unknown' AND task.channel_id=$1 AND task.output_order<$2
	) held ORDER BY output_order LIMIT 1`, channel, order).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (r *repository) HasUnresolvedDestinationCreation(ctx context.Context, channel, destination string) (bool, error) {
	var held bool
	err := r.tx.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM output_tasks WHERE channel_id=$1 AND destination_key=$2 AND state='uncertain'
		UNION ALL
		SELECT 1 FROM output_tasks WHERE channel_id=$1 AND destination_key=$2 AND state='cancelled'
			AND payload @> '{"HoldCreation":true}'::jsonb
	)`, channel, destination).Scan(&held)
	return held, err
}

func (r *repository) PutOutput(ctx context.Context, task application.OutputTask) error {
	payload, err := json.Marshal(task.Payload)
	if err != nil {
		return err
	}
	result, err := r.tx.ExecContext(ctx, `UPDATE output_tasks SET payload=$2,state=$3,attempts=$4,available_at=$5,executor=$6,last_error=$7,updated_at=$8 WHERE id=$1`, task.ID, payload, task.State, task.Attempts, task.AvailableAt, task.Executor, task.LastError, task.UpdatedAt)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return errors.New("output task does not exist")
	}
	return err
}

func (r *repository) PutDispatch(ctx context.Context, d application.OutputDispatch) error {
	_, err := r.tx.ExecContext(ctx, `INSERT INTO output_dispatches(id,task_id,attempt,nonce,started_at,finished_at,outcome,discord_message_id)
	VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET finished_at=EXCLUDED.finished_at,outcome=EXCLUDED.outcome,discord_message_id=EXCLUDED.discord_message_id`,
		d.ID, d.TaskID, d.Attempt, d.Nonce, d.StartedAt, d.FinishedAt, d.Outcome, d.DiscordMessageID)
	return err
}

func (r *repository) OutputDispatches(ctx context.Context, id string) ([]application.OutputDispatch, error) {
	rows, err := r.tx.QueryContext(ctx, `SELECT id,task_id,attempt,nonce,started_at,finished_at,outcome,discord_message_id FROM output_dispatches WHERE task_id=$1 ORDER BY attempt`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []application.OutputDispatch{}
	for rows.Next() {
		var d application.OutputDispatch
		if err := rows.Scan(&d.ID, &d.TaskID, &d.Attempt, &d.Nonce, &d.StartedAt, &d.FinishedAt, &d.Outcome, &d.DiscordMessageID); err != nil {
			return nil, err
		}
		d.StartedAt, d.FinishedAt = d.StartedAt.UTC(), utcPtr(d.FinishedAt)
		result = append(result, d)
	}
	return result, rows.Err()
}

func (r *repository) GetSuspension(ctx context.Context, channel string) (*application.OutputSuspension, error) {
	var stop application.OutputSuspension
	err := r.tx.QueryRowContext(ctx, `SELECT channel_id,suspended_at,suspended_by FROM channel_output_suspensions WHERE channel_id=$1`, channel).Scan(&stop.ChannelID, &stop.SuspendedAt, &stop.SuspendedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	stop.SuspendedAt = stop.SuspendedAt.UTC()
	return &stop, nil
}

func (r *repository) PutSuspension(ctx context.Context, stop application.OutputSuspension) error {
	_, err := r.tx.ExecContext(ctx, `INSERT INTO channel_output_suspensions(channel_id,suspended_at,suspended_by) VALUES($1,$2,$3)
	ON CONFLICT(channel_id) DO UPDATE SET suspended_at=EXCLUDED.suspended_at,suspended_by=EXCLUDED.suspended_by`, stop.ChannelID, stop.SuspendedAt, stop.SuspendedBy)
	return err
}

func (r *repository) ListSuspensions(ctx context.Context) ([]application.OutputSuspension, error) {
	rows, err := r.tx.QueryContext(ctx, `SELECT channel_id,suspended_at,suspended_by FROM channel_output_suspensions ORDER BY channel_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []application.OutputSuspension{}
	for rows.Next() {
		var stop application.OutputSuspension
		if err := rows.Scan(&stop.ChannelID, &stop.SuspendedAt, &stop.SuspendedBy); err != nil {
			return nil, err
		}
		stop.SuspendedAt = stop.SuspendedAt.UTC()
		result = append(result, stop)
	}
	return result, rows.Err()
}

func (r *repository) DeleteSuspension(ctx context.Context, channel string) error {
	_, err := r.tx.ExecContext(ctx, `DELETE FROM channel_output_suspensions WHERE channel_id=$1`, channel)
	return err
}

func (r *repository) GetCardView(ctx context.Context, channel string, kind application.CardTarget, target string) (*application.CardView, error) {
	var view application.CardView
	err := r.tx.QueryRowContext(ctx, `SELECT channel_id,target_kind,target_id,mode,page,view_version FROM discord_card_views WHERE channel_id=$1 AND target_kind=$2 AND target_id=$3`, channel, kind, target).
		Scan(&view.ChannelID, &view.TargetKind, &view.TargetID, &view.Mode, &view.Page, &view.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &view, nil
}

func (r *repository) PutCardView(ctx context.Context, view application.CardView) (application.CardView, error) {
	err := r.tx.QueryRowContext(ctx, `INSERT INTO discord_card_views(channel_id,target_kind,target_id,mode,page,view_version) VALUES($1,$2,$3,$4,$5,1)
	ON CONFLICT(channel_id,target_kind,target_id) DO UPDATE SET mode=EXCLUDED.mode,page=EXCLUDED.page,view_version=discord_card_views.view_version+1 RETURNING view_version`,
		view.ChannelID, view.TargetKind, view.TargetID, view.Mode, view.Page).Scan(&view.Version)
	return view, err
}

func (r *repository) DeleteCardView(ctx context.Context, channel string, kind application.CardTarget, target string) error {
	_, err := r.tx.ExecContext(ctx, `DELETE FROM discord_card_views WHERE channel_id=$1 AND target_kind=$2 AND target_id=$3`, channel, kind, target)
	return err
}
