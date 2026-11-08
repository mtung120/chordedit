package handlers

import (
	"encoding/json"
	"os"
	"sort"
	"sync"
	"time"
)

// AccessTracker is the process-wide owner of per-song last-access timestamps.
// The map is loaded once from .access_times.json (path follows SONGS_DIR via
// AccessTimesFilePath) and held in memory; writes go through atomicWriteFile
// so a crash mid-flush can't truncate the file.
//
// Mirrors the SongMetaStore pattern (see song_meta.go) — singleton + RWMutex.
// The previous implementation read-modify-wrote the file on every page view
// with no synchronization, which raced under concurrent access.
type AccessTracker struct {
	filePath string
	mu       sync.RWMutex
	cache    map[string]time.Time
}

var (
	accessTrackerInstance *AccessTracker
	accessTrackerOnce     sync.Once
)

// AccessTrackerSingleton returns the shared tracker, initializing on first call.
func AccessTrackerSingleton() *AccessTracker {
	accessTrackerOnce.Do(func() {
		accessTrackerInstance = &AccessTracker{
			filePath: AccessTimesFilePath(),
			cache:    map[string]time.Time{},
		}
		accessTrackerInstance.init()
	})
	return accessTrackerInstance
}

// InitAccessTracker eagerly initializes the tracker at server startup so the
// first request doesn't pay the load cost.
func InitAccessTracker() { AccessTrackerSingleton() }

func (at *AccessTracker) init() {
	at.mu.Lock()
	defer at.mu.Unlock()
	data, err := os.ReadFile(at.filePath)
	if err != nil {
		// Fresh install: empty cache; first write creates the file.
		return
	}
	var raw map[string]string
	if json.Unmarshal(data, &raw) != nil {
		return
	}
	for name, ts := range raw {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			at.cache[name] = t
		}
	}
}

// flushLocked writes the in-memory cache to disk atomically. Caller must hold at.mu.
func (at *AccessTracker) flushLocked() error {
	raw := make(map[string]string, len(at.cache))
	for name, t := range at.cache {
		raw[name] = t.Format(time.RFC3339)
	}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(at.filePath, data, 0644)
}

// RecordAccess stamps a song with the current time and persists.
func (at *AccessTracker) RecordAccess(songName string) error {
	at.mu.Lock()
	defer at.mu.Unlock()
	at.cache[songName] = time.Now()
	return at.flushLocked()
}

// GetRecentSongs returns up to `limit` song names ordered most-recent first.
// Stale entries (songs that no longer exist on disk) are filtered out via
// validNames. Returns an empty slice if no access history exists.
func (at *AccessTracker) GetRecentSongs(validNames []string, limit int) []string {
	at.mu.RLock()
	defer at.mu.RUnlock()
	if len(at.cache) == 0 {
		return nil
	}

	valid := make(map[string]bool, len(validNames))
	for _, n := range validNames {
		valid[n] = true
	}

	type entry struct {
		name string
		t    time.Time
	}
	entries := make([]entry, 0, len(at.cache))
	for name, t := range at.cache {
		if !valid[name] {
			continue // stale access-time for a deleted song
		}
		entries = append(entries, entry{name, t})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].t.After(entries[j].t)
	})

	if limit > 0 && len(entries) > limit {
		entries = entries[:limit]
	}

	result := make([]string, len(entries))
	for i, e := range entries {
		result[i] = e.name
	}
	return result
}
