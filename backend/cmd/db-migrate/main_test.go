package main

import (
	"context"
	"strings"
	"testing"
)

func TestRejectsUnknownArgumentsBeforeConnecting(t *testing.T) {
	for _, args := range [][]string{{"--force"}, {"--check", "--check"}, {"--check", "extra"}} {
		if err := run(context.Background(), args); err == nil || !strings.Contains(err.Error(), "usage") {
			t.Fatal(args, err)
		}
	}
}

func TestRequiresRoleForApplyAndAdminURLForCheck(t *testing.T) {
	t.Setenv("DATABASE_ADMIN_URL", "")
	if err := run(context.Background(), []string{"--check"}); err == nil || !strings.Contains(err.Error(), "DATABASE_ADMIN_URL is required") {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_ADMIN_URL", "postgresql://localhost/test")
	t.Setenv("DATABASE_BOT_ROLE", "")
	if err := run(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "DATABASE_BOT_ROLE is required") {
		t.Fatal(err)
	}
}

func TestInvalidConfigurationDoesNotLeakCredentials(t *testing.T) {
	t.Setenv("DATABASE_ADMIN_URL", "postgresql://user:secret%xx@localhost/test")
	if err := run(context.Background(), []string{"--check"}); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatal(err)
	}
}
