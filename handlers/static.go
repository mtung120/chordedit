package handlers

import (
	"compress/gzip"
	"mime"
	"net/http"
	"path"
	"strings"
)

// Go's MIME table lacks the web app manifest (static/manifest.webmanifest).
func init() {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// StaticHandler wraps a static-file http.Handler (typically a FileServer)
// with two transparent layers:
//
//  1. Cache-Control: public, max-age=31536000, immutable.
//     Safe because templates always reference assets through {{asset "..."}}
//     which appends a content-hash query string (?v=ab12cd34); when the file
//     changes, the URL changes, so the cached entry becomes stale by URL.
//
//  2. On-the-fly gzip for text-like assets when the client accepts gzip.
//     Skips images / fonts / already-compressed formats.
//
// Stdlib only — no third-party deps.
func StaticHandler(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")

		// HEAD: never gzip — gz.Close() would emit a stray 23-byte gzip footer
		// into a response that's supposed to have an empty body, confusing
		// some clients. Cache-Control still applies.
		if r.Method != http.MethodGet || !acceptsGzip(r) || !compressibleByExt(r.URL.Path) {
			h.ServeHTTP(w, r)
			return
		}

		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")
		// Content-Length would be wrong post-compression; let the gzip writer
		// stream chunked instead.
		w.Header().Del("Content-Length")

		gz := gzip.NewWriter(w)
		defer gz.Close()
		h.ServeHTTP(gzipResponseWriter{ResponseWriter: w, w: gz}, r)
	})
}

// gzipResponseWriter funnels Write calls through a gzip.Writer while
// preserving the original ResponseWriter for Header / WriteHeader / Hijack.
type gzipResponseWriter struct {
	http.ResponseWriter
	w *gzip.Writer
}

func (g gzipResponseWriter) Write(p []byte) (int, error) {
	// http.FileServer sets Content-Length to the on-disk size, which is wrong
	// after compression. Strip it on every write — once the response has
	// flushed it's a no-op, but until then it overrides whatever upstream set.
	g.ResponseWriter.Header().Del("Content-Length")
	return g.w.Write(p)
}

// WriteHeader strips Content-Length before flush. Same reason as Write.
func (g gzipResponseWriter) WriteHeader(code int) {
	g.ResponseWriter.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(code)
}

// acceptsGzip parses the Accept-Encoding header and reports whether the
// client wants gzip. Treats "*" as a yes.
func acceptsGzip(r *http.Request) bool {
	for _, token := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		// Strip any q= weight; a bare ";q=0" does mean "do not send".
		coding, params, _ := strings.Cut(strings.TrimSpace(token), ";")
		if strings.Contains(params, "q=0") {
			continue
		}
		if coding == "gzip" || coding == "*" {
			return true
		}
	}
	return false
}

// compressibleByExt returns true for asset types that benefit from gzip.
// Already-compressed formats (PNG/JPEG/WOFF2/ZIP) just waste CPU.
func compressibleByExt(urlPath string) bool {
	switch strings.ToLower(path.Ext(urlPath)) {
	case ".css", ".js", ".mjs", ".html", ".htm",
		".json", ".svg", ".txt", ".xml", ".map", ".webmanifest":
		return true
	}
	return false
}
