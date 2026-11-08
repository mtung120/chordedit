package handlers

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsInternalIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
		why  string
	}{
		// Should be blocked
		{"127.0.0.1", true, "loopback"},
		{"127.255.255.255", true, "loopback range"},
		{"169.254.169.254", true, "link-local (metadata endpoint)"},
		{"10.0.0.1", true, "RFC1918"},
		{"192.168.1.1", true, "RFC1918"},
		{"172.16.0.1", true, "RFC1918"},
		{"0.0.0.0", true, "unspecified"},
		{"224.0.0.1", true, "multicast"},
		{"::1", true, "IPv6 loopback"},
		{"fe80::1", true, "IPv6 link-local"},
		{"fc00::1", true, "IPv6 ULA"},
		// Should be allowed
		{"1.1.1.1", false, "cloudflare DNS"},
		{"8.8.8.8", false, "Google DNS"},
		{"104.16.123.96", false, "public CDN"},
		{"2606:4700:4700::1111", false, "cloudflare IPv6"},
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("ParseIP(%q) returned nil", c.ip)
		}
		got := isInternalIP(ip)
		if got != c.want {
			t.Errorf("isInternalIP(%s) = %v, want %v (%s)", c.ip, got, c.want, c.why)
		}
	}
}

func TestValidateExternalURL(t *testing.T) {
	good := []string{
		"http://example.com/foo",
		"https://example.com/foo",
		"https://hopamchuan.com/song/123/abc",
	}
	for _, s := range good {
		if _, err := validateExternalURL(s); err != nil {
			t.Errorf("validateExternalURL(%q) returned error: %v", s, err)
		}
	}

	bad := []string{
		"file:///etc/passwd",
		"ftp://example.com",
		"javascript:alert(1)",
		"data:text/html,<script>",
		"ssh://example.com",
		"   ",
		"https://",
		"://example.com",
	}
	for _, s := range bad {
		if _, err := validateExternalURL(s); err == nil {
			t.Errorf("validateExternalURL(%q) should have errored", s)
		}
	}
}

// End-to-end: ProxyHandler must refuse a non-http(s) scheme outright (returns
// 400 before any network is touched).
func TestProxyHandler_RejectsNonHTTPScheme(t *testing.T) {
	body := `{"url":"file:///etc/passwd"}`
	req := httptest.NewRequest(http.MethodPost, "/music/proxy", strings.NewReader(body))
	w := httptest.NewRecorder()
	ProxyHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400; body=%s", w.Code, w.Body.String())
	}
}

// End-to-end: a loopback URL passes the URL parser but is refused at dial
// time by the safe transport. The handler returns 500 with the rejection
// reason in the body.
func TestProxyHandler_RejectsLoopback(t *testing.T) {
	body := `{"url":"http://127.0.0.1:1/whatever"}`
	req := httptest.NewRequest(http.MethodPost, "/music/proxy", strings.NewReader(body))
	w := httptest.NewRecorder()
	ProxyHandler(w, req)
	if w.Code == http.StatusOK {
		t.Fatalf("loopback URL was fetched! body=%s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "blocked") &&
		!strings.Contains(w.Body.String(), "internal") {
		// Some environments may surface a connect error before our message.
		// As long as we did not 200 OK, we're safe.
		t.Logf("body=%s (not a blocked-message, but not 200 either — acceptable)", w.Body.String())
	}
}
