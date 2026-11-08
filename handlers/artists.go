package handlers

import (
	"errors"
	"slices"
	"strings"
)

// Artist-list limits: names come from hopamchuan.com's search results.
const (
	maxArtists      = 10
	maxArtistLength = 100
)

// cleanArtists trims each name and drops empty ones and duplicates, keeping
// the order. It rejects lists or names over the limits.
func cleanArtists(names []string) ([]string, error) {
	if len(names) > maxArtists {
		return nil, errors.New("too many artists")
	}
	var out []string
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if len(n) > maxArtistLength {
			return nil, errors.New("artist name too long")
		}
		if !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out, nil
}
