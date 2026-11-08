package handlers

// TemplatePath returns the on-disk path for a template name. Single root —
// responsive behaviour is driven entirely by CSS media queries; there is no
// longer a mobile/desktop template split, and as of Stage 5a there is no
// server-side User-Agent sniff either.
func TemplatePath(name string) string {
	return "templates/" + name
}
