package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotEnv(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	content := `# comment
DOTENV_PLAIN=abc
export DOTENV_EXPORTED = "quoted value"
DOTENV_SINGLE='x=y'
DOTENV_PRESET=from-file
DOTENV_EMPTY_PRESET=from-file
not a pair
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"DOTENV_PLAIN", "DOTENV_EXPORTED", "DOTENV_SINGLE"} {
		os.Unsetenv(k)
		t.Cleanup(func() { os.Unsetenv(k) })
	}
	t.Setenv("DOTENV_PRESET", "from-env")
	t.Setenv("DOTENV_EMPTY_PRESET", "")

	loadDotEnv(path)

	for k, want := range map[string]string{
		"DOTENV_PLAIN":        "abc",
		"DOTENV_EXPORTED":     "quoted value",
		"DOTENV_SINGLE":       "x=y",
		"DOTENV_PRESET":       "from-env", // existing env wins
		"DOTENV_EMPTY_PRESET": "",         // even when set to ""
	} {
		if got := os.Getenv(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}

	loadDotEnv(filepath.Join(t.TempDir(), "missing")) // no file: no-op
}
