package handlers

import (
	"crypto/sha1"
	"encoding/hex"
	"os"
	"sync"
	"time"
)

// assetHashCache memoizes file-content hashes, keyed by the relative file
// path (e.g. "static/css/styles.css"). An entry is reused while the file's
// mtime and size are unchanged, so a running dev server picks up edits:
// /static/ is served immutable, so a stale ?v= would pin browsers to the
// old file for good.
var assetHashCache sync.Map

type assetHash struct {
	mod  time.Time
	size int64
	hash string
}

// assetURL turns a project-relative asset path into a versioned URL,
// suitable for <link href="..."> and <script src="...">.
//
//	{{asset "static/css/styles.css"}} → "/static/css/styles.css?v=ab12cd34"
//
// The version query string is the first 8 hex chars of the SHA-1 of the file
// content. This means edits to a CSS/JS file automatically invalidate browser
// cache without anyone touching the templates — fixes the manual `?v=N`
// drift problem (e.g. mobile.css?v=38 vs desktop.css?v=42).
//
// On read errors (missing file etc.) returns the bare URL with no version
// string — the link still works but loses cache-busting. The dev console will
// show a 404 if the path is wrong, which is the intended diagnostic signal.
func assetURL(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return "/" + path
	}
	if v, ok := assetHashCache.Load(path); ok {
		if c := v.(assetHash); c.mod.Equal(info.ModTime()) && c.size == info.Size() {
			return "/" + path + "?v=" + c.hash
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "/" + path
	}
	sum := sha1.Sum(data)
	hash := hex.EncodeToString(sum[:])[:8]
	assetHashCache.Store(path, assetHash{mod: info.ModTime(), size: info.Size(), hash: hash})
	return "/" + path + "?v=" + hash
}
