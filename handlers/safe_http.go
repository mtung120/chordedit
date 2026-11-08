package handlers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

// maxFetchBytes caps the size of any external response we ingest. 2 MiB is
// well above any real chord-sheet HTML page and well below "OOM the box".
const maxFetchBytes = 2 << 20

// fetchTimeout is the overall request-to-completion timeout.
const fetchTimeout = 30 * time.Second

var (
	safeClientOnce sync.Once
	safeClient     *http.Client
)

// safeHTTPClient returns a process-wide *http.Client whose Transport refuses
// to dial loopback, private, link-local, unspecified, or multicast IPs.
//
// Use this for any HTTP fetch driven by user input (ProxyHandler) so the
// server can't be turned into an SSRF probe — for example fetching
// a router admin UI (e.g. 192.168.1.1), other LAN hosts, or any
// localhost-bound service on the server (e.g. Caddy's admin API on :2019).
//
// There is a small TOCTOU window between the pre-dial DNS check and the
// dial itself; on a single-tenant box this is acceptable. For paranoid
// deployments, override Dialer.Resolver to pin the resolved IP.
func safeHTTPClient() *http.Client {
	safeClientOnce.Do(func() {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		transport := &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, _, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
				if err != nil {
					return nil, err
				}
				if len(ips) == 0 {
					return nil, fmt.Errorf("no addresses for %s", host)
				}
				for _, ip := range ips {
					if isInternalIP(ip.IP) {
						return nil, fmt.Errorf("blocked: %s resolves to internal address %s", host, ip.IP)
					}
				}
				return dialer.DialContext(ctx, network, addr)
			},
			ForceAttemptHTTP2: true,
		}
		safeClient = &http.Client{Timeout: fetchTimeout, Transport: transport}
	})
	return safeClient
}

// isInternalIP reports whether ip belongs to a class that should not be
// reachable from a server-side URL fetcher: loopback (127.0.0.0/8, ::1),
// RFC1918 / RFC4193 private space (the home LAN), link-local
// (169.254.0.0/16, fe80::/10 — incl. cloud metadata endpoints),
// unspecified, or multicast.
func isInternalIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true // unknown shape — refuse rather than dial blind
	}
	addr = addr.Unmap()
	return addr.IsLoopback() ||
		addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsUnspecified() ||
		addr.IsMulticast()
}

// validateExternalURL parses rawURL and confirms it has an http(s) scheme and
// a non-empty host. The IP-class check happens at dial time in
// safeHTTPClient — done there so that SNI / TLS hostname verification still
// operates on the original hostname.
func validateExternalURL(rawURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("only http(s) URLs are allowed")
	}
	if u.Host == "" {
		return nil, errors.New("URL has no host")
	}
	return u, nil
}
