package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMethodOnly(t *testing.T) {
	called := 0
	h := MethodOnly(http.MethodPost, func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	})

	for _, m := range []string{http.MethodGet, http.MethodDelete, http.MethodPut, http.MethodPatch} {
		w := httptest.NewRecorder()
		h(w, httptest.NewRequest(m, "/x", nil))
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", m, w.Code)
		}
	}
	if called != 0 {
		t.Errorf("inner handler ran %d times for non-POST methods, want 0", called)
	}

	w := httptest.NewRecorder()
	h(w, httptest.NewRequest(http.MethodPost, "/x", nil))
	if w.Code != http.StatusOK {
		t.Errorf("POST: status = %d, want 200", w.Code)
	}
	if called != 1 {
		t.Errorf("inner handler ran %d times for POST, want 1", called)
	}
}

func TestGetPost(t *testing.T) {
	getCount, postCount := 0, 0
	h := GetPost(
		func(w http.ResponseWriter, r *http.Request) { getCount++; w.WriteHeader(http.StatusOK) },
		func(w http.ResponseWriter, r *http.Request) { postCount++; w.WriteHeader(http.StatusOK) },
	)

	h(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/x", nil))
	h(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/x", nil))
	if getCount != 1 || postCount != 1 {
		t.Errorf("get=%d post=%d, want 1/1", getCount, postCount)
	}

	w := httptest.NewRecorder()
	h(w, httptest.NewRequest(http.MethodDelete, "/x", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE: status = %d, want 405", w.Code)
	}
}
