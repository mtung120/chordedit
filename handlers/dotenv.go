package handlers

import (
	"bufio"
	"log"
	"os"
	"strings"
)

// loadDotEnv sets environment variables from a local, gitignored .env file
// (KEY=VALUE lines; blank lines and # comments skipped; optional matching
// quotes around the value). Dev convenience only: production gets its env
// from systemd (/etc/chordedit/env) and ships no .env. Variables that are
// already set — even to "" — win, so the test harness's explicit
// YOUTUBE_API_KEY="" still disables search.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // no .env: nothing to do
	}
	defer f.Close()

	n := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		if !ok || key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		}
		if _, set := os.LookupEnv(key); set {
			continue
		}
		os.Setenv(key, value)
		n++
	}
	if n > 0 {
		log.Printf("loaded %d variable(s) from %s", n, path)
	}
}
