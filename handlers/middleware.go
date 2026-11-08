package handlers

import "net/http"

// MethodOnly returns a handler that only accepts the given HTTP method,
// responding 405 Method Not Allowed for anything else. Useful for collapsing
// the repeated `if r.Method != X` boilerplate at the top of every handler.
func MethodOnly(method string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

// GetOnly is shorthand for MethodOnly(http.MethodGet, h).
func GetOnly(h http.HandlerFunc) http.HandlerFunc { return MethodOnly(http.MethodGet, h) }

// PostOnly is shorthand for MethodOnly(http.MethodPost, h).
func PostOnly(h http.HandlerFunc) http.HandlerFunc { return MethodOnly(http.MethodPost, h) }

// DeleteOnly is shorthand for MethodOnly(http.MethodDelete, h).
func DeleteOnly(h http.HandlerFunc) http.HandlerFunc { return MethodOnly(http.MethodDelete, h) }

// GetHead accepts GET and HEAD (useful for endpoints served by http.ServeFile
// which handles HEAD automatically).
func GetHead(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h(w, r)
	}
}

// GetPost dispatches to one of two handlers based on method, 405-ing anything
// other than GET or POST. Used for routes that show a page on GET and accept
// a creation form on POST (e.g. /music/songs).
func GetPost(get, post http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			get(w, r)
		case http.MethodPost:
			post(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}
}
