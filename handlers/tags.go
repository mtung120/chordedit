package handlers

import (
	"encoding/json"
	"net/http"
	"slices"
)

// TagConfig is the tag set, sent to the browser as data so the editor and
// the library filter apply its rules without per-tag code.
type TagConfig struct {
	// Tags users can apply. Tags in the same group exclude each other: a
	// song has at most one per group.
	Groups [][]string `json:"groups"`
	// A song tagged with a key also matches the filters for its values.
	Implies map[string][]string `json:"implies"`
	// Tags derived from disk (songAutoTags), never stored or edited.
	Auto []string `json:"auto"`
}

var Tags = TagConfig{
	Groups: [][]string{
		{"Verified", "Gig-ready"},
		{"Ballad", "Sôi động"},
	},
	Implies: map[string][]string{
		"Gig-ready": {"Verified"},
	},
	Auto: []string{autoTagAudio, autoTagStems},
}

const (
	autoTagAudio = "Audio" // full mix downloaded or uploaded
	autoTagStems = "Stems" // vocals + backing separated
)

// isKnownTag reports whether tag is one users can apply.
func isKnownTag(tag string) bool {
	for _, g := range Tags.Groups {
		if slices.Contains(g, tag) {
			return true
		}
	}
	return false
}

// songAutoTags derives the Audio / Stems tags from the song's audio files.
func songAutoTags(meta SongMeta) []string {
	full, vocals, accomp := songAudio(meta)
	tags := []string{}
	if full != "" {
		tags = append(tags, autoTagAudio)
	}
	if vocals != "" && accomp != "" {
		tags = append(tags, autoTagStems)
	}
	return tags
}

// SaveSongTagsHandler handles POST /music/save-song-tags
func SaveSongTagsHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SongName string   `json:"songName"`
		Tags     []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if body.SongName == "" {
		http.Error(w, "songName required", http.StatusBadRequest)
		return
	}
	// At most one tag per group, so this also caps the list's size.
	if len(body.Tags) > len(Tags.Groups) {
		http.Error(w, "too many tags", http.StatusBadRequest)
		return
	}
	for _, t := range body.Tags {
		if !isKnownTag(t) {
			http.Error(w, "unknown tag", http.StatusBadRequest)
			return
		}
	}
	tags := body.Tags
	err := SongMetaSingleton().Update(body.SongName, func(sm *SongMeta) {
		if len(tags) == 0 {
			sm.Tags = nil
		} else {
			sm.Tags = tags
		}
	})
	if err != nil {
		http.Error(w, "failed to save tags", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// GetTagConfigHandler handles GET /music/tag-config
func GetTagConfigHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Tags)
}
