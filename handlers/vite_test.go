package handlers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A rebuild renames the hashed bundles; a running server must pick up the
// new manifest instead of pointing pages at deleted files.
func TestViteScriptPicksUpRebuiltManifest(t *testing.T) {
	dir := t.TempDir()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(wd)
		viteMu.Lock()
		viteManifest, viteManifestErr, viteLoadedPath = nil, nil, ""
		viteMu.Unlock()
	})

	manifest := filepath.Join("static", "dist", ".vite", "manifest.json")
	if err := os.MkdirAll(filepath.Dir(manifest), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(file string) {
		t.Helper()
		body := `{"src/entries/song.ts":{"file":"` + file + `","src":"src/entries/song.ts"}}`
		if err := os.WriteFile(manifest, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("assets/song-AAAA.js")
	if got := string(viteScript("song")); !strings.Contains(got, "song-AAAA.js") {
		t.Fatalf("first build: got %q", got)
	}

	write("assets/song-BBBBBB.js") // new hash (and size) after a rebuild
	if got := string(viteScript("song")); !strings.Contains(got, "song-BBBBBB.js") {
		t.Fatalf("after rebuild: got %q, want the new bundle", got)
	}
}
