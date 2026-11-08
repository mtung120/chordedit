package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

type SongPageData struct {
	SongName string // slug
	Title    string // display title
	Content  string
	Version  int // 0 = default, 1+ = version N
	// Semitones from the key detected from the chords to the song's real
	// key (SongMeta.KeyOffset); 0 when detection is right.
	KeyOffset int
}

var multiNewline = regexp.MustCompile(`\n{3,}`)

// maxSongUploadBytes caps the size of any user-supplied song body. 1 MiB is
// roughly 1000 pages of typical song lyrics — orders of magnitude more than
// any real song. The bound prevents a 1 GB body from buffering and writing.
const maxSongUploadBytes = 1 << 20

// maxTitleLen caps display titles. Titles bloat the consolidated
// .song-meta.json file when they're large; 200 chars covers any realistic
// song title (incl. long Vietnamese phrasing) without wasting space.
const maxTitleLen = 200

// sanitizeSongName lives in songs_dir.go (it's a path-helper, colocated
// with SongsDir / SongFilePath / etc.). Kept available to the rest of
// this file via package-level access.

func GetSongViewPage(w http.ResponseWriter, r *http.Request) {
	songName, err := sanitizeSongName(r.URL.Query().Get("songName"))
	if err != nil {
		http.Error(w, "Bad request: missing or invalid songName parameter", http.StatusBadRequest)
		return
	}

	// Parse version query param (0 = default)
	version := 0
	if vStr := r.URL.Query().Get("v"); vStr != "" {
		v, err := strconv.Atoi(vStr)
		if err != nil || v < 0 {
			http.Error(w, "Bad request: invalid version parameter", http.StatusBadRequest)
			return
		}
		version = v
	}

	// Record that this song was accessed (unless it's a raw download)
	if r.URL.Query().Get("raw") != "true" {
		if err := AccessTrackerSingleton().RecordAccess(songName); err != nil {
			log.Printf("access tracker: %v", err)
		}
	}

	// Read the file from disk (version-aware)
	filePath := SongVersionFilePath(songName, version)
	content, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Song version not found", http.StatusNotFound)
		} else {
			http.Error(w, fmt.Sprintf("Internal server error: Can't read file: %v", err), http.StatusInternalServerError)
		}
		return
	}

	// Check if raw text is requested
	if r.URL.Query().Get("raw") == "true" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")

		// Clean up extra blank lines - replace 2+ consecutive newlines with single newline
		cleanedContent := cleanBlankLines(string(content))
		w.Write([]byte(cleanedContent))
		return
	}

	meta := SongMetaSingleton().Get(songName)
	title := meta.Title
	if title == "" {
		title = songName
	}

	data := SongPageData{
		SongName:  songName,
		Title:     title,
		Content:   string(content),
		Version:   version,
		KeyOffset: meta.KeyOffset,
	}

	renderHTML(w, data, TemplatePath("song.html"))
}

func SaveChords(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSongUploadBytes)

	var data struct {
		SongName string `json:"songName"`
		Content  string `json:"content"`
		Version  int    `json:"version"`
	}

	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	songName, err := sanitizeSongName(data.SongName)
	if err != nil {
		http.Error(w, "Invalid song name", http.StatusBadRequest)
		return
	}

	// Write the updated content to the version-aware file path
	filePath := SongVersionFilePath(songName, data.Version)
	if err := atomicWriteFile(filePath, []byte(cleanBlankLines(data.Content)), 0644); err != nil {
		http.Error(w, "Failed to save changes", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func DeleteSong(w http.ResponseWriter, r *http.Request) {
	songName, err := sanitizeSongName(r.URL.Query().Get("songName"))
	if err != nil {
		http.Error(w, "Bad request: missing or invalid songName parameter", http.StatusBadRequest)
		return
	}

	filePath := SongFilePath(songName)
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Song not found", http.StatusNotFound)
		} else {
			http.Error(w, "Failed to delete song", http.StatusInternalServerError)
		}
		return
	}

	// Also remove all version files (best-effort)
	if versions, err := ListVersionNumbers(songName); err == nil {
		for _, v := range versions {
			_ = os.Remove(SongVersionFilePath(songName, v))
		}
	}

	// Clean up all metadata for the deleted song (best-effort)
	_ = SongMetaSingleton().Delete(songName)

	// Drop references to this song from every setlist (best-effort)
	_ = SetlistSingleton().RemoveSongFromAll(songName)

	w.WriteHeader(http.StatusOK)
}

