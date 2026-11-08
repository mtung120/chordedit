package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// Stem separation runs Demucs on the server against the song's existing
// <id>_full.mp3 and writes <id>_vocals.mp3 + <id>_accompaniment.mp3 next to
// it. Like the full mix, stems are keyed by audio ID, so every song sharing
// the video/upload sees them, and their availability is derived from disk
// by GetSongMetaHandler — no metadata is written.

type separateStemsRequest struct {
	SongName string `json:"songName"`
}

type separateStemsResponse struct {
	Status string `json:"status"`          // "none", "separating", "ready", "error"
	Error  string `json:"error,omitempty"` // set when status == "error"
}

// stemJobs maps an audio prefix ("youtube/<id>") to "" while Demucs is
// queued or running for it, or to an error message if the last run failed.
// A failed entry stays until the next POST retries.
var stemJobs sync.Map

// demucsSlot lets one Demucs process run at a time. On the 2-core home
// server a second concurrent run would only slow both down; later requests
// wait their turn.
var demucsSlot = make(chan struct{}, 1)

// SeparateStemsHandler reports stem status (GET) or starts separation (POST).
//
// GET  /music/separate-stems?songName=X
// POST /music/separate-stems   Body: {"songName": "..."}
//
// Both return separateStemsResponse. POST returns 202 while separating;
// the frontend polls GET until the status is "ready" or "error".
func SeparateStemsHandler(w http.ResponseWriter, r *http.Request) {
	songName := r.URL.Query().Get("songName")
	if r.Method == http.MethodPost {
		var req separateStemsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		songName = req.SongName
	}
	if !validSongName(songName) {
		http.Error(w, "invalid songName", http.StatusBadRequest)
		return
	}

	id, subdir := audioSourceID(SongMetaSingleton().Get(songName))
	prefix := subdir + "/" + id
	if r.Method == http.MethodGet {
		if id == "" {
			writeJSON(w, http.StatusOK, separateStemsResponse{Status: "none"})
			return
		}
		writeJSON(w, http.StatusOK, stemStatus(prefix))
		return
	}

	if id == "" {
		http.Error(w, "no audio source configured for this song", http.StatusBadRequest)
		return
	}
	if !fileExists(AudioFileByName(prefix + "_full.mp3")) {
		http.Error(w, "audio not downloaded yet", http.StatusConflict)
		return
	}
	if st := stemStatus(prefix); st.Status == "ready" || st.Status == "separating" {
		writeJSON(w, http.StatusOK, st)
		return
	}
	if _, err := exec.LookPath(appPython()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, separateStemsResponse{
			Status: "error",
			Error:  appPython() + " not found",
		})
		return
	}

	// Claim the job: start it if nothing is recorded, or retry a failed
	// run. Losing either race means another request already started it.
	if prev, loaded := stemJobs.LoadOrStore(prefix, ""); loaded {
		if prev == "" || !stemJobs.CompareAndSwap(prefix, prev, "") {
			writeJSON(w, http.StatusAccepted, separateStemsResponse{Status: "separating"})
			return
		}
	}
	go func() {
		demucsSlot <- struct{}{}
		defer func() { <-demucsSlot }()

		start := time.Now()
		if err := separateStems(prefix); err != nil {
			log.Printf("stem separation failed for %s: %v", prefix, err)
			stemJobs.Store(prefix, "stem separation failed")
			return
		}
		stemJobs.Delete(prefix)
		log.Printf("stems ready for %s (%s)", prefix, time.Since(start).Round(time.Second))
	}()

	writeJSON(w, http.StatusAccepted, separateStemsResponse{Status: "separating"})
}

// stemStatus derives a prefix's status from disk and the job map.
func stemStatus(prefix string) separateStemsResponse {
	if fileExists(AudioFileByName(prefix+"_vocals.mp3")) &&
		fileExists(AudioFileByName(prefix+"_accompaniment.mp3")) {
		return separateStemsResponse{Status: "ready"}
	}
	if v, ok := stemJobs.Load(prefix); ok {
		if msg := v.(string); msg != "" {
			return separateStemsResponse{Status: "error", Error: msg}
		}
		return separateStemsResponse{Status: "separating"}
	}
	return separateStemsResponse{Status: "none"}
}

// separateStems runs Demucs (2-stem, 128 kbps mp3 — keeps each stem small
// for iOS Safari's cache) into a temp dir beside the audio, then renames
// the outputs into place so a stem file never exists half-written.
func separateStems(prefix string) error {
	fullPath := AudioFileByName(prefix + "_full.mp3")
	tmpDir := AudioFileByName(prefix + ".stems")
	_ = os.RemoveAll(tmpDir) // leftovers from a run killed by a restart
	defer os.RemoveAll(tmpDir)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	// nice: keep the web server responsive while Demucs saturates the CPU.
	cmd := exec.CommandContext(ctx, "nice", "-n", "15", appPython(),
		"-m", "demucs",
		"--two-stems", "vocals",
		"--mp3", "--mp3-bitrate", "128",
		"-n", "htdemucs",
		"-o", tmpDir,
		fullPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		if len(out) > 2000 { // tqdm progress bars make the head useless
			out = out[len(out)-2000:]
		}
		return fmt.Errorf("%w\n%s", err, out)
	}

	// Demucs writes <tmpDir>/<model>/<input basename sans .mp3>/<stem>.mp3.
	outDir := filepath.Join(tmpDir, "htdemucs", filepath.Base(prefix)+"_full")
	for src, stem := range map[string]string{"vocals.mp3": "vocals", "no_vocals.mp3": "accompaniment"} {
		dst := AudioFileByName(prefix + "_" + stem + ".mp3")
		if err := os.Rename(filepath.Join(outDir, src), dst); err != nil {
			return fmt.Errorf("move %s: %w", src, err)
		}
	}
	return nil
}
