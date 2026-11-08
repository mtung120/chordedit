package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// inProgressDownloads tracks videos currently being downloaded to prevent
// duplicate yt-dlp processes for the same video.
var inProgressDownloads sync.Map

type downloadAudioRequest struct {
	VideoID  string `json:"videoId"`
	SongName string `json:"songName"`
}

type downloadAudioResponse struct {
	Status string `json:"status"`          // "ready", "downloading", "error"
	URL    string `json:"url,omitempty"`    // set when status == "ready"
	Error  string `json:"error,omitempty"` // set when status == "error"
}

// validSongName is the strict, no-coercion counterpart to sanitizeSongName
// (handlers/songs_dir.go). Returns false if the input contains anything
// that sanitizeSongName would silently strip — used for JSON-body fields
// where silent normalization would mask a buggy caller.
func validSongName(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") {
		return false
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
		return false
	}
	return true
}

// videoIDRe matches YouTube video IDs (11 chars in practice; looser bound so
// test fixtures with short IDs still work). The ID becomes part of audio
// filenames, so anything outside this charset — "/", "..", etc. — is refused.
var videoIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func validVideoID(id string) bool { return videoIDRe.MatchString(id) }

// appPython is the venv interpreter with yt-dlp and Demucs installed
// (deploy/requirements.txt). Production sets CHORDEDIT_PYTHON;
// dev defaults to the repo-local .venv.
func appPython() string {
	if p := os.Getenv("CHORDEDIT_PYTHON"); p != "" {
		return p
	}
	return ".venv/bin/python"
}

// DownloadAudioHandler kicks off an async yt-dlp download and returns
// immediately. The frontend polls GET /music/audio?file=... (HEAD)
// until the file appears.
//
// POST /music/download-audio
// Body: {"videoId": "...", "songName": "..."}
func DownloadAudioHandler(w http.ResponseWriter, r *http.Request) {
	var req downloadAudioRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if !validVideoID(req.VideoID) || !validSongName(req.SongName) {
		http.Error(w, "valid videoId and songName are required", http.StatusBadRequest)
		return
	}

	// Audio filename is based on the video ID, stored in youtube/ subdir
	audioFilename := "youtube/" + req.VideoID + "_full.mp3"
	audioURL := fmt.Sprintf("/music/audio?file=%s", audioFilename)
	outPath := AudioFileByName(audioFilename)

	// Already downloaded?
	if _, err := os.Stat(outPath); err == nil {
		writeJSON(w, http.StatusOK, downloadAudioResponse{
			Status: "ready",
			URL:    audioURL,
		})
		return
	}

	// Already downloading? Track by videoId to avoid duplicate yt-dlp processes
	if _, loaded := inProgressDownloads.LoadOrStore(req.VideoID, true); loaded {
		writeJSON(w, http.StatusAccepted, downloadAudioResponse{
			Status: "downloading",
		})
		return
	}

	// Check the yt-dlp Python is available before starting the goroutine.
	// We run via `<python> -m yt_dlp` so the yt_dlp_ejs plugin (installed
	// in that Python environment) is loaded automatically.
	python := appPython()
	if _, err := exec.LookPath(python); err != nil {
		inProgressDownloads.Delete(req.VideoID)
		writeJSON(w, http.StatusServiceUnavailable, downloadAudioResponse{
			Status: "error",
			Error:  python + " not found",
		})
		return
	}

	// Ensure audio/youtube directory exists
	if err := os.MkdirAll(filepath.Join(AudioDir(), "youtube"), 0755); err != nil {
		inProgressDownloads.Delete(req.VideoID)
		writeJSON(w, http.StatusInternalServerError, downloadAudioResponse{
			Status: "error",
			Error:  fmt.Sprintf("failed to create audio directory: %v", err),
		})
		return
	}

	// Kick off yt-dlp in the background — return immediately so the UI
	// stays responsive. The frontend polls via HEAD requests.
	//
	// Write to a temp file and atomically rename when done, so the final
	// filename never exists with partial content (the HEAD poll would
	// otherwise see it mid-write and serve a truncated file).
	// Use a temp directory so yt-dlp can name the file however it wants
	// (it changes extensions during audio extraction/conversion).
	tmpDir := outPath + ".dl"
	tmpTemplate := filepath.Join(tmpDir, "audio")
	go func() {
		defer inProgressDownloads.Delete(req.VideoID)
		defer os.RemoveAll(tmpDir)

		if err := os.MkdirAll(tmpDir, 0755); err != nil {
			log.Printf("failed to create temp dir for %s: %v", req.VideoID, err)
			return
		}

		ytURL := fmt.Sprintf("https://www.youtube.com/watch?v=%s", req.VideoID)
		// Find node binary — yt-dlp needs a JS runtime for YouTube signature solving
		nodePath := "node"
		for _, p := range []string{"/usr/bin/node", "/usr/local/bin/node"} {
			if _, err := os.Stat(p); err == nil {
				nodePath = p
				break
			}
		}

		// Run via <python> -m yt_dlp so that the installed yt_dlp_ejs package
		// is loaded automatically. The ejs plugin provides the JS challenge
		// solver that generates proper tokens for YouTube's CDN — without it,
		// the CDN returns 403 on the actual audio data even when format listing
		// succeeds. The binary `yt-dlp` may use a different Python and miss it.
		args := []string{
			"-m", "yt_dlp",
			"-x",
			"--audio-format", "mp3",
			"--audio-quality", "0",
			"--js-runtimes", "node:" + nodePath,
			// web_embedded (YouTube's embedded player) doesn't require PO tokens
			// from datacenter IPs — web/TV clients do, and iOS/Android skip when
			// cookies are present. web_embedded + cookies is the working combo.
			"--extractor-args", "youtube:player_client=web_embedded",
			"-o", tmpTemplate,
		}

		// Cookies bypass YouTube bot-detection for authenticated downloads.
		cookiesPath := filepath.Join(SongsDir(), ".yt-cookies.txt")
		if _, err := os.Stat(cookiesPath); err == nil {
			args = append(args, "--cookies", cookiesPath)
		}

		args = append(args, ytURL)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, python, args...)

		output, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("yt-dlp failed for %s: %v\n%s", req.VideoID, err, output)
			return
		}

		// Find the mp3 file yt-dlp produced (name varies by conversion path)
		matches, _ := filepath.Glob(filepath.Join(tmpDir, "*.mp3"))
		if len(matches) == 0 {
			// Fallback: any file in the temp dir
			matches, _ = filepath.Glob(filepath.Join(tmpDir, "*"))
		}
		if len(matches) == 0 {
			log.Printf("yt-dlp produced no output file for %s", req.VideoID)
			return
		}

		// Atomic rename: final filename only appears once fully written
		if err := os.Rename(matches[0], outPath); err != nil {
			log.Printf("rename failed %s → %s: %v", matches[0], outPath, err)
			return
		}
		log.Printf("yt-dlp finished: %s → %s", req.VideoID, outPath)
	}()

	writeJSON(w, http.StatusAccepted, downloadAudioResponse{
		Status: "downloading",
	})
}

