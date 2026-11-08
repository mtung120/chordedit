package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"

	"golang.org/x/net/html"
)

// ─── Original proxy (direct URL paste) ───────────────────────────────────────

type ProxyRequest struct {
	URL string `json:"url"`
}

type ProxyResponse struct {
	Content string `json:"content"`
}

func ProxyHandler(w http.ResponseWriter, r *http.Request) {
	var req ProxyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate the user-supplied URL before the server fetches it. The
	// IP-class check (loopback / private / link-local) lives in
	// safeHTTPClient's transport and triggers at dial time.
	if _, err := validateExternalURL(req.URL); err != nil {
		http.Error(w, "Invalid URL: "+err.Error(), http.StatusBadRequest)
		return
	}

	doc, err := fetchAndParse(req.URL)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error fetching URL: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, ProxyResponse{Content: processHTML(doc)})
}

// ─── Hopamchuan search ────────────────────────────────────────────────────────

type HacSearchResult struct {
	ID      string   `json:"id"`
	Slug    string   `json:"slug"`
	Title   string   `json:"title"`
	Artists []string `json:"artists"`
}

// Matches the base song URL /song/{id}/{slug}/ (with optional ?s=1) but NOT version URLs with username.
var searchHrefPattern = regexp.MustCompile(`^(?:https://hopamchuan\.com)?/song/(\d+)/([^/?]+)/?(?:\?.*)?$`)

func HopamchuanSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "Missing query parameter q", http.StatusBadRequest)
		return
	}

	searchURL := "https://hopamchuan.com/search?q=" + url.QueryEscape(q)
	doc, err := fetchAndParse(searchURL)
	if err != nil {
		http.Error(w, "Failed to fetch search results: "+err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, parseSearchResults(doc))
}

