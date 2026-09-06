package application

// Optional preserves the distinction between an omitted patch field and a
// provided value. Nullable fields use Optional[*T].
type Optional[T any] struct {
	Present bool
	Value   T
}

func Some[T any](value T) Optional[T] { return Optional[T]{Present: true, Value: value} }
