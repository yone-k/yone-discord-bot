package application

import (
	"context"
	"errors"
	"time"
)

const OutputContract = "go-discord-output-v1"

var ErrOutputLeadershipBusy = errors.New("another process owns Discord output")

type OutputKind string

const (
	OutputListRender         OutputKind = "list_render"
	OutputInventoryRender    OutputKind = "inventory_render"
	OutputTaskCard           OutputKind = "task_card"
	OutputReminderNotice     OutputKind = "reminder_notice"
	OutputListDeadlineNotice OutputKind = "list_deadline_notice"
	OutputOperationLog       OutputKind = "operation_log"
	OutputDeleteAll          OutputKind = "delete_all"
	OutputThreadEnsure       OutputKind = "thread_ensure"
)

type OutputState string

const (
	OutputPending   OutputState = "pending"
	OutputRunning   OutputState = "running"
	OutputRetryWait OutputState = "retry_wait"
	OutputUncertain OutputState = "uncertain"
	OutputBlocked   OutputState = "blocked"
	OutputSucceeded OutputState = "succeeded"
	OutputCancelled OutputState = "cancelled"
)

type DispatchOutcome string

const (
	DispatchUnknown   DispatchOutcome = "unknown"
	DispatchSucceeded DispatchOutcome = "succeeded"
	DispatchFailed    DispatchOutcome = "failed"
)

type CardTarget string
type CardMode string

const (
	CardTask            CardTarget = "task"
	CardInventory       CardTarget = "inventory"
	CardNormal          CardMode   = "normal"
	CardUpdateSelection CardMode   = "update_selection"
	CardDeleteSelection CardMode   = "delete_selection"
)

type CardView struct {
	ChannelID, TargetID string
	TargetKind          CardTarget
	Mode                CardMode
	Page                int
	Version             int64
}

type OperationRecord struct {
	ID, ChannelID, ActorID, InteractionID string
	Kind                                  OperationKind
	Success                               bool
	OccurredAt                            time.Time
	Facts                                 OperationFacts
}

// Facts are captured at business commit time, not at eventual delivery time.
// Legacy changes retain field order in their encoded JSON representation.
type OperationFacts struct {
	Message                   string
	CancelReason              string
	Added, Removed            []LogItem
	Modified                  []LogItemChange
	LegacyBefore, LegacyAfter string
}

type LogItem struct {
	Name, Category string
	Until          *time.Time
	Check          bool
}

type LogItemChange struct {
	Name                                        string
	Before, After                               LogItem
	CheckPresent, CategoryPresent, UntilPresent bool
}

type OutputTask struct {
	ID, ChannelID, TargetID, OperationID, DestinationKey string
	Kind                                                 OutputKind
	State                                                OutputState
	Order                                                int64
	Attempts                                             int
	AvailableAt, CreatedAt, UpdatedAt                    time.Time
	Executor, LastError                                  string
	Payload                                              OutputPayload
}

// Compound creations persist one stage per logical side effect. The first
// dispatch supplies the stable nonce; retries have independent dispatch rows.
type OutputStage struct {
	Name, DestinationID, MessageID, FirstDispatchID string
	CurrentDispatchID                               string
	Done                                            bool
}

type OutputPayload struct {
	Stages           []OutputStage
	DestinationID    string // fixed destination for an operation recorded earlier
	MessageID        string // fixed cleanup ID; kept separately from redraw reservations
	ThreadPurpose    string
	ChannelKind      string
	AllowCreate      bool
	HoldCreation     bool // cancelled output still has unresolved creation evidence
	Restored         bool // a backup may predate an already delivered creation
	PinMessage       bool
	DependencyTaskID string
	Notification     *OutputNotification
	Deletion         *DeleteProgress
}

type OutputNotification struct {
	Kind, TargetDueAt, ExpectedRevision, NotificationDay string
	EvaluatedAt                                          time.Time
}

type DeleteProgress struct {
	UpperID, BeforeID                      string
	Pages                                  int
	FetchedIDs, ConfirmedIDs, RemainingIDs []string
	FirstAttemptFinished                   bool
	ScanFinished                           bool
}

type OutputDispatch struct {
	ID, TaskID, Nonce, DiscordMessageID string
	Attempt                             int
	StartedAt                           time.Time
	FinishedAt                          *time.Time
	Outcome                             DispatchOutcome
}

