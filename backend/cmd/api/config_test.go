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
	t.Setenv("DISCORD_OUTPUT_ENABLED", "false")
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

func TestOutputConfiguration(t *testing.T) {
	for _, tc := range []struct {
		enabled, token string
		ok, active     bool
	}{
		{"", "bot-token", true, true}, {"true", "bot-token", true, true},
		{"false", "", true, false}, {"", "", false, false}, {"invalid", "bot-token", false, false},
	} {
		t.Run(tc.enabled+tc.token, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://test:test@localhost/test")
			t.Setenv("CORE_API_TOKEN", "api-token")
			t.Setenv("DISCORD_OUTPUT_ENABLED", tc.enabled)
			t.Setenv("DISCORD_BOT_TOKEN", tc.token)
			cfg, err := loadConfig()
			if (err == nil) != tc.ok {
				t.Fatalf("unexpected configuration result: %v", err)
			}
			if tc.ok && cfg.OutputEnabled != tc.active {
				t.Fatal("wrong output mode")
			}
		})
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