func RenameSong(w http.ResponseWriter, r *http.Request) {
	var data struct {
		SongName string `json:"songName"`
		NewTitle string `json:"newTitle"`
	}

	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	songName, err := sanitizeSongName(data.SongName)
	if err != nil || data.NewTitle == "" {
		http.Error(w, "songName and newTitle are required", http.StatusBadRequest)
		return
	}
	if len(data.NewTitle) > maxTitleLen {
		http.Error(w, "newTitle too long", http.StatusBadRequest)
		return
	}

	// Verify the song file exists
	filePath := SongFilePath(songName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "Song not found", http.StatusNotFound)
		return
	}

	// Update the display title in metadata — the file (slug) is never renamed
	newTitle := data.NewTitle
	if err := SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		sm.Title = newTitle
	}); err != nil {
		http.Error(w, "Failed to update title", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// GetSongList returns a JSON list of all song names from the songs folder
func GetSongList(w http.ResponseWriter, r *http.Request) {
	files, err := os.ReadDir(SongsDir())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read songs directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Initialize as empty slice instead of nil so JSON encodes as [] not null
	songNames := make([]string, 0)
	for _, file := range files {
		if !file.IsDir() && filepath.Ext(file.Name()) == ".txt" && file.Name()[0] != '.' && !IsVersionFile(file.Name()) {
			songName := filepath.Base(file.Name())
			songName = songName[:len(songName)-4] // strip .txt
			songNames = append(songNames, songName)
		}
	}

	writeJSON(w, http.StatusOK, songNames)
}

// UploadSong uploads a new song to the server
func UploadSong(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSongUploadBytes)

	// Parse JSON or form-urlencoded body.
	var songName, content string
	if r.Header.Get("Content-Type") == "application/json" {
		var data struct {
			SongName string `json:"songName"`
			Content  string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
			http.Error(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		songName, content = data.SongName, data.Content
	} else {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Failed to parse form data: "+err.Error(), http.StatusBadRequest)
			return
		}
		songName, content = r.FormValue("songName"), r.FormValue("content")
	}

	if songName == "" {
		http.Error(w, "songName is required", http.StatusBadRequest)
		return
	}
	if content == "" {
		http.Error(w, "content is required", http.StatusBadRequest)
		return
	}

	songName, err := sanitizeSongName(songName)
	if err != nil {
		http.Error(w, "Invalid song name", http.StatusBadRequest)
		return
	}

	filePath := SongFilePath(songName)
	if _, err := os.Stat(filePath); err == nil {
		http.Error(w, "Song already exists", http.StatusConflict)
		return
	}

	if err := atomicWriteFile(filePath, []byte(content), 0644); err != nil {
		http.Error(w, "Failed to save song: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success":  true,
		"message":  "Song uploaded successfully",
		"songName": songName,
		"filePath": filePath,
	})
}

// cleanBlankLines removes extra blank lines, keeping only single blank lines between sections.
func cleanBlankLines(content string) string {
	return multiNewline.ReplaceAllString(content, "\n\n")
}

// ─── Version endpoints ──────────────────────────────────────────────────────

// SongVersionInfo is one entry in the version list response.
type SongVersionInfo struct {
	Version int    `json:"version"`
	Label   string `json:"label"`
}

// GetSongVersions handles GET /music/song-versions?songName=X
// Returns all versions (including 0) with their labels.
func GetSongVersions(w http.ResponseWriter, r *http.Request) {
	songName, err := sanitizeSongName(r.URL.Query().Get("songName"))
	if err != nil {
		http.Error(w, "missing or invalid songName", http.StatusBadRequest)
		return
	}

	// Verify the base song exists
	if _, err := os.Stat(SongFilePath(songName)); os.IsNotExist(err) {
		http.Error(w, "song not found", http.StatusNotFound)
		return
	}

	meta := SongMetaSingleton().Get(songName)
	versions := []SongVersionInfo{{Version: 0, Label: "Original"}}

	nums, err := ListVersionNumbers(songName)
	if err != nil {
		http.Error(w, "failed to list versions", http.StatusInternalServerError)
		return
	}

	for _, n := range nums {
		label := fmt.Sprintf("Version %d", n)
		if meta.VersionLabels != nil {
			if custom, ok := meta.VersionLabels[fmt.Sprintf("%d", n)]; ok && custom != "" {
				label = custom
			}
		}
		versions = append(versions, SongVersionInfo{Version: n, Label: label})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"versions": versions})
}

// CreateVersion handles POST /music/create-version
// Clones content from an existing version into a new version file.
func CreateVersion(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSongUploadBytes)
	var data struct {
		SongName    string  `json:"songName"`
		FromVersion int     `json:"fromVersion"`
		Label       string  `json:"label"`
		Content     *string `json:"content,omitempty"` // set: the new version's body instead of a clone
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	songName, err := sanitizeSongName(data.SongName)
	if err != nil {
		http.Error(w, "invalid song name", http.StatusBadRequest)
		return
	}
	if len(data.Label) > maxVersionLabelLen {
		http.Error(w, "label too long", http.StatusBadRequest)
		return
	}

	// Read source content (or, when content is given, check the song exists)
	srcPath := SongVersionFilePath(songName, data.FromVersion)
	var content []byte
	if data.Content != nil {
		srcPath = SongFilePath(songName)
		_, err = os.Stat(srcPath)
		content = []byte(multiNewline.ReplaceAllString(*data.Content, "\n\n"))
	} else {
		content, err = os.ReadFile(srcPath)
	}
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "source version not found", http.StatusNotFound)
		} else {
			http.Error(w, "failed to read source", http.StatusInternalServerError)
		}
		return
	}

	// Determine next version number
	existing, err := ListVersionNumbers(songName)
	if err != nil {
		http.Error(w, "failed to list versions", http.StatusInternalServerError)
		return
	}
	next := 1
	if len(existing) > 0 {
		next = existing[len(existing)-1] + 1
	}

	// Write new version file
	dstPath := SongVersionFilePath(songName, next)
	if _, err := os.Stat(dstPath); err == nil {
		http.Error(w, "version already exists", http.StatusConflict)
		return
	}
	if err := atomicWriteFile(dstPath, content, 0644); err != nil {
		http.Error(w, "failed to create version", http.StatusInternalServerError)
		return
	}

	// Save label if provided
	if data.Label != "" {
		key := fmt.Sprintf("%d", next)
		_ = SongMetaSingleton().Update(songName, func(sm *SongMeta) {
			if sm.VersionLabels == nil {
				sm.VersionLabels = map[string]string{}
			}
			sm.VersionLabels[key] = data.Label
		})
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"version": next})
}

// DeleteVersion handles DELETE /music/delete-version?songName=X&v=N
// Only non-default versions (v >= 1) can be deleted.
func DeleteVersion(w http.ResponseWriter, r *http.Request) {
	songName, err := sanitizeSongName(r.URL.Query().Get("songName"))
	if err != nil {
		http.Error(w, "missing or invalid songName", http.StatusBadRequest)
		return
	}

	vStr := r.URL.Query().Get("v")
	v, err := strconv.Atoi(vStr)
	if err != nil || v < 1 {
		http.Error(w, "version must be >= 1", http.StatusBadRequest)
		return
	}

	filePath := SongVersionFilePath(songName, v)
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "version not found", http.StatusNotFound)
		} else {
			http.Error(w, "failed to delete version", http.StatusInternalServerError)
		}
		return
	}

	// Clean up the version label from metadata (best-effort)
	key := fmt.Sprintf("%d", v)
	_ = SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		delete(sm.VersionLabels, key)
	})

	w.WriteHeader(http.StatusOK)
}