type OutputSuspension struct {
	ChannelID, SuspendedBy string
	SuspendedAt            time.Time
}

type OutputFilter struct {
	ChannelID  string
	States     []OutputState
	Limit      int
	ActiveOnly bool
	// ClaimableAt selects and locks candidates in the scheduling write transaction.
	ClaimableAt *time.Time
	AfterOrder  int64
}

// OutputQueue is implemented by the repository bound to Store.Write/Read.
// Enqueue coalesces pending card updates only; a running card keeps its successor.
type OutputQueue interface {
	LockOutputQueue(context.Context) error
	PutOperation(context.Context, OperationRecord) (bool, error)
	GetOperation(context.Context, string) (*OperationRecord, error)
	EnqueueOutput(context.Context, OutputTask) (string, error)
	GetOutput(context.Context, string, bool) (*OutputTask, error)
	ListOutputs(context.Context, OutputFilter) ([]OutputTask, error)
	OutputCounts(context.Context) (map[OutputState]int, error)
	PriorUnresolvedCreation(context.Context, string, int64) (string, error)
	HasUnresolvedDestinationCreation(context.Context, string, string) (bool, error)
	PutOutput(context.Context, OutputTask) error
	PutDispatch(context.Context, OutputDispatch) error
	OutputDispatches(context.Context, string) ([]OutputDispatch, error)
	GetSuspension(context.Context, string) (*OutputSuspension, error)
	ListSuspensions(context.Context) ([]OutputSuspension, error)
	PutSuspension(context.Context, OutputSuspension) error
	DeleteSuspension(context.Context, string) error
	GetCardView(context.Context, string, CardTarget, string) (*CardView, error)
	PutCardView(context.Context, CardView) (CardView, error)
	DeleteCardView(context.Context, string, CardTarget, string) error
}

// Leadership owns a dedicated session, independent of the transaction pool.
// A cancelled lease context prohibits starting another Discord call.
type OutputLeadership interface {
	Acquire(context.Context) (OutputLease, error)
}

type OutputLease interface {
	Context() context.Context
	Close() error
}

// DisplayComponent is a transport-neutral rendering tree. The Discord adapter
// maps this to REST JSON; domain aggregates never contain these types.
type DisplayComponent struct {
	Kind                               string
	Text, CustomID, Label, Placeholder string
	Emoji                              string
	Style                              int
	MinValues, MaxValues               int
	Options                            []DisplayOption
	Children                           []DisplayComponent
}

type DisplayOption struct {
	Label, Value, Description string
}

type DisplayMessage struct {
	Content    string
	Components []DisplayComponent
}

type DiscordMessage struct {
	ID, ChannelID, AuthorID, Nonce string
	AuthorIsBot                    bool
	CreatedAt                      time.Time
}

type DiscordThread struct {
	ID, ParentID, OwnerID string
	Type                  int
	Archived              bool
}

type DiscordGateway interface {
	CreateMessage(context.Context, string, DisplayMessage, string) (DiscordMessage, error)
	EditMessage(context.Context, string, string, DisplayMessage) error
	DeleteMessage(context.Context, string, string) error
	BulkDeleteMessages(context.Context, string, []string) error
	GetMessage(context.Context, string, string) (DiscordMessage, error)
	ListMessages(context.Context, string, string, int) ([]DiscordMessage, error)
	CreateThread(context.Context, string, string, string) (DiscordThread, error)
	GetThread(context.Context, string) (DiscordThread, error)
	UnarchiveThread(context.Context, string) error
	PinMessage(context.Context, string, string) error
}

type DiscordFailureKind string

const (
	DiscordRateLimited    DiscordFailureKind = "rate_limited"
	DiscordRejected       DiscordFailureKind = "rejected"
	DiscordUnknownMessage DiscordFailureKind = "unknown_message"
	DiscordUnknownChannel DiscordFailureKind = "unknown_channel"
	DiscordIndeterminate  DiscordFailureKind = "indeterminate"
)

type DiscordFailure struct {
	Kind       DiscordFailureKind
	RetryAfter time.Duration
	Code       int
	HTTPStatus int
}

func (e *DiscordFailure) Error() string { return "Discord output: " + string(e.Kind) }
