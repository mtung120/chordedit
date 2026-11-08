package handlers

import "testing"

func TestShortTitle(t *testing.T) {
	cases := map[string]string{
		"Đêm Đông":                          "Đêm Đông",
		"Exactly twenty-five chars":         "Exactly twenty-five chars",
		"Một Bài Hát Có Cái Tên Rất Là Dài": "Một Bài Hát Có Cái Tên Rấ…",
		"Đêm Nay Ai Đưa Em Về Nơi Xa":       "Đêm Nay Ai Đưa Em Về Nơi…", // cut on a space
	}
	for in, want := range cases {
		if got := shortTitle(in); got != want {
			t.Errorf("shortTitle(%q) = %q, want %q", in, got, want)
		}
	}
}
