package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// TestMain points SONGS_DIR at a tmp dir for the whole test binary so the
// singletons (SongMetaSingleton, AccessTrackerSingleton) initialize against
// the test directory and don't touch the real ./songs folder.
func TestMain(m *testing.M) {
	tmp, err := os.MkdirTemp("", "chordedit-handler-tests-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tmp)
	os.Setenv("SONGS_DIR", tmp)

	os.Exit(m.Run())
}

func TestSaveChords_HappyPath(t *testing.T) {
	slug := "save-happy"
	if err := atomicWriteFile(SongFilePath(slug), []byte("[C]old"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() { os.Remove(SongFilePath(slug)) })

	req := httptest.NewRequest(http.MethodPost, "/music/save-chords",
		strings.NewReader(`{"songName":"`+slug+`","content":"[D]new"}`))
	w := httptest.NewRecorder()
	SaveChords(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	got, _ := os.ReadFile(SongFilePath(slug))
	if string(got) != "[D]new" {
		t.Errorf("file = %q, want %q", got, "[D]new")
	}
}

func TestSaveChords_RejectsInvalidName(t *testing.T) {
	// Names that resolve to "."/".."/"" after sanitization are rejected outright.
	for _, name := range []string{"..", ".", ""} {
		req := httptest.NewRequest(http.MethodPost, "/music/save-chords",
			strings.NewReader(`{"songName":"`+name+`","content":"x"}`))
		w := httptest.NewRecorder()
		SaveChords(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("songName=%q: status = %d, want 400", name, w.Code)
		}
	}
}

// Path-traversal defense: inputs with path separators get reduced to their
// basename and written under SongsDir, never to /etc/passwd or similar.
func TestSaveChords_StripsPathComponents(t *testing.T) {
	t.Cleanup(func() { os.Remove(SongFilePath("passwd")) })

	req := httptest.NewRequest(http.MethodPost, "/music/save-chords",
		strings.NewReader(`{"songName":"../etc/passwd","content":"x"}`))
	w := httptest.NewRecorder()
	SaveChords(w, req)

	// Whatever the response, the file MUST NOT exist outside SongsDir.
	if _, err := os.Stat("/etc/passwd.txt"); err == nil {
		t.Fatal("path traversal occurred: /etc/passwd.txt was written")
	}
	// And if the request succeeded, it landed at SongsDir/passwd.txt.
	if w.Code == http.StatusOK {
		if _, err := os.Stat(SongFilePath("passwd")); err != nil {
			t.Errorf("expected file at %s, got %v", SongFilePath("passwd"), err)
		}
	}
}

func TestUploadSong_HappyPath(t *testing.T) {
	slug := "upload-happy"
	t.Cleanup(func() { os.Remove(SongFilePath(slug)) })

	req := httptest.NewRequest(http.MethodPost, "/music/upload-song",
		strings.NewReader(`{"songName":"`+slug+`","content":"[E]hi"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	UploadSong(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
	got, _ := os.ReadFile(SongFilePath(slug))
	if string(got) != "[E]hi" {
		t.Errorf("file = %q, want %q", got, "[E]hi")
	}
}

func TestUploadSong_RejectsDuplicate(t *testing.T) {
	slug := "upload-dup"
	if err := atomicWriteFile(SongFilePath(slug), []byte("existing"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() { os.Remove(SongFilePath(slug)) })

	req := httptest.NewRequest(http.MethodPost, "/music/upload-song",
		strings.NewReader(`{"songName":"`+slug+`","content":"new"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	UploadSong(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", w.Code)
	}
	got, _ := os.ReadFile(SongFilePath(slug))
	if string(got) != "existing" {
		t.Errorf("file overwritten: %q", got)
	}
}

func TestSaveChords_RejectsOversizedBody(t *testing.T) {
	slug := "save-oversized"
	if err := atomicWriteFile(SongFilePath(slug), []byte("seed"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() { os.Remove(SongFilePath(slug)) })

	// 2 MiB of "x" — over the 1 MiB cap.
	huge := strings.Repeat("x", 2<<20)
	body := `{"songName":"` + slug + `","content":"` + huge + `"}`
	req := httptest.NewRequest(http.MethodPost, "/music/save-chords", strings.NewReader(body))
	w := httptest.NewRecorder()
	SaveChords(w, req)

	if w.Code == http.StatusOK {
		t.Errorf("expected non-200 for oversized body; got 200")
	}
	if got, _ := os.ReadFile(SongFilePath(slug)); string(got) != "seed" {
		t.Errorf("oversized request mutated the file: %q", got)
	}
}

func TestUploadSong_RejectsEmpty(t *testing.T) {
	cases := []string{
		`{"songName":"","content":"x"}`,
		`{"songName":"x","content":""}`,
	}
	for _, body := range cases {
		req := httptest.NewRequest(http.MethodPost, "/music/upload-song", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		UploadSong(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("body=%s: status = %d, want 400", body, w.Code)
		}
	}
}

func TestDeleteSong_HappyPath(t *testing.T) {
	slug := "delete-happy"
	if err := atomicWriteFile(SongFilePath(slug), []byte("x"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/music/delete-song?songName="+slug, nil)
	w := httptest.NewRecorder()
	DeleteSong(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if _, err := os.Stat(SongFilePath(slug)); !os.IsNotExist(err) {
		t.Errorf("file still exists after delete")
	}
}

func TestDeleteSong_MissingFile(t *testing.T) {
	req := httptest.NewRequest(http.MethodDelete, "/music/delete-song?songName=does-not-exist", nil)
	w := httptest.NewRecorder()
	DeleteSong(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestRenameSong_UpdatesTitle(t *testing.T) {
	slug := "rename-happy"
	if err := atomicWriteFile(SongFilePath(slug), []byte("x"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		os.Remove(SongFilePath(slug))
		_ = SongMetaSingleton().Delete(slug)
	})

	req := httptest.NewRequest(http.MethodPost, "/music/rename-song",
		strings.NewReader(`{"songName":"`+slug+`","newTitle":"My New Title"}`))
	w := httptest.NewRecorder()
	RenameSong(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if got := SongMetaSingleton().Get(slug).Title; got != "My New Title" {
		t.Errorf("Title = %q, want %q", got, "My New Title")
	}
}

func TestRenameSong_MissingFile(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/music/rename-song",
		strings.NewReader(`{"songName":"nope","newTitle":"x"}`))
	w := httptest.NewRecorder()
	RenameSong(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

// A duplicate import from the home page's add-song sheet becomes a new
// version of the existing song, written from the imported content.
func TestCreateVersion_FromContent(t *testing.T) {
	slug := "version-from-content"
	if err := atomicWriteFile(SongFilePath(slug), []byte("[C]original"), 0644); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		os.Remove(SongFilePath(slug))
		os.Remove(SongVersionFilePath(slug, 1))
	})

	req := httptest.NewRequest(http.MethodPost, "/music/create-version",
		strings.NewReader(`{"songName":"`+slug+`","content":"[G]imported\n\n\n\n[D]next","label":"hopamchuan"}`))
	w := httptest.NewRecorder()
	CreateVersion(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"version":1`) {
		t.Errorf("body = %s, want version 1", w.Body.String())
	}
	got, _ := os.ReadFile(SongVersionFilePath(slug, 1))
	if string(got) != "[G]imported\n\n[D]next" {
		t.Errorf("version file = %q", got)
	}
	if orig, _ := os.ReadFile(SongFilePath(slug)); string(orig) != "[C]original" {
		t.Errorf("default version changed: %q", orig)
	}
}

func TestCreateVersion_FromContentNeedsTheSong(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/music/create-version",
		strings.NewReader(`{"songName":"no-such-song","content":"[G]x"}`))
	w := httptest.NewRecorder()
	CreateVersion(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
	if _, err := os.Stat(SongVersionFilePath("no-such-song", 1)); err == nil {
		t.Error("wrote a version for a song that doesn't exist")
	}
}

func TestNewSongPageRedirectsHome(t *testing.T) {
	w := httptest.NewRecorder()
	GetNewSongPage(w, httptest.NewRequest(http.MethodGet, "/music/new-song", nil))
	if w.Code != http.StatusMovedPermanently || w.Header().Get("Location") != "/music/songs" {
		t.Fatalf("status = %d, Location = %q", w.Code, w.Header().Get("Location"))
	}
}
