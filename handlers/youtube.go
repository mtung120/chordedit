package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ─── Types ───────────────────────────────────────────────────────────────────

// YouTubeSearchResult is a single video returned to the frontend.
type YouTubeSearchResult struct {
	VideoID   string `json:"videoId"`
	Title     string `json:"title"`
	Channel   string `json:"channel"`
	Thumbnail string `json:"thumbnail"`
}

// ─── API key (set once at startup from env var) ──────────────────────────────

var youtubeAPIKey string

// InitYouTube is called once from main.go with the value of $YOUTUBE_API_KEY.
func InitYouTube(apiKey string) { youtubeAPIKey = apiKey }

// ─── Search handler ──────────────────────────────────────────────────────────

// ytAPISearchResponse mirrors the shape we need from youtube.googleapis.com/youtube/v3/search.
type ytAPISearchResponse struct {
	Items []struct {
		ID struct {
			VideoID string `json:"videoId"`
		} `json:"id"`
		Snippet struct {
			Title        string `json:"title"`
			ChannelTitle string `json:"channelTitle"`
			Thumbnails   struct {
				Default struct {
					URL string `json:"url"`
				} `json:"default"`
				Medium struct {
					URL string `json:"url"`
				} `json:"medium"`
			} `json:"thumbnails"`
		} `json:"snippet"`
	} `json:"items"`
}

// YouTubeSearchHandler handles GET /music/youtube-search?q=...
func YouTubeSearchHandler(w http.ResponseWriter, r *http.Request) {
	if youtubeAPIKey == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "YouTube search not configured (set YOUTUBE_API_KEY env var)",
		})
		return
	}

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "missing query parameter q", http.StatusBadRequest)
		return
	}

	params := url.Values{}
	params.Set("part", "snippet")
	params.Set("q", q)
	params.Set("maxResults", "10")
	params.Set("type", "video")
	params.Set("order", "relevance")
	params.Set("key", youtubeAPIKey)
	apiURL := "https://www.googleapis.com/youtube/v3/search?" + params.Encode()

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("youtube API error: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := readLimited(resp.Body, 2048)
		http.Error(w, fmt.Sprintf("youtube API status %d: %s", resp.StatusCode, body), http.StatusBadGateway)
		return
	}

	var parsed ytAPISearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		http.Error(w, "failed to decode YouTube response", http.StatusBadGateway)
		return
	}

	results := make([]YouTubeSearchResult, 0, len(parsed.Items))
	for _, it := range parsed.Items {
		if it.ID.VideoID == "" {
			continue
		}
		thumb := it.Snippet.Thumbnails.Medium.URL
		if thumb == "" {
			thumb = it.Snippet.Thumbnails.Default.URL
		}
		results = append(results, YouTubeSearchResult{
			VideoID:   it.ID.VideoID,
			Title:     it.Snippet.Title,
			Channel:   it.Snippet.ChannelTitle,
			Thumbnail: thumb,
		})
	}

	writeJSON(w, http.StatusOK, results)
}

// ─── Save handler ───────────────────────────────────────────────────────────

// SaveYouTubeSettingsHandler handles POST /music/save-youtube-settings
func SaveYouTubeSettingsHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SongName string `json:"songName"`
		VideoID  string `json:"videoId"`
		Title    string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.SongName == "" {
		http.Error(w, "missing songName", http.StatusBadRequest)
		return
	}
	// The stored ID later names audio/stem files (see stems.go), so it must
	// pass the same check as a download request. Empty clears the video.
	if req.VideoID != "" && !validVideoID(req.VideoID) {
		http.Error(w, "invalid videoId", http.StatusBadRequest)
		return
	}

	// Audio files are named by video ID and shared across songs, so we
	// don't delete them on video change — another song may still use them.
	if err := SongMetaSingleton().Update(req.SongName, func(sm *SongMeta) {
		sm.YoutubeVideoId = req.VideoID
		sm.YoutubeVideoTitle = req.Title
		sm.AudioSource = "youtube"
		// Clear upload fields — sources are mutually exclusive
		sm.UploadedAudioId = ""
		sm.UploadedAudioName = ""
	}); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// readLimited reads up to n bytes from an io.Reader (used for bounded error-body inclusion).
func readLimited(r interface{ Read([]byte) (int, error) }, n int) (string, error) {
	buf := make([]byte, n)
	total := 0
	for total < n {
		m, err := r.Read(buf[total:])
		total += m
		if err != nil {
			break
		}
	}
	return string(buf[:total]), nil
}
