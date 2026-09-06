package application

import "testing"

func TestOptionalDistinguishesOmittedAndExplicitNull(t *testing.T) {
	omitted := Optional[*string]{}
	clear := Some[*string](nil)
	value := "message"
	set := Some(&value)
	if omitted.Present || !clear.Present || clear.Value != nil || !set.Present || *set.Value != value {
		t.Fatal("patch must distinguish omitted, explicit null, and assigned values")
	}
}
