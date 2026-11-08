package handlers

import "os"

// Init runs all server startup tasks in the correct order.
//
// Order rationale: .env comes first since everything else (and main.go's
// PORT) reads the environment; the rest don't depend on each other and
// keep the historical main.go order so log output stays predictable. Tests
// that need partial setup (or want to inject a YouTube key directly) call
// the individual Init* helpers — this wrapper exists so main.go stays a
// one-liner.
func Init() {
	loadDotEnv(".env")
	InitYouTube(os.Getenv("YOUTUBE_API_KEY"))
	InitSongMeta()
	InitAccessTracker()
	InitSetlists()
}
