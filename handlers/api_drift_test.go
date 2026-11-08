package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// TestAPIDrift catches when a Go struct in the API surface gains/loses/renames
// a field without the TypeScript types in src/api/types.ts being updated.
//
// Mechanism: walk every type in `apiTypes` via reflection, emit a stable
// `{type → {field → typeDescription}}` schema, and diff against the
// committed src/api/schema.json. If the schemas differ, the test fails with
// the diff and instructions for fixing.
//
// Add a type here when you add a new API response struct. The companion
// TS interface in src/api/types.ts must mirror it.
func TestAPIDrift(t *testing.T) {
	current := buildSchema()
	got, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		t.Fatalf("marshal current schema: %v", err)
	}
	got = append(got, '\n')

	const schemaPath = "../src/api/schema.json"

	// Bootstrap / refresh mode. Set BOOTSTRAP_API_SCHEMA=1 to overwrite the
	// committed schema with the current shape — useful after an intentional
	// API change that you've also reflected in src/api/types.ts.
	if os.Getenv("BOOTSTRAP_API_SCHEMA") == "1" {
		if err := os.WriteFile(schemaPath, got, 0o644); err != nil {
			t.Fatalf("write %s: %v", schemaPath, err)
		}
		t.Logf("wrote baseline to %s (%d bytes)", schemaPath, len(got))
		return
	}

	want, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf(
			"%s missing. To create the baseline:\n"+
				"  BOOTSTRAP_API_SCHEMA=1 go test -run TestAPIDrift ./handlers/\n"+
				"Then commit %s. After that, this test enforces no-drift.",
			schemaPath, schemaPath,
		)
	}

	if string(got) == string(want) {
		return
	}
	t.Fatalf(
		"API schema drift detected.\n\n"+
			"Either:\n"+
			"  (a) Update the corresponding interface in src/api/types.ts so\n"+
			"      the TS frontend matches Go's new shape, then refresh the\n"+
			"      committed schema:\n\n"+
			"        cat > %s <<'EOF'\n%s\nEOF\n\n"+
			"  (b) Revert the Go change if the field rename was unintentional.\n\n"+
			"Diff (want vs got):\n%s",
		schemaPath, string(got), unifiedDiff(string(want), string(got)),
	)
}

// apiTypes enumerates every Go struct that crosses the wire. Add to this
// list when introducing a new endpoint response. The Go field json:"..."
// tags drive what the TS side sees, so this set is the contract.
var apiTypes = []any{
	// Per-song metadata
	SongMeta{},
	SongMetaResponse{},
	MetronomeSettings{},

	// Home page (template-injected, not fetched, but still part of the contract)
	SongInfo{},

	// Songs CRUD bodies
	struct {
		SongName string `json:"songName"`
		Content  string `json:"content"`
		Version  int    `json:"version"`
	}{}, // SaveChordsRequest

	struct {
		SongName string   `json:"songName"`
		Title    string   `json:"title"`
		Content  string   `json:"content"`
		Artists  []string `json:"artists,omitempty"`
	}{}, // CreateSongRequest (PostSong)

	struct {
		SongName string `json:"songName"`
		NewTitle string `json:"newTitle"`
	}{}, // RenameSongRequest

	// Versions
	SongVersionInfo{},
	struct {
		SongName    string  `json:"songName"`
		FromVersion int     `json:"fromVersion"`
		Label       string  `json:"label"`
		Content     *string `json:"content,omitempty"`
	}{}, // CreateVersionRequest
	struct {
		SongName string `json:"songName"`
		Version  int    `json:"version"`
		Label    string `json:"label"`
	}{}, // SaveVersionLabelRequest

	// Tags
	TagConfig{},
	struct {
		SongName string   `json:"songName"`
		Tags     []string `json:"tags"`
	}{}, // SaveSongTagsRequest
	struct {
		SongName  string `json:"songName"`
		KeyOffset int    `json:"keyOffset"`
	}{}, // SaveSongKeyRequest

	// Metronome
	struct {
		SongName      string   `json:"songName"`
		BPM           int      `json:"bpm"`
		TimeSignature string   `json:"timeSignature"`
		BeatAnchor    *float64 `json:"beatAnchor,omitempty"`
		OffsetMs      int      `json:"offsetMs,omitempty"`
	}{}, // SaveMetronomeSettingsRequest

	// YouTube search
	YouTubeSearchResult{},

	// YouTube settings save
	struct {
		SongName string `json:"songName"`
		VideoID  string `json:"videoId"`
		Title    string `json:"title"`
	}{}, // SaveYouTubeSettingsRequest

	// Stem separation
	separateStemsRequest{},
	separateStemsResponse{},

	// External proxy / scrapers
	ProxyRequest{},
	ProxyResponse{},
	HacSearchResult{},
	HacImportRequest{},
	HacImportResponse{},
	HacImportVersion{},

	// Setlists
	Setlist{},
	SaveSetlistRequest{},
}

