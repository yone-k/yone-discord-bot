package application

import "github.com/yone-k/yone-discord-bot/backend/internal/domain"

// OperationError carries safe business details for clients to present in their
// own language; the wrapped domain error still determines the failure kind.
type OperationError struct {
	Cause      error
	Shortages  []domain.Shortage
	References []domain.RemindTask
}

func (e *OperationError) Error() string { return e.Cause.Error() }
func (e *OperationError) Unwrap() error { return e.Cause }
