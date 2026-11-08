package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

// Setlist is a named, ordered collection of songs for a gig or event.
// Songs is an ordered list of song slugs (matching the filename without .txt).
type Setlist struct {
	Name  string   `json:"name"`
	Songs []string `json:"songs"`
}

// SetlistStore is the process-wide in-memory cache for setlists.
// One consolidated .setlists.json on disk (parallel to .song-meta.json).
type SetlistStore struct {
	mu    sync.RWMutex
	cache map[string]Setlist
}

var (
	setlistInstance *SetlistStore
	setlistOnce     sync.Once
)

// SetlistSingleton returns the shared store, initializing on first call.
func SetlistSingleton() *SetlistStore {
	setlistOnce.Do(func() {
		setlistInstance = &SetlistStore{cache: map[string]Setlist{}}
		setlistInstance.init()
	})
	return setlistInstance
}

// InitSetlists eagerly initializes the store at server startup.
func InitSetlists() { SetlistSingleton() }

func (s *SetlistStore) init() {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(SetlistsFilePath())
	if err != nil {
		// Fresh install: empty map; first write creates the file.
		return
	}
	var loaded map[string]Setlist
	if json.Unmarshal(data, &loaded) == nil && loaded != nil {
		s.cache = loaded
	}
}

// flushLocked writes the map to disk atomically. Caller must hold s.mu.
func (s *SetlistStore) flushLocked() error {
	data, err := json.MarshalIndent(s.cache, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(SetlistsFilePath(), data, 0644)
}

// Get returns the Setlist for a name, plus an ok flag.
func (s *SetlistStore) Get(name string) (Setlist, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sl, ok := s.cache[name]
	return sl, ok
}

// All returns a snapshot copy of every setlist keyed by name.
func (s *SetlistStore) All() map[string]Setlist {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Setlist, len(s.cache))
	for k, v := range s.cache {
		out[k] = v
	}
	return out
}

// Save upserts a setlist at sl.Name.
func (s *SetlistStore) Save(sl Setlist) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[sl.Name] = sl
	return s.flushLocked()
}

// SaveAndMaybeRename upserts at sl.Name. If oldName is non-empty and differs
// from sl.Name, the old key is deleted first (atomic rename).
func (s *SetlistStore) SaveAndMaybeRename(oldName string, sl Setlist) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if oldName != "" && oldName != sl.Name {
		delete(s.cache, oldName)
	}
	s.cache[sl.Name] = sl
	return s.flushLocked()
}

// Delete removes a setlist by name.
func (s *SetlistStore) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.cache[name]; !ok {
		return nil
	}
	delete(s.cache, name)
	return s.flushLocked()
}

// Restore merges incoming setlists into the store, preserving any keys
// not present in the upload. Used by RestoreSetlistsHandler so HTTP code
// doesn't reach inside the store's mutex.
func (s *SetlistStore) Restore(incoming map[string]Setlist) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range incoming {
		s.cache[k] = v
	}
	return s.flushLocked()
}

// RemoveSongFromAll drops references to songSlug from every setlist.
// Used as a cascade hook when a song is deleted from the library.
func (s *SetlistStore) RemoveSongFromAll(songSlug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for name, sl := range s.cache {
		filtered := sl.Songs[:0:0]
		for _, slug := range sl.Songs {
			if slug != songSlug {
				filtered = append(filtered, slug)
			}
		}
		if len(filtered) != len(sl.Songs) {
			sl.Songs = filtered
			s.cache[name] = sl
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return s.flushLocked()
}

// sanitizeSetlistName runs the same path-traversal guard as song names.
// Setlist names are arbitrary user strings but get used as JSON map keys
// and URL params — defense in depth.
func sanitizeSetlistName(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("empty setlist name")
	}
	if len(name) > 200 {
		return "", fmt.Errorf("setlist name too long")
	}
	return name, nil
}
