package handlers

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

// SongInfo holds a song slug, display title, and tags for the home page template.
type SongInfo struct {
	Name     string   `json:"name"`     // slug (filename without .txt)
	Title    string   `json:"title"`    // display title (falls back to slug)
	Tags     []string `json:"tags"`     // set by the user
	AutoTags []string `json:"autoTags"` // derived from disk (songAutoTags)
	Artists  []string `json:"artists"`
}

func GetHomePage(w http.ResponseWriter, r *http.Request) {
	songs := listSongs()
	sort.Strings(songs)

	store := SongMetaSingleton()
	songInfo := func(name string) SongInfo {
		meta := store.Get(name)
		title := meta.Title
		if title == "" {
			title = name // fallback: slug is the title
		}
		tags := meta.Tags
		if tags == nil {
			tags = []string{}
		}
		artists := meta.Artists
		if artists == nil {
			artists = []string{}
		}
		return SongInfo{Name: name, Title: title, Tags: tags, AutoTags: songAutoTags(meta), Artists: artists}
	}

	songInfos := make([]SongInfo, len(songs))
	for i, name := range songs {
		songInfos[i] = songInfo(name)
	}

	// Build the "Recently Played" shortlist (up to 8 most recently opened).
	recentNames := AccessTrackerSingleton().GetRecentSongs(songs, 8)
	recentSongs := make([]SongInfo, 0, len(recentNames))
	for _, name := range recentNames {
		recentSongs = append(recentSongs, songInfo(name))
	}

	// Setlists for the section above the song library. Sorted by name for
	// stable display.
	setlistMap := SetlistSingleton().All()
	setlistNames := make([]string, 0, len(setlistMap))
	for name := range setlistMap {
		setlistNames = append(setlistNames, name)
	}
	sort.Strings(setlistNames)
	setlistList := make([]Setlist, 0, len(setlistNames))
	for _, n := range setlistNames {
		sl := setlistMap[n]
		if sl.Songs == nil {
			sl.Songs = []string{}
		}
		setlistList = append(setlistList, sl)
	}

	// Pre-encode as JSON and pass as template.JS to avoid HTML escaping
	songDataJSON, _ := json.Marshal(songInfos)
	recentDataJSON, _ := json.Marshal(recentSongs)
	tagConfigJSON, _ := json.Marshal(Tags)
	setlistsJSON, _ := json.Marshal(setlistList)

	data := struct {
		Songs        []SongInfo
		RecentSongs  []SongInfo
		SongDataJS   template.JS
		RecentDataJS template.JS
		TagConfigJS  template.JS
		SetlistsJS   template.JS
	}{
		Songs:        songInfos,
		RecentSongs:  recentSongs,
		SongDataJS:   template.JS(songDataJSON),
		RecentDataJS: template.JS(recentDataJSON),
		TagConfigJS:  template.JS(tagConfigJSON),
		SetlistsJS:   template.JS(setlistsJSON),
	}

	renderHTML(w, data, TemplatePath("home.html"))
}

// GetNewSongPage redirects the retired new-song page: songs are added from
// the home page's search now.
func GetNewSongPage(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/music/songs", http.StatusMovedPermanently)
}

func PostSong(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSongUploadBytes)

	var requestData struct {
		SongName string   `json:"songName"` // slug
		Title    string   `json:"title"`    // display title (optional)
		Content  string   `json:"content"`
		Artists  []string `json:"artists,omitempty"` // from hopamchuan.com (optional)
	}
	if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if requestData.SongName == "" {
		http.Error(w, "Song name is required", http.StatusBadRequest)
		return
	}
	// Reject (rather than coerce) anything sanitizeSongName would change —
	// the slug is echoed back to the client and used as the page URL, so a
	// silently-normalized name would point at the wrong song.
	if clean, err := sanitizeSongName(requestData.SongName); err != nil || clean != requestData.SongName {
		http.Error(w, "Invalid song name", http.StatusBadRequest)
		return
	}
	if len(requestData.Title) > maxTitleLen {
		http.Error(w, "title too long", http.StatusBadRequest)
		return
	}
	artists, err := cleanArtists(requestData.Artists)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	filePath := SongFilePath(requestData.SongName)

	if _, err := os.Stat(filePath); err == nil {
		http.Error(w, "A song with this name already exists", http.StatusConflict)
		return
	}

	if err := atomicWriteFile(filePath, []byte(requestData.Content), 0644); err != nil {
		http.Error(w, fmt.Sprintf("Failed to create file: %v", err), http.StatusInternalServerError)
		return
	}

	// Store the display title (if it differs from the slug) and artists.
	title := requestData.Title
	if title == requestData.SongName {
		title = ""
	}
	if title != "" || len(artists) > 0 {
		SongMetaSingleton().Update(requestData.SongName, func(sm *SongMeta) {
			sm.Title = title
			sm.Artists = artists
		})
	}

	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte(requestData.SongName))
}

func listSongs() []string {
	var songs []string
	files, err := os.ReadDir(SongsDir())
	if err != nil {
		return songs
	}

	for _, file := range files {
		name := file.Name()
		if !file.IsDir() && filepath.Ext(name) == ".txt" && name[0] != '.' && !IsVersionFile(name) {
			songs = append(songs, name[:len(name)-4])
		}
	}
	return songs
}
