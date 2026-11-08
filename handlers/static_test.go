package handlers

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAcceptsGzip(t *testing.T) {
	cases := []struct {
		header string
		want   bool
	}{
		{"", false},
		{"identity", false},
		{"gzip", true},
		{"gzip, deflate", true},
		{"deflate, gzip", true},
		{"deflate, gzip;q=0", false},
		{"*", true},
		{"br, gzip;q=1.0", true},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		if c.header != "" {
			req.Header.Set("Accept-Encoding", c.header)
		}
		if got := acceptsGzip(req); got != c.want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", c.header, got, c.want)
		}
	}
}

func TestCompressibleByExt(t *testing.T) {
	yes := []string{"styles.css", "app.js", "foo.svg", "data.json", "page.html", "/a/b/c.txt"}
	no := []string{"logo.png", "photo.jpg", "font.woff2", "archive.zip", "/no-ext", ""}
	for _, p := range yes {
		if !compressibleByExt(p) {
			t.Errorf("compressibleByExt(%q) = false, want true", p)
		}
	}
	for _, p := range no {
		if compressibleByExt(p) {
			t.Errorf("compressibleByExt(%q) = true, want false", p)
		}
	}
}

// End-to-end: gzipped response decompresses to the original payload, sets
// Content-Encoding and Vary headers, and drops Content-Length.
func TestStaticHandler_Gzip(t *testing.T) {
	payload := strings.Repeat("hello world ", 200)
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "9999") // intentionally wrong
		w.Write([]byte(payload))
	})

	h := StaticHandler(upstream)
	req := httptest.NewRequest(http.MethodGet, "/static/x.css", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", got)
	}
	if got := w.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Errorf("Vary = %q, want Accept-Encoding", got)
	}
	if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control = %q, want immutable directive", got)
	}
	if got := w.Header().Get("Content-Length"); got != "" {
		t.Errorf("Content-Length = %q, want empty", got)
	}

	gz, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	got, err := io.ReadAll(gz)
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if string(got) != payload {
		t.Errorf("decompressed body mismatch")
	}

	// Sanity: gzipped body is smaller than the original payload.
	if w.Body.Len() >= len(payload) {
		t.Errorf("gzipped size %d not smaller than payload %d", w.Body.Len(), len(payload))
	}
}

// Without Accept-Encoding the response is plain (no gzip) but still gets
// Cache-Control.
func TestStaticHandler_NoGzipWhenNotAccepted(t *testing.T) {
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plain css"))
	})

	h := StaticHandler(upstream)
	req := httptest.NewRequest(http.MethodGet, "/static/x.css", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if got := w.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want empty", got)
	}
	if w.Body.String() != "plain css" {
		t.Errorf("body = %q, want plain css", w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("Cache-Control should be set even without gzip; got %q", got)
	}
}

// Already-compressed extensions skip gzip even when the client accepts it.
func TestStaticHandler_SkipsGzipForBinaries(t *testing.T) {
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("\x89PNG fake binary"))
	})

	h := StaticHandler(upstream)
	req := httptest.NewRequest(http.MethodGet, "/static/logo.png", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if got := w.Header().Get("Content-Encoding"); got == "gzip" {
		t.Errorf("PNG was gzipped; should have been served raw")
	}
}
