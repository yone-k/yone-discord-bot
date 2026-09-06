package migration

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateRejectsNewerGappedAndChangedHistory(t *testing.T) {
	expected := []Migration{{Version: 1, Checksum: "one"}, {Version: 2, Checksum: "two"}}
	for name, applied := range map[string][]Migration{
		"newer database":        {{Version: 1, Checksum: "one"}, {Version: 2, Checksum: "two"}, {Version: 3, Checksum: "three"}},
		"missing first version": {{Version: 2, Checksum: "two"}},
		"gap":                   {{Version: 1, Checksum: "one"}, {Version: 3, Checksum: "three"}},
		"checksum changed":      {{Version: 1, Checksum: "changed"}},
	} {
		t.Run(name, func(t *testing.T) {
			if validate(applied, expected) == nil {
				t.Fatal("unsafe migration history accepted")
			}
		})
	}
	for _, applied := range [][]Migration{nil, expected[:1], expected} {
		if err := validate(applied, expected); err != nil {
			t.Fatalf("valid history rejected: %v", err)
		}
	}
}

func TestLoadRequiresContiguousVersionsAndExactBytes(t *testing.T) {
	d := t.TempDir()
	if err := os.WriteFile(filepath.Join(d, "001_first.sql"), []byte("SELECT 1;\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil {
		t.Fatal("missing version accepted")
	}
	if err := os.WriteFile(filepath.Join(d, "002_second.sql"), []byte("SELECT 2;\n"), 0600); err != nil {
		t.Fatal(err)
	}
	m, err := Load(d)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 2 || m[0].SQL != "SELECT 1;\n" || len(m[0].Checksum) != 64 {
		t.Fatal(m)
	}
	if err := os.WriteFile(filepath.Join(d, "003_extra.sql"), []byte("SELECT 3;"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(d); err == nil || !strings.Contains(err.Error(), "version") {
		t.Fatal("extra version accepted", err)
	}
}
