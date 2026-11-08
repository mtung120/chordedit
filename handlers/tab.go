package handlers

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// maxTabUploadBytes caps the size of an uploaded Guitar Pro file.
// Typical .gp files are 5–50 KB; even complex multi-track scores rarely
// exceed a few hundred KB. 5 MB is generous and well under Caddy's 25 MB
// request_body limit (deploy/chordedit.caddy).
const maxTabUploadBytes = 5 << 20

// validTabExt is the allowlist of Guitar Pro file extensions alphaTab
// can parse. Anything else gets rejected at upload time.
var validTabExt = map[string]bool{
	".gp":  true,
	".gp3": true,
	".gp4": true,
	".gp5": true,
	".gpx": true,
}

// isValidTabFilename checks that a tab filename is safe to serve from
// SongsDir. Song slugs in this app can contain spaces (e.g. "Its my life")
// and historically also unicode, so we can't use a strict allowlist —
// instead reject path-traversal hazards and require a valid GP extension.
func isValidTabFilename(s string) bool {
	if s == "" || strings.ContainsAny(s, "/\\") || strings.Contains(s, "..") {
		return false
	}
	ext := strings.ToLower(filepath.Ext(s))
	return validTabExt[ext]
}

type uploadTabResponse struct {
	Status string `json:"status"`
	Tab    string `json:"tab"`
}

// UploadTabHandler accepts a multipart upload of a Guitar Pro file and
// associates it with a song via SongMeta.GuitarTab.
//
// POST /music/upload-tab
// Multipart fields: songName (text), tab (file).
func UploadTabHandler(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxTabUploadBytes + (1 << 20)); err != nil {
		http.Error(w, "request too large or not multipart", http.StatusBadRequest)
		return
	}

	songName, err := sanitizeSongName(r.FormValue("songName"))
	if err != nil {
		http.Error(w, "invalid songName", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("tab")
	if err != nil {
		http.Error(w, "missing tab file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !validTabExt[ext] {
		http.Error(w, "tab file must be one of: .gp, .gp3, .gp4, .gp5, .gpx", http.StatusBadRequest)
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxTabUploadBytes+1))
	if err != nil {
		http.Error(w, "failed to read tab file", http.StatusBadRequest)
		return
	}
	if len(data) > maxTabUploadBytes {
		http.Error(w, "tab file too large", http.StatusBadRequest)
		return
	}

	// Preserve the user's original filename so the UI shows what was
	// uploaded. filepath.Base strips any directory components from a
	// malicious upload path; isValidTabFilename catches the rest
	// (empty, traversal, wrong extension).
	newFilename := filepath.Base(header.Filename)
	if !isValidTabFilename(newFilename) {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}
	// If this song already has a tab and the new filename differs,
	// remove the old file so we don't leak orphaned .gp files.
	if prev := SongMetaSingleton().Get(songName).GuitarTab; prev != "" && prev != newFilename && isValidTabFilename(prev) {
		_ = os.Remove(filepath.Join(SongsDir(), prev))
	}

	outPath := filepath.Join(SongsDir(), newFilename)
	if err := atomicWriteFile(outPath, data, 0644); err != nil {
		http.Error(w, "failed to write tab file", http.StatusInternalServerError)
		return
	}

	if err := SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		sm.GuitarTab = newFilename
	}); err != nil {
		http.Error(w, "failed to update metadata", http.StatusInternalServerError)
		return
	}

	log.Printf("tab uploaded for %s: %s (%d bytes)", songName, newFilename, len(data))
	writeJSON(w, http.StatusOK, uploadTabResponse{
		Status: "ok",
		Tab:    newFilename,
	})
}

// ServeTabHandler serves a Guitar Pro file by filename.
//
// GET /music/tab?file=MyLove.gp
func ServeTabHandler(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("file")
	if !isValidTabFilename(filename) {
		http.Error(w, "invalid file parameter", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(SongsDir(), filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "tab not found", http.StatusNotFound)
		return
	}

	// Short cache — user might re-upload at any time. ETag would be better
	// but the file is small enough that revalidation is cheap.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "private, max-age=60")
	http.ServeFile(w, r, filePath)
}

// RemoveTabHandler clears the GuitarTab field for a song and deletes
// the corresponding .gp file from disk.
//
// POST /music/remove-tab
// Body: { "songName": "..." }
func RemoveTabHandler(w http.ResponseWriter, r *http.Request) {
	var data struct {
		SongName string `json:"songName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	songName, err := sanitizeSongName(data.SongName)
	if err != nil {
		http.Error(w, "invalid songName", http.StatusBadRequest)
		return
	}

	current := SongMetaSingleton().Get(songName).GuitarTab
	if current != "" && isValidTabFilename(current) {
		_ = os.Remove(filepath.Join(SongsDir(), current))
	}

	if err := SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		sm.GuitarTab = ""
	}); err != nil {
		http.Error(w, "failed to update metadata", http.StatusInternalServerError)
		return
	}

	log.Printf("tab removed for %s (%s)", songName, current)
	w.WriteHeader(http.StatusOK)
}
