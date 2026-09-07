package repository

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yone-k/yone-discord-bot/backend/internal/application"
)

// OutputLeadership uses a physical connection, never a pooled sql.Conn whose
// maximum lifetime could silently retire the session advisory lock.
type OutputLeadership struct{ databaseURL string }

func NewOutputLeadership(databaseURL string) *OutputLeadership {
	return &OutputLeadership{databaseURL: databaseURL}
}

func (l *OutputLeadership) Acquire(ctx context.Context) (application.OutputLease, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(connectCtx, l.databaseURL)
	if err != nil {
		return nil, err
	}
	var acquired bool
	if err = conn.QueryRow(connectCtx, "SELECT pg_try_advisory_lock(44001)").Scan(&acquired); err != nil || !acquired {
		_ = conn.Close(connectCtx)
		if err != nil {
			return nil, err
		}
		return nil, application.ErrOutputLeadershipBusy
	}
	leaseCtx, stop := context.WithCancel(ctx)
	lease := &outputLease{ctx: leaseCtx, cancel: stop, conn: conn, done: make(chan struct{})}
	go lease.watch()
	return lease, nil
}

type outputLease struct {
	ctx    context.Context
	cancel context.CancelFunc
	conn   *pgx.Conn
	done   chan struct{}
	once   sync.Once
}

func (l *outputLease) Context() context.Context { return l.ctx }

func (l *outputLease) watch() {
	defer close(l.done)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = l.conn.Close(ctx)
	}()
	defer l.cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-l.ctx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(l.ctx, time.Second)
			err := l.conn.Ping(ctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (l *outputLease) Close() error {
	l.once.Do(l.cancel)
	<-l.done
	return nil
}
