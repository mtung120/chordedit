package handlers

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Vite manifest entry. Vite emits more fields (css, imports, dynamicImports);
// we only need `file` for the script src.
type viteEntry struct {
	File string   `json:"file"`
	Src  string   `json:"src"`
	CSS  []string `json:"css"`
}

// The parsed manifest, cached until the file changes on disk: a rebuild
// (`npm run build`) renames the hashed bundles, and a server still serving
// the old names would point pages at deleted files — a blank song page.
var (
	viteMu          sync.Mutex
	viteManifest    map[string]viteEntry
	viteManifestErr error
	viteLoadedPath  string
	viteLoadedMod   time.Time
	viteLoadedSize  int64
)

// findManifestPath returns the first existing manifest location among
// (1) next to the running binary (prod: /opt/chordedit/current/...) and
// (2) cwd-relative (local dev: `go run` from the project root). Trying
// both keeps prod resilient to cwd changes and dev resilient to `go run`
// using a temp binary path.
func findManifestPath() (string, error) {
	const rel = "static/dist/.vite/manifest.json"
	var tried []string
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), rel)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		tried = append(tried, p)
	}
	if _, err := os.Stat(rel); err == nil {
		return rel, nil
	}
	tried = append(tried, rel)
	return "", fmt.Errorf("manifest not found in any of: %v", tried)
}

// loadViteManifest returns the parsed Vite manifest, re-reading it
// whenever the file's mtime or size changes. The manifest is produced by
// `vite build` and maps source paths (`src/entries/song.ts`) to hashed
// output paths (`assets/song-l0sNRNKZ.js`).
//
// If the manifest is missing (e.g. dev hasn't run `npm run build` yet),
// {{vite "..."}} calls emit empty strings and the page renders without
// JS — a warning (once per state change) makes that obvious in the log.
func loadViteManifest() (map[string]viteEntry, error) {
	viteMu.Lock()
	defer viteMu.Unlock()

	path, err := findManifestPath()
	if err != nil {
		if viteManifestErr == nil {
			log.Printf("vite: manifest not loaded (%v); {{vite}} calls will be no-ops until `npm run build` runs", err)
		}
		viteManifest, viteManifestErr, viteLoadedPath = nil, err, ""
		return nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return viteManifest, viteManifestErr
	}
	if path == viteLoadedPath && info.ModTime().Equal(viteLoadedMod) && info.Size() == viteLoadedSize {
		return viteManifest, viteManifestErr
	}
	viteLoadedPath, viteLoadedMod, viteLoadedSize = path, info.ModTime(), info.Size()

	data, err := os.ReadFile(path)
	if err != nil {
		viteManifest, viteManifestErr = nil, err
		log.Printf("vite: manifest read failed at %s (%v)", path, err)
		return nil, err
	}
	raw := map[string]viteEntry{}
	if err := json.Unmarshal(data, &raw); err != nil {
		// Possibly caught mid-write by a running build: retry next request.
		viteLoadedPath = ""
		viteManifest, viteManifestErr = nil, fmt.Errorf("parse manifest: %w", err)
		log.Printf("vite: %v", viteManifestErr)
		return nil, viteManifestErr
	}
	// Index by entry name (e.g. "song") for friendlier {{vite "song"}}
	// lookups, derived from the `src/entries/<name>.ts` source path.
	named := map[string]viteEntry{}
	for src, entry := range raw {
		named[src] = entry
		// `src/entries/song.ts` → `song`
		if name, ok := entryNameFromSrc(src); ok {
			named[name] = entry
		}
	}
	viteManifest, viteManifestErr = named, nil
	return viteManifest, nil
}

func entryNameFromSrc(src string) (string, bool) {
	const prefix = "src/entries/"
	const suffix = ".ts"
	if len(src) <= len(prefix)+len(suffix) {
		return "", false
	}
	if src[:len(prefix)] != prefix || src[len(src)-len(suffix):] != suffix {
		return "", false
	}
	return src[len(prefix) : len(src)-len(suffix)], true
}

// viteScript returns the <script type="module"> tag for the given Vite
// entry name (e.g. "song", "home", "setlist"). Returns empty HTML when the
// manifest is missing or the name isn't found, with a one-time log so dev
// builds without `vite build` don't silently fail.
//
// Bundled into the templateFuncs map (handlers/render.go) so any template
// can call {{vite "song"}}.
func viteScript(name string) template.HTML {
	manifest, err := loadViteManifest()
	if err != nil || manifest == nil {
		return ""
	}
	entry, ok := manifest[name]
	if !ok {
		log.Printf("vite: no entry %q in manifest", name)
		return ""
	}
	// The path is relative to base "/static/dist/" (vite.config.ts).
	// Produce a typed `template.HTML` so the result isn't auto-escaped.
	src := "/static/dist/" + entry.File
	tag := fmt.Sprintf(`<script type="module" src="%s"></script>`, template.HTMLEscapeString(src))
	return template.HTML(tag)
}
