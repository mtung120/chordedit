package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostSong_HappyPath(t *testing.T) {
	slug := "post-happy"
	t.Cleanup(func() { os.Remove(SongFilePath(slug)) })

	req := httptest.NewRequest(http.MethodPost, "/music/songs",
		strings.NewReader(`{"songName":"`+slug+`","content":"[C]hi"}`))
	w := httptest.NewRecorder()
	PostSong(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if got, _ := os.ReadFile(SongFilePath(slug)); string(got) != "[C]hi" {
		t.Errorf("file = %q, want %q", got, "[C]hi")
	}
}

// PostSong must never write outside SongsDir, and must reject (not coerce)
// names that sanitizeSongName would alter.
func TestPostSong_RejectsPathTraversal(t *testing.T) {
	escaped := filepath.Join(filepath.Dir(SongsDir()), "escaped.txt")
	t.Cleanup(func() { os.Remove(escaped) })

	for _, name := range []string{"../escaped", "a/b", "..", "."} {
		req := httptest.NewRequest(http.MethodPost, "/music/songs",
			strings.NewReader(`{"songName":"`+name+`","content":"x"}`))
		w := httptest.NewRecorder()
		PostSong(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("songName=%q: status = %d, want 400", name, w.Code)
		}
	}
	if _, err := os.Stat(escaped); err == nil {
		t.Fatalf("PostSong wrote outside SongsDir: %s", escaped)
	}
}

// Hidden state files (.yt-cookies.txt holds YouTube session cookies) must
// never be addressable as songs.
func TestSanitizeSongName_RejectsDotNames(t *testing.T) {
	for _, name := range []string{".yt-cookies", ".song-meta", "../.yt-cookies", ".", ".."} {
		if got, err := sanitizeSongName(name); err == nil {
			t.Errorf("sanitizeSongName(%q) = %q, want error", name, got)
		}
	}
	if validSongName(".yt-cookies") {
		t.Error(`validSongName(".yt-cookies") = true, want false`)
	}
	if got, err := sanitizeSongName("Its my life"); err != nil || got != "Its my life" {
		t.Errorf(`sanitizeSongName("Its my life") = %q, %v`, got, err)
	}
}

func TestValidVideoID(t *testing.T) {
	for _, id := range []string{"dQw4w9WgXcQ", "abc123", "a-b_C"} {
		if !validVideoID(id) {
			t.Errorf("validVideoID(%q) = false, want true", id)
		}
	}
	for _, id := range []string{"", "../x", "a/b", "a.b", "a b", strings.Repeat("a", 65)} {
		if validVideoID(id) {
			t.Errorf("validVideoID(%q) = true, want false", id)
		}
	}
}

func TestDownloadAudio_RejectsBadVideoID(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/music/download-audio",
		strings.NewReader(`{"videoId":"../../evil","songName":"s"}`))
	w := httptest.NewRecorder()
	DownloadAudioHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestSaveYouTubeSettings_VideoIDValidation(t *testing.T) {
	slug := "yt-settings"
	t.Cleanup(func() { _ = SongMetaSingleton().Delete(slug) })

	cases := []struct {
		videoID string
		want    int
	}{
		{"../../evil", http.StatusBadRequest},
		{"dQw4w9WgXcQ", http.StatusOK},
		{"", http.StatusOK}, // clearing the video is allowed
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodPost, "/music/save-youtube-settings",
			strings.NewReader(`{"songName":"`+slug+`","videoId":"`+c.videoID+`","title":"t"}`))
		w := httptest.NewRecorder()
		SaveYouTubeSettingsHandler(w, req)
		if w.Code != c.want {
			t.Errorf("videoId=%q: status = %d, want %d", c.videoID, w.Code, c.want)
		}
	}
}
