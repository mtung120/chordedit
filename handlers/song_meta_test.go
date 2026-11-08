package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSaveSongKey(t *testing.T) {
	post := func(body string) int {
		req := httptest.NewRequest(http.MethodPost, "/music/save-song-key", strings.NewReader(body))
		w := httptest.NewRecorder()
		SaveSongKeyHandler(w, req)
		return w.Code
	}

	if code := post(`{"songName":"key-song","keyOffset":7}`); code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if got := SongMetaSingleton().Get("key-song").KeyOffset; got != 7 {
		t.Errorf("KeyOffset = %d, want 7", got)
	}
	if code := post(`{"songName":"key-song","keyOffset":0}`); code != http.StatusOK {
		t.Fatalf("clear: status = %d, want 200", code)
	}
	if got := SongMetaSingleton().Get("key-song").KeyOffset; got != 0 {
		t.Errorf("KeyOffset after clear = %d, want 0", got)
	}

	for _, body := range []string{
		`{"songName":"key-song","keyOffset":12}`,
		`{"songName":"key-song","keyOffset":-1}`,
		`{"songName":"","keyOffset":3}`,
		`not json`,
	} {
		if code := post(body); code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", body, code)
		}
	}
}
