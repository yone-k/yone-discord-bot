package application

import (
	"context"
	"errors"
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

type taskMessageRepository struct {
	Repository
	task             *domain.RemindTask
	err              error
	channel, message string
	listed           bool
}

func (r *taskMessageRepository) Tasks(context.Context, string, bool) ([]domain.RemindTask, error) {
	r.listed = true
	return nil, errors.New("message lookup must not load all tasks")
}

func (r *taskMessageRepository) GetTaskByMessage(_ context.Context, channel, message string) (*domain.RemindTask, error) {
	r.channel, r.message = channel, message
	return r.task, r.err
}

func TestGetTaskByMessageUsesTargetedRepositoryLookup(t *testing.T) {
	message := "55"
	task := &domain.RemindTask{ID: "old opaque id", ChannelID: "3", MessageID: &message}
	repo := &taskMessageRepository{task: task}
	got, err := New(readStore{repo}, nil, nil).GetTaskByMessage(context.Background(), "3", message)
	if err != nil {
		t.Fatal(err)
	}
	if repo.listed || repo.channel != "3" || repo.message != message || got != task {
		t.Fatal("lookup did not preserve channel/message scope and repository result")
	}
}

func TestGetTaskByMessagePreservesNotFoundAndRepositoryFailures(t *testing.T) {
	for _, failure := range []error{nil, errors.New("database unavailable")} {
		repo := &taskMessageRepository{err: failure}
		_, err := New(readStore{repo}, nil, nil).GetTaskByMessage(context.Background(), "3", "55")
		if repo.listed {
			t.Fatal("message lookup loaded all tasks")
		}
		if failure != nil {
			if !errors.Is(err, failure) {
				t.Fatalf("repository error not preserved: %v", err)
			}
		} else {
			var business *domain.Error
			if !errors.As(err, &business) || business.Code != "not_found" || business.Target != "55" {
				t.Fatalf("missing message lookup changed: %v", err)
			}
		}
	}
}
