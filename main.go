package main

import (
	"fmt"
	"net/http"
	"os"

	"music/handlers"
)

// autoRedirectHandler redirects bare /music/ to the song-list page. Layout
// is responsive via CSS media queries; URL paths are device-agnostic.
func autoRedirectHandler(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/music/songs", http.StatusTemporaryRedirect)
}

func main() {
	// Load env-driven config + in-memory stores + run idempotent migrations.
	// Order and what's included live in handlers/init.go.
	handlers.Init()

	// Serve static files with gzip + immutable Cache-Control. Templates
	// reference every asset through {{asset "..."}} which adds a content-hash
	// query string, so a one-year immutable cache is safe.
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/static/", http.StripPrefix("/static/", handlers.StaticHandler(fs)))

	// Shared API endpoints (device-agnostic) - MUST come before catch-all routes.
	// Method gating lives in the middleware (handlers.PostOnly etc.) so handlers
	// don't repeat the `if r.Method != X` boilerplate.
	http.HandleFunc("/music/save-chords", handlers.PostOnly(handlers.SaveChords))
	http.HandleFunc("/music/delete-song", handlers.DeleteOnly(handlers.DeleteSong))
	http.HandleFunc("/music/rename-song", handlers.PostOnly(handlers.RenameSong))
	http.HandleFunc("/music/song-list", handlers.GetOnly(handlers.GetSongList))
	http.HandleFunc("/music/upload-song", handlers.PostOnly(handlers.UploadSong))
	http.HandleFunc("/music/proxy", handlers.PostOnly(handlers.ProxyHandler))
	http.HandleFunc("/music/hopamchuan-search", handlers.GetOnly(handlers.HopamchuanSearchHandler))
	http.HandleFunc("/music/hopamchuan-import", handlers.PostOnly(handlers.HopamchuanImportHandler))
	http.HandleFunc("/music/save-song-tags", handlers.PostOnly(handlers.SaveSongTagsHandler))
	http.HandleFunc("/music/save-song-key", handlers.PostOnly(handlers.SaveSongKeyHandler))
	http.HandleFunc("/music/tag-config", handlers.GetOnly(handlers.GetTagConfigHandler))
	http.HandleFunc("/music/save-metronome-settings", handlers.PostOnly(handlers.SaveMetronomeSettingsHandler))
	http.HandleFunc("/music/youtube-search", handlers.GetOnly(handlers.YouTubeSearchHandler))
	http.HandleFunc("/music/save-youtube-settings", handlers.PostOnly(handlers.SaveYouTubeSettingsHandler))
	http.HandleFunc("/music/download-audio", handlers.PostOnly(handlers.DownloadAudioHandler))
	http.HandleFunc("/music/upload-cookies", handlers.PostOnly(handlers.UploadCookiesHandler))
	http.HandleFunc("/music/audio", handlers.GetHead(handlers.ServeAudioHandler))
	http.HandleFunc("/music/separate-stems", handlers.GetPost(handlers.SeparateStemsHandler, handlers.SeparateStemsHandler))
	http.HandleFunc("/music/upload-audio", handlers.PostOnly(handlers.UploadAudioHandler))
	http.HandleFunc("/music/upload-tab", handlers.PostOnly(handlers.UploadTabHandler))
	http.HandleFunc("/music/tab", handlers.GetHead(handlers.ServeTabHandler))
	http.HandleFunc("/music/remove-tab", handlers.PostOnly(handlers.RemoveTabHandler))
	http.HandleFunc("/music/song-meta", handlers.GetOnly(handlers.GetSongMetaHandler))
	http.HandleFunc("/music/song-versions", handlers.GetOnly(handlers.GetSongVersions))
	http.HandleFunc("/music/create-version", handlers.PostOnly(handlers.CreateVersion))
	http.HandleFunc("/music/delete-version", handlers.DeleteOnly(handlers.DeleteVersion))
	http.HandleFunc("/music/save-version-label", handlers.PostOnly(handlers.SaveVersionLabelHandler))
	http.HandleFunc("/music/export/song-meta", handlers.GetOnly(handlers.ExportSongMetaHandler))
	http.HandleFunc("/music/restore/song-meta", handlers.PostOnly(handlers.RestoreSongMetaHandler))

	// Test-only state reset. Returns 404 unless CHORDEDIT_TEST_MODE=1
	// (production NEVER sets that env var).
	http.HandleFunc("/music/__test__/reload-state", handlers.PostOnly(handlers.ReloadStateHandler))

	// Page routes — device-agnostic URLs; layout responsiveness is in CSS.
	http.HandleFunc("/music/songs", handlers.GetPost(handlers.GetHomePage, handlers.PostSong))
	http.HandleFunc("/music/song", handlers.GetOnly(handlers.GetSongViewPage))
	http.HandleFunc("/music/new-song", handlers.GetOnly(handlers.GetNewSongPage))

	// Setlists — named song collections for gigs/events.
	http.HandleFunc("/music/setlist", handlers.GetOnly(handlers.GetSetlistPage))
	http.HandleFunc("/music/setlist-data", handlers.GetOnly(handlers.GetSetlistData))
	http.HandleFunc("/music/save-setlist", handlers.PostOnly(handlers.SaveSetlist))
	http.HandleFunc("/music/delete-setlist", handlers.DeleteOnly(handlers.DeleteSetlist))
	http.HandleFunc("/music/export/setlists", handlers.GetOnly(handlers.ExportSetlistsHandler))
	http.HandleFunc("/music/restore/setlists", handlers.PostOnly(handlers.RestoreSetlistsHandler))

	// Redirect bare /music/ to the song list (catch-all - MUST come last)
	// Only match exact /music/ path, not subpaths
	http.HandleFunc("/music/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/music/" {
			autoRedirectHandler(w, r)
		} else {
			http.NotFound(w, r)
		}
	})

	// PORT env var (set in /etc/chordedit/env in prod; tests use it to spawn
	// parallel workers on free ports). Defaults to 8080 for local dev.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	fmt.Printf("Starting server at %s\n", addr)
	fmt.Printf("Access URL: http://localhost:%s/music/\n", port)

	if err := http.ListenAndServe(addr, nil); err != nil {
		fmt.Println("Server failed:", err)
	}
}
