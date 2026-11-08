package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
)

// SongMeta is the consolidated per-song metadata.
// Audio file availability is NOT stored here — it's derived from disk
// at serve time based on AudioSource + the corresponding ID.
type SongMeta struct {
	Title             string             `json:"title,omitempty"`
	Tags              []string           `json:"tags,omitempty"`
	Artists           []string           `json:"artists,omitempty"` // from hopamchuan.com; home page filter only
	Metronome         *MetronomeSettings `json:"metronome,omitempty"`
	YoutubeVideoId    string             `json:"youtubeVideoId,omitempty"`
	YoutubeVideoTitle string             `json:"youtubeVideoTitle,omitempty"`
	AudioSource       string             `json:"audioSource,omitempty"`       // "youtube", "upload", or ""
	UploadedAudioId   string             `json:"uploadedAudioId,omitempty"`   // hash-based ID (upload only)
	UploadedAudioName string             `json:"uploadedAudioName,omitempty"` // original filename (upload only)
	VersionLabels     map[string]string  `json:"versionLabels,omitempty"`     // version number → custom label
	GuitarTab         string             `json:"guitarTab,omitempty"`         // filename of attached .gp file (in SongsDir)
	KeyOffset         int                `json:"keyOffset,omitempty"`         // semitones from the detected key to the real one (0–11); set in Edit
}

// songMetaResponse is the wire format returned by GetSongMetaHandler.
// It embeds SongMeta and adds audio fields derived from disk.
type SongMetaResponse struct {
	Title             string             `json:"title,omitempty"`
	Tags              []string           `json:"tags"`
	Metronome         *MetronomeSettings `json:"metronome,omitempty"`
	YoutubeVideoId    string             `json:"youtubeVideoId"`
	YoutubeVideoTitle string             `json:"youtubeVideoTitle"`
	AudioSource       string             `json:"audioSource"`
	UploadedAudioName string             `json:"uploadedAudioName"`
	FullMp3Audio      string             `json:"fullMp3Audio"`
	VocalAudio        string             `json:"vocalAudio"`
	InstrumentAudio   string             `json:"instrumentAudio"`
	VersionLabels     map[string]string  `json:"versionLabels"`
	GuitarTab         string             `json:"guitarTab"`
}

// songMetaPath is resolved at call time via SongMetaFilePath() so it
// follows the SONGS_DIR env var. Don't const-cache it: production reads
// from a path that doesn't exist at import time on a fresh instance.

// SongMetaStore is the process-wide, in-memory-cached owner of per-song metadata.
// It is loaded once from disk at startup (InitSongMeta) and flushed back on writes.
type SongMetaStore struct {
	mu    sync.RWMutex
	cache map[string]SongMeta
}

var (
	songMetaInstance *SongMetaStore
	songMetaOnce     sync.Once
)

// SongMetaSingleton returns the shared store, initializing on first call.
func SongMetaSingleton() *SongMetaStore {
	songMetaOnce.Do(func() {
		songMetaInstance = &SongMetaStore{cache: map[string]SongMeta{}}
		songMetaInstance.init()
	})
	return songMetaInstance
}

// InitSongMeta eagerly initializes the store at server startup so the first
// request doesn't pay the load cost.
func InitSongMeta() { SongMetaSingleton() }

func (s *SongMetaStore) init() {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(SongMetaFilePath())
	if err != nil {
		// Fresh install: start with an empty map; first write creates the file.
		return
	}
	var loaded map[string]SongMeta
	if json.Unmarshal(data, &loaded) == nil && loaded != nil {
		s.cache = loaded
	}
}

// flushLocked writes the in-memory map to disk atomically. Caller must hold s.mu.
func (s *SongMetaStore) flushLocked() error {
	data, err := json.MarshalIndent(s.cache, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(SongMetaFilePath(), data, 0644)
}

// ─── Public read/write API ───────────────────────────────────────────────────

// Get returns the SongMeta for a slug (zero value if absent).
func (s *SongMetaStore) Get(slug string) SongMeta {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache[slug]
}

// Update applies a mutator to the SongMeta for a slug and flushes to disk.
func (s *SongMetaStore) Update(slug string, fn func(*SongMeta)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.cache[slug]
	fn(&m)
	s.cache[slug] = m
	return s.flushLocked()
}

// Delete removes all metadata for a slug (called when a song is deleted).
func (s *SongMetaStore) Delete(slug string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cache, slug)
	return s.flushLocked()
}

// AllTitles returns slug→title for non-empty titles (used by the setlist page).
func (s *SongMetaStore) AllTitles() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.cache))
	for k, v := range s.cache {
		if v.Title != "" {
			out[k] = v.Title
		}
	}
	return out
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────

