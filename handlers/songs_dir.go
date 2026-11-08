package handlers

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// SongsDir returns the directory where song .txt files and the
// .access_times.json / .song-meta.json metadata live.
//
// The path comes from the SONGS_DIR environment variable when set, falling
// back to "songs" (relative to the working directory) for local development.
//
// Production reason: each deploy is a fresh release directory, so data must
// live outside it. Production sets SONGS_DIR=/var/data/chordedit/songs.
func SongsDir() string {
	if d := os.Getenv("SONGS_DIR"); d != "" {
		return d
	}
	return "songs"
}

// SongFilePath returns the path to a single song's .txt file inside the
// songs directory. Centralized so we don't sprinkle filepath.Join("songs",
// ...) calls all over the handlers.
func SongFilePath(songName string) string {
	return filepath.Join(SongsDir(), songName+".txt")
}

// SongMetaFilePath returns the path to .song-meta.json.
func SongMetaFilePath() string {
	return filepath.Join(SongsDir(), ".song-meta.json")
}

// SetlistsFilePath returns the path to .setlists.json — the consolidated
// store of named song collections (setlists for gigs / events).
func SetlistsFilePath() string {
	return filepath.Join(SongsDir(), ".setlists.json")
}

// AccessTimesFilePath returns the path to .access_times.json.
func AccessTimesFilePath() string {
	return filepath.Join(SongsDir(), ".access_times.json")
}

// AudioDir returns the root directory for audio (full mix + stems). Lives
// under SongsDir() so it follows SONGS_DIR in production and survives
// deploys. Files live in two subdirs by source: youtube/{videoId}_*.mp3
// and upload/{uploadId}_*.mp3.
func AudioDir() string {
	return filepath.Join(SongsDir(), "audio")
}

// AudioFileByName returns the full path for an audio file relative to
// AudioDir() (e.g. "youtube/abc_full.mp3"). Callers validate the name
// with ValidAudioFilename first.
func AudioFileByName(filename string) string {
	return filepath.Join(AudioDir(), filename)
}

// SongVersionFilePath returns the path to a specific version of a song.
// version <= 0 returns the default file ({slug}.txt).
// version >= 1 returns {slug}.v{N}.txt.
func SongVersionFilePath(songName string, version int) string {
	if version <= 0 {
		return SongFilePath(songName)
	}
	return filepath.Join(SongsDir(), fmt.Sprintf("%s.v%d.txt", songName, version))
}

// versionFileRe matches version files like "SongName.v1.txt".
var versionFileRe = regexp.MustCompile(`^(.+)\.v(\d+)\.txt$`)

// IsVersionFile reports whether a filename is a version file (e.g. "Song.v1.txt").
func IsVersionFile(filename string) bool {
	return versionFileRe.MatchString(filename)
}

// ListVersionNumbers returns the sorted list of version numbers that exist on
// disk for a given song slug. It does NOT include 0 (the default).
func ListVersionNumbers(songName string) ([]int, error) {
	pattern := filepath.Join(SongsDir(), songName+".v*.txt")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}
	var versions []int
	for _, m := range matches {
		base := filepath.Base(m)
		sub := versionFileRe.FindStringSubmatch(base)
		if sub == nil || sub[1] != songName {
			continue
		}
		n, err := strconv.Atoi(sub[2])
		if err != nil {
			continue
		}
		versions = append(versions, n)
	}
	sort.Ints(versions)
	return versions, nil
}

// sanitizeSongName strips path components and rejects names that would
// escape the songs directory (e.g. "../etc/passwd"). Use this for any
// user-supplied song slug coming from a URL query, form field, or JSON
// body before it gets used as part of a filesystem path.
//
// Different from validSongName (audio.go) which is a strict "is this
// already clean?" predicate without coercion — see that helper's comment.
//
// Dot-names are rejected too: the songs dir holds hidden state files
// (.yt-cookies.txt, .song-meta.json, …) that must never be read or
// overwritten as songs.
func sanitizeSongName(name string) (string, error) {
	clean := filepath.Base(filepath.Clean(name))
	if clean == "" || strings.HasPrefix(clean, ".") {
		return "", fmt.Errorf("invalid song name")
	}
	return clean, nil
}

// ValidAudioFilename checks that a filename is safe to serve from AudioDir.
// Accepts either a flat filename ("id_full.mp3") or a one-level subdirectory
// path ("youtube/id_full.mp3", "upload/id_full.mp3").
func ValidAudioFilename(filename string) bool {
	if filename == "" {
		return false
	}
	if strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		return false
	}
	// Allow exactly one level of subdirectory: "youtube/" or "upload/"
	parts := strings.SplitN(filename, "/", 3)
	switch len(parts) {
	case 2:
		if parts[0] != "youtube" && parts[0] != "upload" {
			return false
		}
		filename = parts[1]
	case 1:
		// flat filename — ok
	default:
		return false // too many slashes
	}
	if filename == "" || strings.Contains(filename, "/") {
		return false
	}
	if !strings.HasSuffix(filename, ".mp3") {
		return false
	}
	return true
}