// parseSearchResults parses the /search page.
// Each result is rendered as:
//
//	<a class="song-title" href="/song/{id}/{slug}/?s=1">Nàng Thơ</a>
//	<span class="song-singers"> - <a class="author-item">Nguyễn Hoàng Dũng</a> </span>
func parseSearchResults(doc *html.Node) []HacSearchResult {
	var results []HacSearchResult
	seen := make(map[string]bool)

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if len(results) >= 10 {
			return
		}
		if n.Type == html.ElementNode && n.Data == "a" && nodeHasClass(n, "song-title") {
			href := nodeAttr(n, "href")
			m := searchHrefPattern.FindStringSubmatch(href)
			if m != nil {
				songID, slug := m[1], m[2]
				if !seen[songID] {
					title := strings.TrimSpace(extractNodeText(n))
					artists := findSiblingArtists(n)
					if title != "" {
						seen[songID] = true
						results = append(results, HacSearchResult{
							ID: songID, Slug: slug, Title: title, Artists: artists,
						})
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return results
}

// findSiblingArtists looks at the next siblings of a <a class="song-title"> for a
// <span class="song-singers"> and returns all its artist names.
func findSiblingArtists(songLink *html.Node) []string {
	for sib := songLink.NextSibling; sib != nil; sib = sib.NextSibling {
		if sib.Type == html.ElementNode && sib.Data == "span" && nodeHasClass(sib, "song-singers") {
			artists := []string{}
			var gatherArtists func(*html.Node)
			gatherArtists = func(n *html.Node) {
				if n.Type == html.ElementNode && n.Data == "a" && nodeHasClass(n, "author-item") {
					if name := strings.TrimSpace(extractNodeText(n)); name != "" {
						artists = append(artists, name)
					}
				}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					gatherArtists(c)
				}
			}
			gatherArtists(sib)
			return artists
		}
	}
	return []string{}
}

// ─── Hopamchuan auto-import (search versions, pick best) ─────────────────────

type HacImportRequest struct {
	SongID string `json:"songId"`
	Slug   string `json:"slug"`
}

type HacImportResponse struct {
	Versions []HacImportVersion `json:"versions"`
}

type HacImportVersion struct {
	URL       string `json:"url"`
	Label     string `json:"label"`
	Score     int    `json:"score"`
	IsDefault bool   `json:"isDefault"`
	Content   string `json:"content"`
}

type hacVersion struct {
	URL       string
	Label     string
	IsDefault bool
	ChordList string
	Score     int
}

func HopamchuanImportHandler(w http.ResponseWriter, r *http.Request) {
	var req HacImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.SongID == "" || req.Slug == "" {
		http.Error(w, "songId and slug are required", http.StatusBadRequest)
		return
	}

	// Fetch all-versions listing
	versionsURL := "https://hopamchuan.com/song/all/" + req.SongID + "/" + req.Slug
	doc, err := fetchAndParse(versionsURL)
	if err != nil {
		http.Error(w, "Failed to fetch versions: "+err.Error(), http.StatusInternalServerError)
		return
	}

	versions := parseVersionsList(doc, req.SongID, req.Slug)

	// Fallback: use the base song URL if no versions found
	if len(versions) == 0 {
		versions = []hacVersion{{
			URL: "https://hopamchuan.com/song/" + req.SongID + "/" + req.Slug,
		}}
	}

	// Score every parsed candidate (up to 7), sort by score desc preserving
	// page order on ties, then pin the "Bản chính" (default) version to the
	// front so the user's first option is always the canonical one. Finally,
	// take the top 4 for full-content fetches.
	for i := range versions {
		versions[i].Score = scoreChordList(versions[i].ChordList)
	}
	sort.SliceStable(versions, func(i, j int) bool {
		return versions[i].Score > versions[j].Score
	})
	for i, v := range versions {
		if v.IsDefault {
			if i != 0 {
				d := versions[i]
				versions = append(versions[:i], versions[i+1:]...)
				versions = append([]hacVersion{d}, versions...)
			}
			break
		}
	}
	top := versions
	if len(top) > 4 {
		top = top[:4]
	}

	// Fetch + parse each chosen version's song page concurrently.
	fetched := make([]HacImportVersion, len(top))
	ok := make([]bool, len(top))
	var wg sync.WaitGroup
	for i, v := range top {
		wg.Add(1)
		go func(i int, v hacVersion) {
			defer wg.Done()
			songDoc, err := fetchAndParse(v.URL)
			if err != nil {
				return
			}
			fetched[i] = HacImportVersion{
				URL:       v.URL,
				Label:     v.Label,
				Score:     v.Score,
				IsDefault: v.IsDefault,
				Content:   processHTML(songDoc),
			}
			ok[i] = true
		}(i, v)
	}
	wg.Wait()

	out := make([]HacImportVersion, 0, len(fetched))
	for i, v := range fetched {
		if ok[i] {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		http.Error(w, "Failed to fetch any version", http.StatusBadGateway)
		return
	}

	writeJSON(w, http.StatusOK, HacImportResponse{Versions: out})
}

// collapseWhitespace squashes any run of whitespace (including the leading
// indent / icon-padding the listing page renders) into single spaces and
// trims the result. Used on version labels scraped from anchor text.
var hacWhitespaceRE = regexp.MustCompile(`\s+`)

func collapseWhitespace(s string) string {
	return strings.TrimSpace(hacWhitespaceRE.ReplaceAllString(s, " "))
}

// parseVersionsList parses the /song/all/{id}/{slug} page.
// Each version lives in a <div class="list-item-white floating"> that contains:
//   - <a class="link" href="/song/{id}/{slug}/{username}"> — version link
//   - <span class="song-chords"><span>C</span><span>Am7</span>…</span> — chord list
func parseVersionsList(doc *html.Node, songID, slug string) []hacVersion {
	var versions []hacVersion
	seen := make(map[string]bool)
	versionPrefix := "/song/" + songID + "/" + slug + "/"
	fullPrefix := "https://hopamchuan.com" + versionPrefix

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if len(versions) >= 7 {
			return
		}
		if n.Type == html.ElementNode && n.Data == "div" && nodeHasClass(n, "list-item-white") {
			versionURL := ""
			label := ""
			isDefault := false
			chordList := ""

			var scan func(*html.Node)
			scan = func(c *html.Node) {
				if c.Type == html.ElementNode {
					if c.Data == "a" && nodeHasClass(c, "link") {
						href := nodeAttr(c, "href")
						var username string
						if strings.HasPrefix(href, fullPrefix) {
							username = strings.TrimPrefix(href, fullPrefix)
						} else if strings.HasPrefix(href, versionPrefix) {
							username = strings.TrimPrefix(href, versionPrefix)
						}
						if username != "" && !strings.Contains(username, "/") && !seen[username] && versionURL == "" {
							versionURL = "https://hopamchuan.com" + versionPrefix + username
							// The anchor's text content includes the version
							// label (e.g. "theo phiên bản của Hiển Râu") and
							// optionally a "Bản chính" pill rendered as a
							// trailing <span class="label">. Detect the pill,
							// strip its text from the label, and remember the
							// "default" status so the handler can pin it.
							full := collapseWhitespace(extractNodeText(c))
							if strings.Contains(full, "Bản chính") {
								isDefault = true
								full = collapseWhitespace(strings.ReplaceAll(full, "Bản chính", ""))
							}
							label = full
						}
					}
					if c.Data == "span" && nodeHasClass(c, "song-chords") {
						var chords []string
						for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
							if gc.Type == html.ElementNode && gc.Data == "span" {
								if ch := strings.TrimSpace(extractNodeText(gc)); ch != "" {
									chords = append(chords, ch)
								}
							}
						}
						chordList = strings.Join(chords, " ")
					}
				}
				for child := c.FirstChild; child != nil; child = child.NextSibling {
					scan(child)
				}
			}
			scan(n)

			if versionURL != "" && chordList != "" {
				username := strings.TrimPrefix(versionURL, "https://hopamchuan.com"+versionPrefix)
				if !seen[username] {
					seen[username] = true
					versions = append(versions, hacVersion{
						URL:       versionURL,
						Label:     label,
						IsDefault: isDefault,
						ChordList: chordList,
					})
				}
			}
			return // handled this container; don't recurse further into it
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return versions
}

func scoreChordList(chordList string) int {
	total := 0
	for _, chord := range strings.Fields(chordList) {
		total += scoreChord(chord)
	}
	return total
}

// scoreChord awards points for chord complexity features.
// Inversions and extended jazz harmony score highest.
func scoreChord(chord string) int {
	s := 0
	if strings.Contains(chord, "/") {
		s += 3 // slash chord / inversion (most valued by user)
	}
	// Extended quality — mutually exclusive checks to avoid double-counting "7"
	switch {
	case strings.Contains(chord, "m7b5"):
		s += 2 // half-diminished
	case strings.Contains(chord, "dim7"):
		s += 2 // diminished 7th
	case strings.Contains(chord, "maj7"):
		s += 2 // major 7th
	case strings.Contains(chord, "aug"):
		s += 1 // augmented
	}
	// Ninth+ extensions (C9, Gm9, G9sus4, etc.)
	if strings.Contains(chord, "9") || strings.Contains(chord, "11") || strings.Contains(chord, "13") {
		s += 1
	}
	// Regular 7th (not already counted above)
	if strings.Contains(chord, "7") &&
		!strings.Contains(chord, "maj7") &&
		!strings.Contains(chord, "dim7") &&
		!strings.Contains(chord, "m7b5") {
		s += 1
	}
	// Suspended
	if strings.Contains(chord, "sus") {
		s += 1
	}
	// Plain diminished (not dim7)
	if strings.Contains(chord, "dim") && !strings.Contains(chord, "dim7") {
		s += 1
	}
	return s
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// fetchAndParse fetches a URL with browser-like headers and returns parsed HTML.
// Uses safeHTTPClient (SSRF-blocking transport) and caps the response body at
// maxFetchBytes so a hostile or runaway server can't OOM us.
func fetchAndParse(targetURL string) (*html.Node, error) {
	req, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	resp, err := safeHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}
	return html.Parse(io.LimitReader(resp.Body, maxFetchBytes))
}

// nodeHasClass reports whether a node's class attribute contains the given class token.
func nodeHasClass(n *html.Node, class string) bool {
	for _, attr := range n.Attr {
		if attr.Key == "class" {
			for _, tok := range strings.Fields(attr.Val) {
				if tok == class {
					return true
				}
			}
		}
	}
	return false
}

// nodeAttr returns the value of the named attribute, or "".
func nodeAttr(n *html.Node, key string) string {
	for _, attr := range n.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}
	return ""
}

// extractNodeText returns the concatenated text content of a node and its descendants.
func extractNodeText(n *html.Node) string {
	if n.Type == html.TextNode {
		return n.Data
	}
	var sb strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sb.WriteString(extractNodeText(c))
	}
	return sb.String()
}

// findSpanByClass finds the first <span> whose class contains the given substring
// and returns its trimmed text content.
func findSpanByClass(n *html.Node, class string) string {
	if n.Type == html.ElementNode && n.Data == "span" {
		for _, attr := range n.Attr {
			if attr.Key == "class" && strings.Contains(attr.Val, class) {
				return strings.TrimSpace(extractNodeText(n))
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if result := findSpanByClass(c, class); result != "" {
			return result
		}
	}
	return ""
}

// ─── Hopamchuan HTML parser (shared by ProxyHandler and HopamchuanImportHandler) ──

func processHTML(doc *html.Node) string {
	// Find the song-lyric div
	var content strings.Builder
	var foundLyrics bool
	var processNode func(*html.Node)

	processNode = func(n *html.Node) {
		if n.Type == html.ElementNode {
			// Check if this is the song-lyric div
			if n.Data == "div" {
				for _, attr := range n.Attr {
					if attr.Key == "id" && attr.Val == "song-lyric" {
						foundLyrics = true
						break
					}
				}
			}

			// Process chord_lyric_line nodes
			if foundLyrics && n.Data == "div" {
				for _, attr := range n.Attr {
					if attr.Key == "class" {
						switch {
						case strings.Contains(attr.Val, "chord_lyric_line empty_line"):
							content.WriteString("\n")
							return
						case strings.Contains(attr.Val, "chord_lyric_line"):
							processLine(n, &content)
							content.WriteString("\n")
							return
						}
					}
				}
			}
		}

		for c := n.FirstChild; c != nil; c = c.NextSibling {
			processNode(c)
		}
	}

	processNode(doc)

	rawContent := content.String()

	re := regexp.MustCompile(`[ \t]+`)
	cleaned := re.ReplaceAllString(rawContent, " ")

	re = regexp.MustCompile(`\n{3,}`)
	cleaned = re.ReplaceAllString(cleaned, "\n\n")

	lines := strings.Split(cleaned, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	cleaned = strings.Join(lines, "\n")

	return strings.TrimSpace(cleaned)
}

func processLine(n *html.Node, content *strings.Builder) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == "span" {
			for _, attr := range c.Attr {
				if attr.Key == "class" {
					switch attr.Val {
					case "hopamchuan_chord_inline":
						chord := extractChord(c)
						if chord != "" {
							content.WriteString("[")
							content.WriteString(chord)
							content.WriteString("]")
						}
					case "hopamchuan_lyric":
						if c.FirstChild != nil {
							content.WriteString(c.FirstChild.Data)
						}
					}
				}
			}
		}
	}
}

func extractChord(n *html.Node) string {
	if n.FirstChild != nil && n.FirstChild.NextSibling != nil && n.FirstChild.NextSibling.Type == html.ElementNode {
		chordSpan := n.FirstChild.NextSibling
		for _, attr := range chordSpan.Attr {
			if attr.Key == "class" && attr.Val == "hopamchuan_chord" {
				if chordSpan.FirstChild != nil {
					return chordSpan.FirstChild.Data
				}
			}
		}
	}
	return ""
}
