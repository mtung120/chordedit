package handlers

import (
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"strings"
)

// templateFuncs is the FuncMap available to every template rendered through
// renderHTML. Add new template helpers here so they're discoverable from one
// place rather than scattered across handlers.
var templateFuncs = template.FuncMap{
	// Versioned URL for raw, non-bundled static assets (fonts, images, the
	// pre-Vite legacy *.js files). Use {{asset "static/css/styles.css"}}.
	"asset": assetURL,
	// <script type="module"> tag for a Vite-built entry, looked up via the
	// manifest produced by `vite build`. Use {{vite "song"}}.
	"vite": viteScript,
	// Song title for the song page's heading, capped at songTitleMax
	// characters. Use {{shortTitle .Title}}.
	"shortTitle": shortTitle,
}

// songTitleMax is the most characters of a title the song page's heading
// shows; keep in sync with SONG_TITLE_MAX in src/utils/text.ts.
const songTitleMax = 25

// shortTitle caps a title at songTitleMax characters, ending it with "…".
func shortTitle(title string) string {
	r := []rune(title)
	if len(r) <= songTitleMax {
		return title
	}
	return strings.TrimRight(string(r[:songTitleMax]), " ") + "…"
}

// renderHTML parses one or more template files (relative to the working dir),
// executes the first against data, and writes the result to w with a UTF-8
// HTML Content-Type. On parse failure a 500 is returned. Execute failures are
// logged — by the time Execute starts writing, headers have already flushed
// and an http.Error would corrupt the response.
//
// Multiple template paths share a namespace (mirrors template.ParseFiles
// behaviour); the first file is the entry point.
func renderHTML(w http.ResponseWriter, data interface{}, templatePaths ...string) {
	if len(templatePaths) == 0 {
		http.Error(w, "no template", http.StatusInternalServerError)
		return
	}
	// Use the entry-point file's basename as the template name so Execute
	// (which runs the named template) finds the right one.
	name := filepath.Base(templatePaths[0])
	tmpl, err := template.New(name).Funcs(templateFuncs).ParseFiles(templatePaths...)
	if err != nil {
		http.Error(w, "template parse: "+err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// no-cache: browser may store the response but must revalidate with
	// the server before using it. This ensures deploys of new Vite-hashed
	// JS bundles are picked up immediately — the HTML references the
	// latest bundle hash, so a stale HTML page loads stale (404) JS.
	w.Header().Set("Cache-Control", "no-cache")
	if err := tmpl.Execute(w, data); err != nil {
		log.Printf("template execute (%v): %v", templatePaths, err)
	}
}

// writeJSON sends data as a JSON response with the given HTTP status. Encode
// errors are logged — by the time Encode runs the response status has already
// been written.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}
