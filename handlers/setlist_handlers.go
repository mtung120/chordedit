package handlers

import (
	"encoding/json"
	"html/template"
	"net/http"
	"os"
)

// SetlistPageData feeds templates/setlist.html.
type SetlistPageData struct {
	Name        string
	Exists      bool
	SetlistJS   template.JS // pre-encoded Setlist JSON; empty object if !Exists
	SongDataJS  template.JS // all songs (for the "Add song" picker)
}

// GetSetlistPage renders the setlist edit page (templates/setlist.html).
// If the setlist doesn't exist yet, renders an empty editor — first save
// creates it on disk.
func GetSetlistPage(w http.ResponseWriter, r *http.Request) {
	name, err := sanitizeSetlistName(r.URL.Query().Get("name"))
	if err != nil {
		http.Error(w, "Bad request: missing or invalid setlist name", http.StatusBadRequest)
		return
	}

	sl, exists := SetlistSingleton().Get(name)
	if !exists {
		sl = Setlist{Name: name, Songs: []string{}}
	}
	setlistJSON, _ := json.Marshal(sl)

	// Songs picker payload (slug + title), same shape as home page so the
	// picker can reuse the fuzzy filter from songList.ts.
	songInfos := buildSongInfosForPicker()
	songDataJSON, _ := json.Marshal(songInfos)

	data := SetlistPageData{
		Name:       name,
		Exists:     exists,
		SetlistJS:  template.JS(setlistJSON),
		SongDataJS: template.JS(songDataJSON),
	}
	renderHTML(w, data, TemplatePath("setlist.html"))
}

// buildSongInfosForPicker returns slug/title pairs for every song on disk.
// Mirrors home.go's SongInfo population but skips tags (the picker doesn't
// need them).
func buildSongInfosForPicker() []SongInfo {
	songs := listSongs()
	store := SongMetaSingleton()
	titlesMap := store.AllTitles()
	out := make([]SongInfo, 0, len(songs))
	for _, name := range songs {
		title := titlesMap[name]
		if title == "" {
			title = name
		}
		out = append(out, SongInfo{Name: name, Title: title, Tags: []string{}})
	}
	return out
}

// GetSetlistData handles GET /music/setlist-data?name=X — JSON one setlist.
// Returns 404 if the setlist doesn't exist (used by the song-page Prev/Next
// overlay; 404 → overlay no-ops silently).
func GetSetlistData(w http.ResponseWriter, r *http.Request) {
	name, err := sanitizeSetlistName(r.URL.Query().Get("name"))
	if err != nil {
		http.Error(w, "missing or invalid name", http.StatusBadRequest)
		return
	}
	sl, ok := SetlistSingleton().Get(name)
	if !ok {
		http.Error(w, "setlist not found", http.StatusNotFound)
		return
	}
	if sl.Songs == nil {
		sl.Songs = []string{}
	}
	writeJSON(w, http.StatusOK, sl)
}

// SaveSetlistRequest is the body of POST /music/save-setlist. OldName is
// optional — non-empty + different from Name means "rename oldName → Name".
type SaveSetlistRequest struct {
	OldName string   `json:"oldName,omitempty"`
	Name    string   `json:"name"`
	Songs   []string `json:"songs"`
}

// SaveSetlist handles POST /music/save-setlist. Upserts at body.Name. If
// body.OldName is non-empty and differs from Name, performs a rename
// (delete old, write new) atomically.
func SaveSetlist(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSongUploadBytes)
	var req SaveSetlistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	name, err := sanitizeSetlistName(req.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	songs := req.Songs
	if songs == nil {
		songs = []string{}
	}
	sl := Setlist{Name: name, Songs: songs}
	if err := SetlistSingleton().SaveAndMaybeRename(req.OldName, sl); err != nil {
		http.Error(w, "save error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// ExportSetlistsHandler handles GET /music/export/setlists — used by
// download-songs.sh to snapshot the entire setlists store off-instance.
// Mirrors ExportSongMetaHandler.
func ExportSetlistsHandler(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(SetlistsFilePath())
	if os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
		return
	}
	if err != nil {
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// RestoreSetlistsHandler handles POST /music/restore/setlists — used by
// upload-songs.sh to restore setlists from a local backup. Merges the
// posted object into the existing store (does not delete keys absent
// from the upload). Mirrors RestoreSongMetaHandler.
func RestoreSetlistsHandler(w http.ResponseWriter, r *http.Request) {
	var incoming map[string]Setlist
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if err := SetlistSingleton().Restore(incoming); err != nil {
		http.Error(w, "save error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// DeleteSetlist handles DELETE /music/delete-setlist?name=X.
func DeleteSetlist(w http.ResponseWriter, r *http.Request) {
	name, err := sanitizeSetlistName(r.URL.Query().Get("name"))
	if err != nil {
		http.Error(w, "missing or invalid name", http.StatusBadRequest)
		return
	}
	if err := SetlistSingleton().Delete(name); err != nil {
		http.Error(w, "delete error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
