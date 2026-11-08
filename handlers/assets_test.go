package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

// /static/ is served immutable, so an edited file must get a new ?v= on a
// running server — otherwise browsers keep the old copy for good.
func TestAssetURLChangesWhenTheFileChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "styles.css")
	t.Cleanup(func() { assetHashCache.Delete(path) })

	if err := os.WriteFile(path, []byte("a { color: red }"), 0o644); err != nil {
		t.Fatal(err)
	}
	first := assetURL(path)
	if again := assetURL(path); again != first {
		t.Fatalf("unchanged file: got %q then %q", first, again)
	}

	if err := os.WriteFile(path, []byte("a { color: blue; }"), 0o644); err != nil {
		t.Fatal(err)
	}
	if after := assetURL(path); after == first {
		t.Fatalf("after an edit: still %q, want a new version", after)
	}
}