// UploadCookiesHandler writes a cookies.txt file for yt-dlp authentication.
//
// POST /music/upload-cookies
// Body: raw text (Netscape cookies format)
func UploadCookiesHandler(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024)) // 64KB max
	if err != nil || len(body) == 0 {
		http.Error(w, "empty or unreadable body", http.StatusBadRequest)
		return
	}
	cookiesPath := filepath.Join(SongsDir(), ".yt-cookies.txt")
	// Atomic write: cookies are auth tokens — a crash mid-write would
	// leave yt-dlp with a truncated cookie file and broken auth until
	// the user re-uploads.
	if err := atomicWriteFile(cookiesPath, body, 0600); err != nil {
		http.Error(w, fmt.Sprintf("write failed: %v", err), http.StatusInternalServerError)
		return
	}
	log.Printf("yt-dlp cookies updated (%d bytes)", len(body))
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Cookies saved (%d bytes)", len(body))
}

// ─── Upload audio ───────────────────────────────────────────────────────────

type uploadAudioResponse struct {
	Status  string `json:"status"`
	AudioID string `json:"audioId"`
}

// UploadAudioHandler accepts a direct MP3 upload as an alternative to
// YouTube + yt-dlp. The file is stored under audio/upload/{id}_full.mp3
// where id is derived from the original filename's SHA-256.
//
// POST /music/upload-audio
// Multipart fields: songName (text), audio (file).
func UploadAudioHandler(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(20 << 20); err != nil { // 20 MB limit
		http.Error(w, "request too large or not multipart", http.StatusBadRequest)
		return
	}

	songName := r.FormValue("songName")
	if !validSongName(songName) {
		http.Error(w, "invalid songName", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("audio")
	if err != nil {
		http.Error(w, "missing audio file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "failed to read audio file", http.StatusBadRequest)
		return
	}

	// Generate a short ID from the original filename
	hash := sha256.Sum256([]byte(header.Filename))
	audioId := hex.EncodeToString(hash[:])[:8]

	uploadDir := filepath.Join(AudioDir(), "upload")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, "failed to create upload directory", http.StatusInternalServerError)
		return
	}

	filename := audioId + "_full.mp3"
	if err := atomicWriteFile(filepath.Join(uploadDir, filename), data, 0644); err != nil {
		http.Error(w, "failed to write audio file", http.StatusInternalServerError)
		return
	}

	// Update metadata: set upload source, clear YouTube fields
	if err := SongMetaSingleton().Update(songName, func(sm *SongMeta) {
		sm.AudioSource = "upload"
		sm.UploadedAudioId = audioId
		sm.UploadedAudioName = header.Filename
		sm.YoutubeVideoId = ""
		sm.YoutubeVideoTitle = ""
	}); err != nil {
		http.Error(w, "failed to update metadata", http.StatusInternalServerError)
		return
	}

	log.Printf("audio uploaded for %s: upload/%s (%d bytes)", songName, filename, len(data))
	writeJSON(w, http.StatusOK, uploadAudioResponse{
		Status:  "ok",
		AudioID: audioId,
	})
}

// ServeAudioHandler serves a downloaded MP3 file by filename.
//
// GET /music/audio?file=youtube/videoId_full.mp3
func ServeAudioHandler(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("file")
	if !ValidAudioFilename(filename) {
		http.Error(w, "invalid file parameter", http.StatusBadRequest)
		return
	}

	filePath := AudioFileByName(filename)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}

	// Audio files are immutable (filename includes video ID), so cache aggressively.
	// 30 days — browser won't re-download on repeat visits to the same song.
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	http.ServeFile(w, r, filePath)
}
