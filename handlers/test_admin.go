package handlers

import (
	"net/http"
	"os"
	"sync"
	"time"
)

// CHORDEDIT_TEST_MODE=1 enables the /music/__test__/reload-state endpoint
// (see RegisterTestAdmin). Production deploys NEVER set this env var. The
// endpoint exists solely so the Playwright per-worker fixture can flush
// in-memory singletons (AccessTracker, SongMetaStore, SetlistStore) between
// tests after it wipes the on-disk seed files.
//
// Without this, the singletons cache stale state across tests in the same
// worker even though the disk is reset each time.
var testModeOnce sync.Once
var testModeEnabled bool

func testModeOn() bool {
	testModeOnce.Do(func() {
		testModeEnabled = os.Getenv("CHORDEDIT_TEST_MODE") == "1"
	})
	return testModeEnabled
}

// ReloadStateHandler flushes the in-memory caches of all singletons that
// shadow on-disk state. Returns 404 unless CHORDEDIT_TEST_MODE=1.
func ReloadStateHandler(w http.ResponseWriter, r *http.Request) {
	if !testModeOn() {
		http.NotFound(w, r)
		return
	}

	// Replace the singletons' caches with fresh state read from disk.
	// We don't replace the singleton instances themselves (other goroutines
	// hold references); we mutate the cache map under the existing lock.
	at := AccessTrackerSingleton()
	at.mu.Lock()
	at.cache = map[string]time.Time{}
	at.mu.Unlock()
	at.init() // re-reads from disk; init takes its own lock

	store := SongMetaSingleton()
	store.mu.Lock()
	store.cache = map[string]SongMeta{}
	store.mu.Unlock()
	store.init() // re-reads from disk

	sl := SetlistSingleton()
	sl.mu.Lock()
	sl.cache = map[string]Setlist{}
	sl.mu.Unlock()
	sl.init() // re-reads from disk

	w.WriteHeader(http.StatusNoContent)
}