// GetSongMetaHandler handles GET /music/song-meta?songName=X
// Returns the full metadata plus audio availability derived from disk.
// Audio files are named by video ID, so multiple songs sharing the same
// video automatically share audio/stem files.
func GetSongMetaHandler(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("songName")
	if slug == "" {
		http.Error(w, "missing songName", http.StatusBadRequest)
		return
	}
	meta := SongMetaSingleton().Get(slug)

	metronome := meta.Metronome
	tags := meta.Tags
	if tags == nil {
		tags = []string{}
	}

	fullMp3, vocalAudio, instrumentAudio := songAudio(meta)

	versionLabels := meta.VersionLabels
	if versionLabels == nil {
		versionLabels = map[string]string{}
	}

	writeJSON(w, http.StatusOK, SongMetaResponse{
		Title:             meta.Title,
		Tags:              tags,
		Metronome:         metronome,
		YoutubeVideoId:    meta.YoutubeVideoId,
		YoutubeVideoTitle: meta.YoutubeVideoTitle,
		AudioSource:       meta.AudioSource,
		UploadedAudioName: meta.UploadedAudioName,
		FullMp3Audio:      fullMp3,
		VocalAudio:        vocalAudio,
		InstrumentAudio:   instrumentAudio,
		VersionLabels:     versionLabels,
		GuitarTab:         meta.GuitarTab,
	})
}

// audioSourceID returns the ID and audio/ subdirectory that name the song's
// audio files (<subdir>/<id>_{full,vocals,accompaniment}.mp3), or "" if the
// song has no audio source. IDs outside the video-ID charset are treated as
// absent since they become filenames.
func audioSourceID(meta SongMeta) (id, subdir string) {
	switch meta.AudioSource {
	case "youtube":
		id, subdir = meta.YoutubeVideoId, "youtube"
	case "upload":
		id, subdir = meta.UploadedAudioId, "upload"
	}
	if !validVideoID(id) {
		return "", ""
	}
	return id, subdir
}

// songAudio derives the song's audio files from disk, based on AudioSource:
// each is a path under the audio dir, or "" if the file doesn't exist.
func songAudio(meta SongMeta) (full, vocals, accomp string) {
	id, subdir := audioSourceID(meta)
	if id == "" {
		return "", "", ""
	}
	existing := func(suffix string) string {
		name := subdir + "/" + id + suffix
		if fileExists(AudioFileByName(name)) {
			return name
		}
		return ""
	}
	return existing("_full.mp3"), existing("_vocals.mp3"), existing("_accompaniment.mp3")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExportSongMetaHandler handles GET /music/export/song-meta
func ExportSongMetaHandler(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(SongMetaFilePath())
	if os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
		return
	}
	if err != nil {
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// SaveVersionLabelHandler handles POST /music/save-version-label
// Updates the custom label for a specific version of a song.
func SaveVersionLabelHandler(w http.ResponseWriter, r *http.Request) {
	var data struct {
		SongName string `json:"songName"`
		Version  int    `json:"version"`
		Label    string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if data.SongName == "" || data.Version < 1 {
		http.Error(w, "songName and version (>=1) are required", http.StatusBadRequest)
		return
	}
	if len(data.Label) > maxVersionLabelLen {
		http.Error(w, "label too long", http.StatusBadRequest)
		return
	}

	key := fmt.Sprintf("%d", data.Version)
	if err := SongMetaSingleton().Update(data.SongName, func(sm *SongMeta) {
		if data.Label == "" {
			delete(sm.VersionLabels, key)
		} else {
			if sm.VersionLabels == nil {
				sm.VersionLabels = map[string]string{}
			}
			sm.VersionLabels[key] = data.Label
		}
	}); err != nil {
		http.Error(w, "save error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

const maxVersionLabelLen = 100

// RestoreSongMetaHandler handles POST /music/restore/song-meta
// Merges the posted object into the existing store.
func RestoreSongMetaHandler(w http.ResponseWriter, r *http.Request) {
	var incoming map[string]SongMeta
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	store := SongMetaSingleton()
	store.mu.Lock()
	defer store.mu.Unlock()
	for k, v := range incoming {
		store.cache[k] = v
	}
	if err := store.flushLocked(); err != nil {
		http.Error(w, "save error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// SaveSongKeyHandler handles POST /music/save-song-key: the song's real key
// as an offset from the key detected from its chords (Edit's "Wrong key?
// Set it"). An offset, not a key, so it survives transposing the song and
// holds for every version. 0 clears it.
func SaveSongKeyHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SongName  string `json:"songName"`
		KeyOffset int    `json:"keyOffset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	songName, err := sanitizeSongName(body.SongName)
	if err != nil {
		http.Error(w, "invalid songName", http.StatusBadRequest)
		return
	}
	if body.KeyOffset < 0 || body.KeyOffset > 11 {
		http.Error(w, "keyOffset must be 0–11", http.StatusBadRequest)
		return
	}
	err = SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		sm.KeyOffset = body.KeyOffset
	})
	if err != nil {
		http.Error(w, "failed to save key", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
