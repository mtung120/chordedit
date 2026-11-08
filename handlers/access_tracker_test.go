package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// newTestTracker builds an AccessTracker bound to a tmp file, bypassing the
// process-wide singleton so tests don't share state.
func newTestTracker(t *testing.T) *AccessTracker {
	t.Helper()
	return &AccessTracker{
		filePath: filepath.Join(t.TempDir(), ".access_times.json"),
		cache:    map[string]time.Time{},
	}
}

func TestAccessTracker_RecordAndRecent(t *testing.T) {
	at := newTestTracker(t)

	// Record three songs, sleeping briefly between so timestamps differ.
	for _, name := range []string{"alpha", "beta", "gamma"} {
		if err := at.RecordAccess(name); err != nil {
			t.Fatalf("RecordAccess(%s): %v", name, err)
		}
		time.Sleep(2 * time.Millisecond)
	}

	got := at.GetRecentSongs([]string{"alpha", "beta", "gamma"}, 10)
	want := []string{"gamma", "beta", "alpha"} // most recent first
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got %v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestAccessTracker_FiltersDeletedSongs(t *testing.T) {
	at := newTestTracker(t)
	for _, n := range []string{"alpha", "beta", "deleted-song"} {
		_ = at.RecordAccess(n)
	}
	got := at.GetRecentSongs([]string{"alpha", "beta"}, 10) // deleted-song not in valid list
	for _, name := range got {
		if name == "deleted-song" {
			t.Errorf("expected deleted-song to be filtered out, got %v", got)
		}
	}
}

func TestAccessTracker_PersistsToDisk(t *testing.T) {
	at := newTestTracker(t)
	if err := at.RecordAccess("alpha"); err != nil {
		t.Fatalf("RecordAccess: %v", err)
	}

	data, err := os.ReadFile(at.filePath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal: %v\n%s", err, data)
	}
	if _, ok := raw["alpha"]; !ok {
		t.Errorf("expected alpha in persisted file, got %v", raw)
	}
}

// TestAccessTracker_ConcurrentRecord exercises the lost-update race that the
// pre-singleton implementation hit. Without the RWMutex, this also fails
// `go test -race`. With it, all 1000 entries land in the cache.
func TestAccessTracker_ConcurrentRecord(t *testing.T) {
	at := newTestTracker(t)

	const goroutines = 50
	const perGoroutine = 20

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := 0; g < goroutines; g++ {
		go func(g int) {
			defer wg.Done()
			for i := 0; i < perGoroutine; i++ {
				if err := at.RecordAccess(fmt.Sprintf("song-%d-%d", g, i)); err != nil {
					t.Errorf("RecordAccess: %v", err)
					return
				}
			}
		}(g)
	}
	wg.Wait()

	at.mu.RLock()
	got := len(at.cache)
	at.mu.RUnlock()

	want := goroutines * perGoroutine
	if got != want {
		t.Errorf("cache size = %d, want %d (lost-update race)", got, want)
	}

	// And the on-disk file should reflect the same count after the final flush.
	data, err := os.ReadFile(at.filePath)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var raw map[string]string
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(raw) != want {
		t.Errorf("on-disk count = %d, want %d", len(raw), want)
	}
}
