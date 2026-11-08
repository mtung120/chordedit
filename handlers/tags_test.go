package handlers

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestSongAutoTags(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SONGS_DIR", dir)
	yt := filepath.Join(dir, "audio", "youtube")
	if err := os.MkdirAll(yt, 0o755); err != nil {
		t.Fatal(err)
	}
	touch := func(name string) {
		if err := os.WriteFile(filepath.Join(yt, name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	meta := SongMeta{AudioSource: "youtube", YoutubeVideoId: "abc123"}

	check := func(want ...string) {
		t.Helper()
		if got := songAutoTags(meta); !slices.Equal(got, append([]string{}, want...)) {
			t.Errorf("songAutoTags = %v, want %v", got, want)
		}
	}

	check() // no files yet
	touch("abc123_full.mp3")
	check("Audio")
	touch("abc123_vocals.mp3")
	check("Audio") // stems need both halves
	touch("abc123_accompaniment.mp3")
	check("Audio", "Stems")

	meta.AudioSource = "" // files left behind by a removed source don't count
	check()
}

func TestIsKnownTag(t *testing.T) {
	for _, tag := range []string{"Verified", "Gig-ready", "Ballad", "Sôi động"} {
		if !isKnownTag(tag) {
			t.Errorf("isKnownTag(%q) = false", tag)
		}
	}
	// Retired tags and auto tags can't be set by users.
	for _, tag := range []string{"Jazz", "Rock", "Audio", "Stems", ""} {
		if isKnownTag(tag) {
			t.Errorf("isKnownTag(%q) = true", tag)
		}
	}
}
