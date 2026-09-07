package application

import (
	"testing"

	"github.com/yone-k/yone-discord-bot/backend/internal/domain"
)

func TestDisplayQuantityRoundingPreservesStoredPrecision(t *testing.T) {
	for _, tc := range []struct{ input, want string }{
		{"0", "0"}, {"1.250", "1.3"}, {"1.24999999999999999999", "1.2"},
		{"9.95", "10"}, {"0.00000000000000000001", "0"},
		{"999999999999999999999999999999.95", "1000000000000000000000000000000"},
	} {
		t.Run(tc.input, func(t *testing.T) {
			quantity, err := domain.ParseQuantity(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			before := quantity.String()
			if got := formatDisplayQuantity(quantity); got != tc.want {
				t.Fatalf("want %s got %s", tc.want, got)
			}
			if quantity.String() != before {
				t.Fatal("rendering changed stored quantity")
			}
		})
	}
}
