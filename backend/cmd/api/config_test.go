package main

import (
	"strings"
	"testing"
)

func TestConfigRequiresLimitedDatabaseAndSharedToken(t *testing.T) {
	for _, tc := range []struct{ database, token string }{{"", ""}, {"postgres://test:test@localhost/test", ""}, {"", "token"}} {
		t.Setenv("DATABASE_URL", tc.database)
		t.Setenv("CORE_API_TOKEN", tc.token)
		if _, err := loadConfig(); err == nil {
			t.Fatal("accepted incomplete runtime configuration")
		}
	}
}

func TestConfigUsesUTCBoundedDatabaseConnections(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:test@localhost/test?timezone=Asia%2FTokyo")
	t.Setenv("CORE_API_TOKEN", "local-test-token")
	t.Setenv("MIGRATIONS_DIR", "")
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.RuntimeParams["timezone"] != "UTC" || cfg.Database.ConnectTimeout <= 0 || cfg.Migrations != "db/migrations" {
		t.Fatal("unexpected configuration")
	}
}

func TestConfigNeverReturnsDatabaseCredentialsInErrors(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test:private-credential@host:bad-port/db")
	t.Setenv("CORE_API_TOKEN", "local-test-token")
	_, err := loadConfig()
	if err == nil {
		t.Fatal("accepted invalid URL")
	}
	if strings.Contains(err.Error(), "private-credential") {
		t.Fatal("credential leak")
	}
}
