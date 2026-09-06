package domain

import (
	"math/big"
	"regexp"
	"strings"
)

// Quantity is an immutable nonnegative decimal. Its zero value is zero.
// Parsing canonicalizes leading/trailing zeros without changing numeric value
// or precision. Display scale is not part of this value object.
type Quantity struct{ value string }

var decimalPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)?$`)

func ParseQuantity(s string) (Quantity, error) {
	if !decimalPattern.MatchString(s) {
		return Quantity{}, Fail(CodeInvalidInput, "quantity", "Expected a nonnegative decimal")
	}
	parts := strings.SplitN(s, ".", 2)
	whole := strings.TrimLeft(parts[0], "0")
	if whole == "" {
		whole = "0"
	}
	if len(parts) == 2 {
		fraction := strings.TrimRight(parts[1], "0")
		if fraction != "" {
			whole += "." + fraction
		}
	}
	return Quantity{whole}, nil
}
func (q Quantity) String() string {
	if q.value == "" {
		return "0"
	}
	return q.value
}
func (q Quantity) parts() (*big.Int, int) {
	s := q.String()
	scale := 0
	if i := strings.IndexByte(s, '.'); i >= 0 {
		scale = len(s) - i - 1
		s = s[:i] + s[i+1:]
	}
	v, _ := new(big.Int).SetString(s, 10)
	return v, scale
}
func align(a, b Quantity) (*big.Int, *big.Int, int) {
	x, s := a.parts()
	y, t := b.parts()
	scale := s
	if t > scale {
		scale = t
	}
	ten := big.NewInt(10)
	if s < scale {
		x.Mul(x, new(big.Int).Exp(ten, big.NewInt(int64(scale-s)), nil))
	}
	if t < scale {
		y.Mul(y, new(big.Int).Exp(ten, big.NewInt(int64(scale-t)), nil))
	}
	return x, y, scale
}
func fromInteger(x *big.Int, scale int) Quantity {
	s := x.String()
	if scale > 0 {
		if len(s) <= scale {
			s = strings.Repeat("0", scale-len(s)+1) + s
		}
		s = s[:len(s)-scale] + "." + s[len(s)-scale:]
	}
	q, _ := ParseQuantity(s)
	return q
}
func (q Quantity) Compare(other Quantity) int { x, y, _ := align(q, other); return x.Cmp(y) }
func (q Quantity) Add(other Quantity) Quantity {
	x, y, s := align(q, other)
	return fromInteger(x.Add(x, y), s)
}
func (q Quantity) Subtract(other Quantity) (Quantity, error) {
	x, y, s := align(q, other)
	if x.Cmp(y) < 0 {
		return Quantity{}, Fail(CodeShortage, "quantity", "Insufficient inventory")
	}
	return fromInteger(x.Sub(x, y), s), nil
}