// buildSchema produces a sorted, deterministic { typeName: { jsonField: typeDesc } }
// map for the registered API types.
func buildSchema() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, sample := range apiTypes {
		t := reflect.TypeOf(sample)
		if t.Kind() == reflect.Pointer {
			t = t.Elem()
		}
		name := typeName(t)
		out[name] = describeStructFields(t)
	}
	return out
}

// typeName picks a stable name for a struct type. Anonymous structs (used
// inline for request bodies) get a synthetic name from their field set
// so adding a field surfaces as a rename, which is what we want.
func typeName(t reflect.Type) string {
	if t.Name() != "" {
		return t.Name()
	}
	fields := make([]string, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		fields = append(fields, jsonFieldName(t.Field(i)))
	}
	sort.Strings(fields)
	return "anonymous{" + strings.Join(fields, ",") + "}"
}

func describeStructFields(t reflect.Type) map[string]string {
	out := map[string]string{}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		jsonName := jsonFieldName(f)
		if jsonName == "-" {
			continue
		}
		out[jsonName] = describeFieldType(f)
	}
	return out
}

// jsonFieldName reads the json tag, falling back to the field name. Returns
// "-" if the field is explicitly skipped via `json:"-"`.
func jsonFieldName(f reflect.StructField) string {
	tag := f.Tag.Get("json")
	if tag == "" {
		return f.Name
	}
	name, _, _ := strings.Cut(tag, ",")
	if name == "-" {
		return "-"
	}
	if name == "" {
		return f.Name
	}
	return name
}

// describeFieldType returns a human-readable type signature, including
// "|omitempty" when the json tag has that option, and a "*" prefix for
// pointer types (which the TS side maps to optional fields).
func describeFieldType(f reflect.StructField) string {
	desc := goTypeName(f.Type)
	if tag := f.Tag.Get("json"); tag != "" {
		_, opts, _ := strings.Cut(tag, ",")
		if strings.Contains(","+opts+",", ",omitempty,") {
			desc += "|omitempty"
		}
	}
	return desc
}

func goTypeName(t reflect.Type) string {
	switch t.Kind() {
	case reflect.Pointer:
		return "*" + goTypeName(t.Elem())
	case reflect.Slice:
		return "[]" + goTypeName(t.Elem())
	case reflect.Map:
		return fmt.Sprintf("map[%s]%s", goTypeName(t.Key()), goTypeName(t.Elem()))
	case reflect.Struct:
		if t.Name() != "" {
			return t.Name()
		}
		return "struct{...}"
	default:
		return t.Kind().String()
	}
}

// unifiedDiff is a tiny line-by-line diff for fail messages — avoids pulling
// in a third-party diff library.
func unifiedDiff(want, got string) string {
	wantLines := strings.Split(want, "\n")
	gotLines := strings.Split(got, "\n")
	max := len(wantLines)
	if len(gotLines) > max {
		max = len(gotLines)
	}
	var b strings.Builder
	for i := 0; i < max; i++ {
		var w, g string
		if i < len(wantLines) {
			w = wantLines[i]
		}
		if i < len(gotLines) {
			g = gotLines[i]
		}
		if w == g {
			continue
		}
		if w != "" {
			fmt.Fprintf(&b, "  - %s\n", w)
		}
		if g != "" {
			fmt.Fprintf(&b, "  + %s\n", g)
		}
	}
	return b.String()
}
