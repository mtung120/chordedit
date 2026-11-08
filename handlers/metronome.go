package handlers

import (
	"encoding/json"
	"net/http"
)

// MetronomeSettings holds per-song metronome configuration.
type MetronomeSettings struct {
	BPM           int      `json:"bpm"`
	TimeSignature string   `json:"timeSignature"`
	BeatAnchor    *float64 `json:"beatAnchor,omitempty"`
	// OffsetMs nudges every click earlier (<0) or later (>0) than the tapped
	// beatAnchor, in 10 ms steps from the Practice panel's metronome sheet.
	OffsetMs int `json:"offsetMs,omitempty"`
}

// maxOffsetMs bounds OffsetMs: past half a second a re-tap is the fix.
const maxOffsetMs = 500

// Allowed time signatures. Used by SaveMetronomeSettingsHandler
// to validate user input — invalid values return 400.
var validTimeSignatures = map[string]bool{
	"2/4": true, "3/4": true, "4/4": true,
	"5/4": true, "6/8": true, "12/8": true,
}

// SaveMetronomeSettingsHandler handles POST /music/save-metronome-settings
func SaveMetronomeSettingsHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SongName      string   `json:"songName"`
		BPM           int      `json:"bpm"`
		TimeSignature string   `json:"timeSignature"`
		BeatAnchor    *float64 `json:"beatAnchor,omitempty"`
		OffsetMs      int      `json:"offsetMs,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.SongName == "" || req.BPM < 20 || req.BPM > 300 {
		http.Error(w, "invalid input", http.StatusBadRequest)
		return
	}
	if !validTimeSignatures[req.TimeSignature] {
		http.Error(w, "invalid timeSignature", http.StatusBadRequest)
		return
	}
	if req.BeatAnchor != nil && *req.BeatAnchor < 0 {
		http.Error(w, "invalid beatAnchor", http.StatusBadRequest)
		return
	}
	if req.OffsetMs < -maxOffsetMs || req.OffsetMs > maxOffsetMs {
		http.Error(w, "invalid offsetMs", http.StatusBadRequest)
		return
	}
	settings := MetronomeSettings{
		BPM:           req.BPM,
		TimeSignature: req.TimeSignature,
		BeatAnchor:    req.BeatAnchor,
		OffsetMs:      req.OffsetMs,
	}
	if err := SongMetaSingleton().Update(req.SongName, func(sm *SongMeta) {
		sm.Metronome = &settings
	}); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}
