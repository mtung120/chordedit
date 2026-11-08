package handlers

import (
	"slices"
	"strings"
	"testing"
)

func TestCleanArtists(t *testing.T) {
	got, err := cleanArtists([]string{" Hoàng Dũng ", "", "Hoàng Dũng", "Sara Lưu"})
	if err != nil || !slices.Equal(got, []string{"Hoàng Dũng", "Sara Lưu"}) {
		t.Errorf("cleanArtists = %v, %v", got, err)
	}
	if _, err := cleanArtists(make([]string, maxArtists+1)); err == nil {
		t.Error("accepted too many artists")
	}
	if _, err := cleanArtists([]string{strings.Repeat("x", maxArtistLength+1)}); err == nil {
		t.Error("accepted a name over the length limit")
	}
}
