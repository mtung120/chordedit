package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeDemucs points CHORDEDIT_PYTHON at a script standing in for
// `python -m demucs`: it writes both stems where Demucs would (or exits 1
// when fail is set).
func fakeDemucs(t *testing.T, fail bool) {
	t.Helper()
	script := `#!/bin/sh
[ -n "$FAIL" ] && { echo boom; exit 1; }
while [ $# -gt 1 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
dir="$out/htdemucs/$(basename "$1" .mp3)"
mkdir -p "$dir" && echo v > "$dir/vocals.mp3" && echo a > "$dir/no_vocals.mp3"
`
	path := filepath.Join(t.TempDir(), "python")
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CHORDEDIT_PYTHON", path)
	if fail {
		t.Setenv("FAIL", "1")
	}
}

// stemSong creates a song whose YouTube audio is already downloaded.
func stemSong(t *testing.T, slug, videoID string) string {
	t.Helper()
	if err := SongMetaSingleton().Update(slug, func(sm *SongMeta) {
		sm.AudioSource = "youtube"
		sm.YoutubeVideoId = videoID
	}); err != nil {
		t.Fatal(err)
	}
	prefix := "youtube/" + videoID
	if err := os.MkdirAll(filepath.Join(AudioDir(), "youtube"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(AudioFileByName(prefix+"_full.mp3"), []byte("full"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = SongMetaSingleton().Delete(slug)
		for _, s := range []string{"full", "vocals", "accompaniment"} {
			os.Remove(AudioFileByName(prefix + "_" + s + ".mp3"))
		}
		stemJobs.Delete(prefix)
	})
	return prefix
}

func stemsRequest(t *testing.T, method, slug string) (int, separateStemsResponse) {
	t.Helper()
	var req *http.Request
	if method == http.MethodPost {
		req = httptest.NewRequest(method, "/music/separate-stems",
			strings.NewReader(`{"songName":"`+slug+`"}`))
	} else {
		req = httptest.NewRequest(method, "/music/separate-stems?songName="+slug, nil)
	}
	w := httptest.NewRecorder()
	SeparateStemsHandler(w, req)
	var resp separateStemsResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return w.Code, resp
}

// waitStems polls GET until the status leaves "separating".
func waitStems(t *testing.T, slug string) separateStemsResponse {
	t.Helper()
	for i := 0; i < 100; i++ {
		if _, resp := stemsRequest(t, http.MethodGet, slug); resp.Status != "separating" {
			return resp
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("still separating after 5s")
	return separateStemsResponse{}
}

func TestSeparateStems_HappyPath(t *testing.T) {
	fakeDemucs(t, false)
	prefix := stemSong(t, "stems-happy", "stemHappy1")

	if _, resp := stemsRequest(t, http.MethodGet, "stems-happy"); resp.Status != "none" {
		t.Fatalf("initial status = %q, want none", resp.Status)
	}
	if code, resp := stemsRequest(t, http.MethodPost, "stems-happy"); code != http.StatusAccepted || resp.Status != "separating" {
		t.Fatalf("POST = %d %q, want 202 separating", code, resp.Status)
	}
	if resp := waitStems(t, "stems-happy"); resp.Status != "ready" {
		t.Fatalf("final status = %+v, want ready", resp)
	}
	for stem, want := range map[string]string{"vocals": "v\n", "accompaniment": "a\n"} {
		if got, _ := os.ReadFile(AudioFileByName(prefix + "_" + stem + ".mp3")); string(got) != want {
			t.Errorf("%s = %q, want %q", stem, got, want)
		}
	}
	if _, err := os.Stat(AudioFileByName(prefix + ".stems")); !os.IsNotExist(err) {
		t.Errorf("temp dir left behind: %v", err)
	}
	// Song meta now lists the stems (derived from disk).
	req := httptest.NewRequest(http.MethodGet, "/music/song-meta?songName=stems-happy", nil)
	w := httptest.NewRecorder()
	GetSongMetaHandler(w, req)
	var meta SongMetaResponse
	_ = json.Unmarshal(w.Body.Bytes(), &meta)
	if meta.VocalAudio != prefix+"_vocals.mp3" || meta.InstrumentAudio != prefix+"_accompaniment.mp3" {
		t.Errorf("song-meta stems = %q, %q", meta.VocalAudio, meta.InstrumentAudio)
	}
	// A second POST is a no-op.
	if code, resp := stemsRequest(t, http.MethodPost, "stems-happy"); code != http.StatusOK || resp.Status != "ready" {
		t.Errorf("POST when ready = %d %q, want 200 ready", code, resp.Status)
	}
}

func TestSeparateStems_FailureIsReportedAndRetryable(t *testing.T) {
	fakeDemucs(t, true)
	stemSong(t, "stems-fail", "stemFail1")

	stemsRequest(t, http.MethodPost, "stems-fail")
	if resp := waitStems(t, "stems-fail"); resp.Status != "error" || resp.Error == "" {
		t.Fatalf("status = %+v, want error with message", resp)
	}

	t.Setenv("FAIL", "")
	if code, _ := stemsRequest(t, http.MethodPost, "stems-fail"); code != http.StatusAccepted {
		t.Fatalf("retry POST = %d, want 202", code)
	}
	if resp := waitStems(t, "stems-fail"); resp.Status != "ready" {
		t.Fatalf("retry status = %+v, want ready", resp)
	}
}

func TestSeparateStems_RejectsBadInput(t *testing.T) {
	fakeDemucs(t, false)
	if code, _ := stemsRequest(t, http.MethodPost, "../evil"); code != http.StatusBadRequest {
		t.Errorf("bad songName: %d, want 400", code)
	}
	if code, _ := stemsRequest(t, http.MethodPost, "stems-no-source"); code != http.StatusBadRequest {
		t.Errorf("no audio source: %d, want 400", code)
	}
	prefix := stemSong(t, "stems-no-full", "stemNoFull1")
	os.Remove(AudioFileByName(prefix + "_full.mp3"))
	if code, _ := stemsRequest(t, http.MethodPost, "stems-no-full"); code != http.StatusConflict {
		t.Errorf("full mix missing: %d, want 409", code)
	}
	// IDs from /restore/song-meta aren't validated on the way in; they must
	// not reach the filesystem here.
	stemSong(t, "stems-bad-id", "ok")
	_ = SongMetaSingleton().Update("stems-bad-id", func(sm *SongMeta) { sm.YoutubeVideoId = "../../x" })
	if code, _ := stemsRequest(t, http.MethodPost, "stems-bad-id"); code != http.StatusBadRequest {
		t.Errorf("unsafe video ID: %d, want 400", code)
	}
}
