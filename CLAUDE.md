# CLAUDE.md

Single source of truth for **ChordEdit**. A new session should be able to
resume work from this file alone. Companion docs:
- `README.md` — local dev setup + test-suite guide
- `DEPLOYMENT.md` — running it on your own server and domain (provision,
  deploy, logs, backup/restore, troubleshooting)

Keep these in sync when behavior changes, and describe the app as it is
now — history belongs in git, not here. Don't create new top-level notes
files; extend these instead.

## Project overview

ChordEdit is a web app for storing Vietnamese song lyrics with inline
chords and practising and performing them. It was built for one guitarist
who plays with a band from a **foldable iPhone** — landscape and upright —
usually through the **Home Screen web app**, so phones, the fold's two
shapes and that web app are the primary targets.

Stack: thin Go `net/http` backend (no framework, no DB, file storage) +
vanilla TypeScript frontend bundled by Vite. One responsive UI — layout is
pure CSS `@media`; no server-side device sniffing.

### Screens and layouts

| Layout | Query | Who |
|---|---|---|
| Phone | `max-width: 767.98px` | phones; a foldable upright (~700px) |
| Desktop | `min-width: 768px` | laptops, desktops |
| Wide touch | `min-width: 768px` + `orientation: landscape` + `pointer: coarse` | foldables / tablets in landscape: the desktop layout with 44px targets, paged Perform |

The Home Screen app gets the same layout as Safari, with no separate
version (a bottom header bar for it was tried and dropped as more trouble
than it saved). It still differs from Safari in ways that matter:
- **No Safari bars.** `viewport-fit=cover` + `black-translucent`: pages run
  under the status bar; `body` pads by `env(safe-area-inset-*)` (0 on
  wide touch screens' song page). Since an iOS update in late October
  2026, iOS keeps a foldable iPhone's side status bar strip out of the Home Screen
  app's viewport in landscape (measured: 867pt wide, inset 0; the Oct 27
  build ran full width before the update and is narrow after it), so
  lyrics stop short of it there; Safari uses the full width. A web page
  can't claim that strip.
- **Dead top strip.** After a tap on the status bar's Wi-Fi / battery menu,
  iOS keeps catching taps across the top strip until the next rotation, so
  the header row's tabs can stop responding until you rotate (Safari's tab
  bar fills that strip). The header sits 12px below the edge on wide touch
  screens, since iOS swallows taps flush with it.
- **Memory restarts.** iOS restarts a web app that holds too much memory,
  and a restart opens `start_url` (the library), which looks like the app
  jumping home by itself. So audio loads only in Practice (Architecture →
  Audio).
- **No Back button.** The logo link is the way out of a song.

## Features

### Song library (`/music/songs`)

- **Search or add a song** (`home/addSong.ts`): one filled field. While
  there's a query only results show: library matches first ("In your
  library"; filters don't apply; artist names match too), then
  hopamchuan.com — searched by itself 1 s after typing stops when the
  library has no match, otherwise offered as a "Search hopamchuan.com"
  row; Enter searches right away — then **Blank song** ("New song XXXX",
  opens in Edit with Raw text open via `&edit=raw`, which `songMode.ts`
  drops from the URL).
  - A hopamchuan result opens a preview (bottom sheet / dialog): the whole
    song and "Version 1 of N" (up to 4: hopamchuan's main version, then by
    chord simplicity). **Add song** creates it — slug = title without
    accents ("Dem Dong", then " 2", " 3"… if taken), title and artists in
    meta — and opens it.
  - A result whose title matches a library song (no case, accents, extra
    spaces; hyphens = spaces) becomes a new version of it instead
    (`create-version` with `content`, label "hopamchuan"; artists not
    set). Duplicates are found by title only; no hopamchuan ID is stored.
- **Setlists** section (rows with song counts, New setlist).
- **Recently played**: top 8 by last access, as filled chips.
- **Filter row**: an Artist chip, a hairline divider, then tag chips. All
  filters AND together and live in the URL (`?tag=…&artist=…`).
- **Song rows**: number, title, artists in grey (below the title on phones,
  after it on the same line elsewhere), Audio / Stems icons on the right.
  Pagination.
- **Tags** — rules are data, not code: `TagConfig` in `handlers/tags.go`
  (sent as `window.tagConfig` and `GET /music/tag-config`):
  - `groups`: readiness **Verified** (chords checked) / **Gig-ready**
    (chords + play styles polished), and energy **Ballad** / **Sôi động**.
    A song has at most one per group; adding one replaces the other
    (`withTag`, `src/utils/tags.ts`).
  - `implies`: Gig-ready matches the Verified filter (`matchesTag`).
  - `auto`: **Audio** (full mix on disk) and **Stems** (vocals + backing on
    disk), derived per request by `songAutoTags`, never stored; icons in
    rows (♫ notes / mixer faders), icon + label in the filter row.
  - Set in Edit ⋮ → Tags…; per song, not per version. The server rejects
    unknown tags and more tags than groups.
- **Artists** — home page only, never on the song page, no editor:
  `artists` (a list) in song meta, saved when a song is added from
  hopamchuan (`cleanArtists` in `handlers/artists.go`: trim, dedupe, ≤10 ×
  100 chars). **Artist filter** (`home/artistPicker.ts`): the chip opens a
  bottom sheet on phones / a 320px popover under the chip elsewhere —
  search field, artists by song count, then "No artist". One artist at a
  time (`?artist=Name`; `?artist=` = no artist). Once picked the chip turns
  dark with the name (reopens the picker) and a × (clears).

### Setlists (`/music/setlist?name=X`)

Ordered song collections: view / edit toggle, debounced auto-save, rename,
add songs with a filled search. A name that doesn't exist yet opens in edit
mode and is created on the first save.

### Song page (`/music/song?songName=X[&v=N][&setlist=Y]`)

- **Header row**: logo · title (at most 25 characters, then "…" —
  `shortTitle` in `render.go` and `utils/text.ts`, keep both at 25; the full
  title is in `data-title` and the hover `title`) · mode tabs **Edit /
  Practice / Perform** (quiet text, right-aligned; `songMode.ts`,
  `body[data-mode]`). Songs always open in Perform.
- **Display bar** in every mode (quiet grey text, no boxes, left edge on the
  lyrics): version dropdown (switch / + New / Rename / Delete; "Bản chính" =
  version 0; Perform shows it only with 2+ versions — `data-many`), then
  ♭ **Key G ▾** ♯. Edit adds its ⋮ menu (Raw text, Tags…, Rename,
  Delete): dark dots on a filled chip, dark while open.
- **Key** (`keySelector.ts`; rules in `utils/chords.ts`): the key is
  detected from the chords on every render, major only (Am → C): the
  first home chord's key and the last chord's (a final V7
  points to its key); when they differ, the one more chords belong to wins.
  Charts that start on IV and end after a key change can come out wrong
  (about 1 song in 12 on a real library). ♭ / ♯ move one
  semitone; the menu (12 keys in a 4 × 3 grid, each over its relative
  minor) moves in one tap. Notes are spelled from the new key: sharp keys
  (G D A E B F♯) with sharps, the rest with flats, F♯ in C; chord types
  ("m7b5") are untouched. **Perform and Practice only change the screen**
  (a guitarist with a capo and a keyboard player on the original key); Edit
  saves, and entering Edit re-renders the stored song; a reload shows the
  stored key. **Wrong key? Set it** (Edit only, at the menu's foot) turns
  the menu into "The song is in": the next pick relabels the song without
  moving a chord, saved per song (not per version) as `keyOffset` in song
  meta — semitones from the detected key, so it survives transposing
  (`/save-song-key`, `window.songKeyOffset`).
- **From a setlist** (`&setlist=Y`): the Display bar adds "Friday gig · 2/7"
  (links back) and ‹ › to the previous / next song (`setlistContext.ts`;
  its own line on phones).
- **Lyrics**: paragraphs have the same box in every mode, so nothing moves
  when switching. Each paragraph is optional `.section-header` blocks + one
  `.song-line` per lyric line, with a 1.2em hanging indent for wrapped
  parts. Chord chips show `#` / `b` as `♯` / `♭` (storage stays ASCII).
  Inline play instructions (`{drum fills}` in a line) render as blue
  italic text; a header's play style (`(Verse 1{Soft})`) shows right-aligned
  in grey small caps.
- **Perform**: lyrics only, plus the tempo ("90 BPM", beside the title on
  desktop, after the Display controls on phones). On wide touch screens
  **paged Perform** (`songPager.ts`, `PAGED_QUERY` mirrors the CSS query):
  screen-high columns, two to a screen, turned by tapping the left / right
  third, swiping, or arrows / PageUp / PageDown / Space (page-turner
  pedals); "1 / 3" (turns) bottom right; sections may split across columns
  (orphans / widows 2). A "Half page" / "Full page" quiet button in the
  Display row picks the turn size (per device, `localStorage`
  `chordedit.pageTurn`; half by default): a half turn moves one column — the
  right column slides left and the incoming one, under a white cover that
  rides in with it, fades in — so a press any time while reading the right
  column keeps you ahead; a full turn moves a whole screen. From a setlist,
  a turn past the end opens the next song and back from the start the
  previous one.
- **Edit** — everything live at once, auto-saves 1 s after the last change:
  - Tap a chord or word → **chord dialog**: C-major diatonic chords + custom
    ones drawn as the red chips they insert, "Change every C in the song"
    switch, filled "Other chord" field + one dark button, Delete chord as
    red text; Escape closes it.
  - **Section palette** (`sectionPalette.ts`): tap a chip (it turns dark),
    then a paragraph → sets its header, keeping any play style. While picked,
    paragraphs are outlined and a word tap applies the header instead of
    opening the chord dialog. Tapping the chip again, Escape, a tap outside
    the lyrics, leaving Edit, or 3 s idle (a line under the label runs out;
    scrolling restarts it) drops the pick. Chips are equal width; "Pre"
    writes `(Pre-Chorus)`. Fixed to the bottom on phones and wide touch
    screens, sticky above the lyrics on desktop. Only Verse is numbered:
    every change renumbers Verse headers 1, 2, 3… in song order.
  - Double-click (desktop) / long-press (touch) a paragraph → inline raw
    edit: add play styles, remove headers; emptying it deletes the
    paragraph. Raw text (⋮) edits the whole file.
- **Practice** (`videoPlayer/`):
  - **Source line**: "Source  <title> · Change"; a YouTube title links to
    the video on youtube.com (there is no embedded player). The **source
    picker** (no audio yet, or Change): "Source [YouTube | Upload mp3] …
    Cancel", then the filled search field prefilled with the song's title +
    dark Search, or a filled "Choose an mp3" + dark Upload that waits for a
    file; results are a hairline list.
  - **Transport**: ▶ (dark circle), ↺5 / 5↻, a thin scrubber with the played
    part dark, time.
  - **Stems**: Full / Vocals / Backing, or "Separate stems" (Demucs on the
    server, ~1× song length, one job at a time).
  - **Speed**: slider 50–120% in 5% steps; the value rides in the label
    ("Speed 85%"); pitch is corrected for any rate (−12·log2(rate)).
  - **Pitch**: − 0 + stepper. Speed and Pitch show Reset beside their label
    only when changed.
  - **Metronome**: a switch + "72 BPM · 4/4" chip, or "Set up". The chip
    opens the metronome sheet (`metronomeSheet.ts`):
    - Setup: three steps and a dark tap pad — a tap while paused plays the
      song, then each tap marks a beat; `fitTaps` (`tapTempo.ts`) fits a
      line through the run's song positions, so the tempo is the record's
      at any speed and beat 1 is the fitted last tap.
    - Set up: BPM − / +, "Clicks early or late?" ‹ › in 10 ms steps
      (`offsetMs`, ±500, kept apart from the tapped `beatAnchor`), Tap
      again.
    - Both: play / pause, beat dots that follow the clicks, Beats per bar
      (2/4 3/4 4/4 5/4 6/8 12/8).
  - **Layout**: phones put labels above controls — two settings a line from
    560px (foldable upright: Stems · Speed, Pitch · Metronome); narrower, Stems
    and Speed get a line each and Pitch · Metronome share one. Desktop:
    one wrapping line, each label before its control. Wide touch: the same
    line, labels above (absolutely positioned, so they never widen it).
  - Leaving Practice pauses playback.
- **Wide touch screens**: one header row (logo · title · Display controls ·
  Edit's ⋮ … tabs; mode panels below it), 44px controls everywhere; Edit /
  Practice scroll in 2 columns with Perform's 40px gap and line-height 1.4.
- Screen wake lock while a song is open.
- **Guitar Pro tabs**: backend routes and data only (`tab.go`); no UI.

### Logo and Home Screen app

- **Logo**: a red chord chip (`#EF4444`) above a white lyric line on a dark
  tile (`#18181B`) — inline in the templates (`.site-logo` >
  `svg.logo-mark`), `static/images/favicon.svg` and the app icons. One bold,
  high-contrast shape because iOS derives the Dark / Tinted / Clear icons
  from one flat PNG. The home page shows the name "ChordEdit" (Inter 600)
  beside it on every screen; song and setlist pages show the symbol alone.
  The link's accessible name is "ChordEdit".
- **Web app**: `static/manifest.webmanifest` (standalone, start
  `/music/songs`, scope `/music/`) + Apple meta tags in all three templates;
  icons `static/images/icon-{180,192,512}.png` (full-bleed; the 512 one also
  maskable).

### Song file format (`<slug>.txt`)

```
(Intro)
[C] [G] [Am] [F]

(Verse 1{Strum})            ← section header; {…} = play style
[C]Lyric with [G]chords {drum fills}

(Chorus)
[F]One and [C]done
```
Paragraphs are separated by one blank line; headerless paragraphs are
allowed. The parser ignores a trailing `[…]` in a header (old repeat
markers). Parser: `src/features/songView/parser.ts`; serializer (DOM →
text): `serializer.ts` — headers on their own line, one blank line between
paragraphs. The server also collapses 3+ newlines on save.

## Design system

One system for every page: modern, quiet, elegant — content first, chrome
in grey, one dark action per screen. Follow it strictly; when something new
needs a pattern, reuse one below before inventing one. Proposals for UI
redesigns go to the owner as a visual mockup first.

### Color
- **Neutrals: the zinc scale only.** `#18181B` text, primary buttons,
  selected states · `#3F3F46` primary hover / pressed · `#52525B` secondary
  text, unselected segments · `#71717A` quiet text (labels, counts,
  placeholders, link buttons) · `#D4D4D8` grabbers, switch track off ·
  `#E4E4E7` borders, hover fills on fills · `#F4F4F5` fills, tracks, chips,
  hairlines between rows · `#FAFAFA` rare subtle grounds · `#FFFFFF` ground.
- **Never `#A1A1AA` for text people read** (2.6:1); `#71717A` (4.8:1) is the
  lightest readable grey. All readable text meets WCAG AA 4.5:1.
- **Hues have one job each:** chord red `#C81E1E` on its `#F4F4F5` chip
  (5.2:1); destructive red `#DC2626` text (Delete, remove) with a
  `#FEF2F2` hover; play-instruction blue `#2563EB` (also the inline rename
  underline); logo red `#EF4444` only in the logo. No other hues, no
  gradients.
- Overlays behind sheets and dialogs: `rgba(24, 24, 27, 0.32)`.

### Type
- **Inter** for UI chrome; **Lexend** (`--song-font`) for song content —
  lyrics, chords, section headers. Children inherit; declare a family only
  to override. ♯ / ♭ in chords use system-ui (Lexend's are too wide).
- Lyrics: 16px on phones, 18px on desktop (fixed; no A− / A+), line height
  ~1.4–1.5, ≤ ~60 characters a column. Chords 1.12em, weight 500, 0.25em
  side padding, 0.2em before the next word. Section headers 0.8em Lexend
  700 caps, tracking 0.08em; sections ~1.5 lines apart.
- **Labels**: 11px, weight 600, uppercase, tracking 0.06em, `#71717A`
  (SOURCE, STEMS, RECENTLY PLAYED, BEATS PER BAR). All-caps text always
  tracks 0.05–0.08em.
- Controls 13–14px on desktop, 14–16px on touch; inputs on phones are
  ≥ 16px (iOS zooms smaller ones). Numbers that change use tabular figures.
- Sentence case everywhere ("New setlist", "Add song", "Tap again").
- Status messages are short and plain ("Preparing audio…"); no percentages.

### Shape and space
- **Touch targets**: 44px minimum on phones and wide touch screens, 32px on
  desktop (set inside the media blocks). Link-style buttons (Reset, Cancel,
  ×) may be smaller.
- A control's visible shape can be smaller than its hit area: draw tracks
  and fills with `::before` layers (segmented controls, the metronome chip,
  the ⋮ chip) so a 36px-looking control still has a 44px target.
- Radii: 4px chord chips · 8px fields, buttons, rows · 9–10px tracks and
  chips · 14px dialogs · 16px sheet tops and the tap pad · 999px pill chips
  and switches.
- Edges: phones share one 12px gutter on the song page (`--song-gutter`;
  logo, Display bar, panels and lyrics all start there) and 16px on library
  pages; desktop library pages are one centred 720px column.
- Separation by space and hairlines (`#F4F4F5` / `#E4E4E7`), not boxes: no
  bordered cards, no drop shadows except on floating things (dialogs,
  popovers, the raised segment).

### Components (reuse these)
- **Primary button**: dark `#18181B`, white text, `#3F3F46` on hover /
  press; at most one per screen (Search, Upload, Add song, Done, the chord
  dialog's add). Disabled: `#E4E4E7` with `#71717A` text.
- **Outlined button**: white, 1px `#E4E4E7` border — secondary actions (New
  setlist, Edit, Tap again).
- **Quiet text button**: `#71717A` text, no box, `#F4F4F5` fill + `#18181B`
  text on hover / press (Change, Cancel, Reset, mode tabs, Display
  controls).
- **Segmented control** (`.vp-seg`): a `#F4F4F5` track, equal segments, the
  selected one raised white with a soft shadow; no hover fills (the raised
  segment is the state). Used for option sets (Stems, YouTube / Upload mp3,
  Beats per bar). A one-segment track is an action (Separate stems).
- **Stepper**: − value + in a segmented track (Pitch).
- **Switch**: `role="switch"`, 36×22 track (`#D4D4D8` off, `#18181B` on)
  with a white knob; "On" / "Off" as visually hidden text.
- **Slider**: thin 4px track, played / chosen part dark, dark round thumb
  (scrubber, speed).
- **Filled chip**: `#F4F4F5` with dark text and a › chevron when it opens
  something (metronome chip, Recently played chips).
- **Outlined pill chip**: filters (tags, Artist); selected = dark fill.
- **Search field**: filled `#F4F4F5`, magnifier icon, no border; white with a
  `#71717A` border and a faint ring on focus.
- **Rows**: inset hairlines between them, a hover / press fill that runs
  `--row-inset` past the text; no → arrows; 56px tall on phones.
- **Sheets and dialogs**: a bottom sheet on phones (16px top radius, a
  36×5 `#D4D4D8` grabber), a centred dialog elsewhere (14px radius, a
  soft large shadow), a dimmed overlay. Escape and a tap outside close
  them; Done or × in the head; focus returns to the opener. Small menus
  are popovers anchored to their button (upward when the button sits at
  the bottom).

### Interaction and layout rules
- **Phone and desktop are separate surfaces.** Layout properties
  (`display`, `flex-direction`, `padding`, `gap`, `font-size`, `order`, …)
  go in the viewport's `@media` block; the shared preamble holds only what
  is identical everywhere (colors, radii, component looks). A "mobile base
  + desktop override" leaks across viewports.
- Nothing jumps: the same box for lyrics in every mode; labels that must
  not widen a row are positioned absolutely; fixed widths (not flex-basis)
  for controls whose intrinsic size differs (sliders).
- Song header is not sticky on desktop.
- Thumb reach on touch: frequent tools at the bottom (section palette,
  sheets).
- Accessibility as drawn: real `<button>` / `<a>` / `<input>` + label,
  `aria-label` on icon buttons, `role="switch"` / `role="dialog"`, visible
  focus.

### Checking a design change
Look at it at the four layouts that matter — phone 390, foldable upright
700, foldable landscape 1000×703 touch, desktop 1280 — on the running dev server
(`npm run build`; restart `go run main.go` after Go changes). Prefer
element-level screenshots for layout assertions (the 1% full-page tolerance
misses shifts); review every diff before updating baselines. iOS-only
behaviour (Safari layout quirks, the Home Screen app) can't be reproduced
in the local Chromium: say so and ask for a check on a real device.

## Build, run, test

```bash
go run main.go              # http://localhost:8080/music/ (uses ./songs; reads gitignored .env)
npm run dev                 # Vite on :5173, proxies /music + /static to :8080
./build.sh                  # npm ci + vite build + go build -o music

go test ./...               # Go unit tests (handlers/*_test.go)
npm run typecheck           # tsc on src/ + tests/
npm run test:unit           # Vitest (src/**/*.test.ts)
npm run test:e2e            # Playwright functional (186 tests)
npm run test:visual         # Playwright visual, 4 viewports (80 tests)
npm run test:all            # all Playwright projects
./deploy.sh [--backup|--rollback]  # gates → build → your server (DEPLOYMENT.md)
./server.sh status          # server health (also logs/restart/backup/provision)
```
Stop any local Go server before Playwright — the harness spawns its own
per-worker servers — and `npm run build` first: Playwright loads the built
bundle, not `src/`. Details in `README.md`.

## Known issues & backlog

**Known issues:**
- Foldable upright, song without audio: the YouTube search row's Search button
  can overflow the right edge on first load until a scroll. iOS only, not
  reproducible in Chromium; a flex-basis 0 / min-width 0 fix didn't help.
- YouTube titles can show `&amp;` / `&#39;`: the YouTube Data API returns
  HTML-escaped titles and `youtubeVideoTitle` stores them as is
  (`handlers/youtube.go`); unescape on save and fix the stored ones.
- Verse auto-renumbering turns deliberately repeated "Verse 1" labels into
  Verse 1, 2, 3.

**Hardening:**
1. Uploaded-audio ID = sha256(original filename)[:8]; two different files
   with the same name overwrite each other's audio / stems.
2. `SaveVersionLabelHandler` / `SaveYouTubeSettingsHandler` don't run
   `sanitizeSongName` on the slug (metadata keys only, not paths).
3. `/restore/song-meta` accepts any `youtubeVideoId` without
   `validVideoID` (audio paths ignore unsafe IDs, but they land in meta).

**Code health:**
- `songView.ts` (~990 lines) and `videoPlayer/videoPlayer.ts` (~1,460) are
  the big files; the chord dialog and paragraph editor could move out of
  `songView.ts`.
- Some same-scope group-rule + per-selector override pairs remain in
  `styles.css`.
- CI's visual job is `continue-on-error` (macOS baselines vs Linux runner).

**Decided against — don't re-propose without new information:**
- In-browser practice video recording (iOS MediaRecorder was poor; a
  camera or the phone's screen recording does the job).
- Click a chord to hear it with a synth (didn't sound like a guitar; if
  revisited, a sampled guitar via Tone.Sampler).
- Automatic chord detection (madmom): too inaccurate and too slow on the
  server to be useful.
- An embedded YouTube player (muted, unsynced, memory-heavy); an artist
  editor (the hopamchuan list is enough).

## Architecture

### Backend (`main.go` + `handlers/`)

`main.go` (~100 lines) is the route table; `handlers.Init()` loads the
YouTube API key and the in-memory stores. `handlers/` has 26 source files
+ 15 `_test.go` files.

**Infrastructure**
- `middleware.go` — `GetOnly`, `PostOnly`, `DeleteOnly`, `GetHead`,
  `GetPost`. Every route uses one; handlers never check `r.Method`.
- `atomic.go` — `atomicWriteFile()` (temp + fsync + rename).
- `safe_http.go` — SSRF-blocking `safeHTTPClient()` + `validateExternalURL`
  (blocks loopback, RFC1918 incl. the LAN, link-local, multicast); 2 MB
  response cap.
- `songs_dir.go` — all data paths (`SongsDir()`, `SongFilePath`,
  `SongVersionFilePath`, `AudioDir`, …), `sanitizeSongName()`,
  `ValidAudioFilename()`, version-file helpers.
- `render.go` — `renderHTML` / `writeJSON` + template funcs (`shortTitle`).
- `vite.go` — reads `static/dist/.vite/manifest.json` for `{{vite "song"}}`
  and re-reads it when it changes, so a running server survives
  `npm run build`. `assets.go` — `{{asset}}` content-hash query strings,
  re-hashed when a file's mtime / size changes (`/static/` is
  immutable-cached). `static.go` — gzip + immutable caching for `/static/`.
- `device.go` — `TemplatePath()` only.
- `test_admin.go` — `/music/__test__/reload-state` (re-reads access
  times, song meta and setlists from the per-test seed), 404 unless
  `CHORDEDIT_TEST_MODE=1`.
- `api_drift_test.go` — fails if Go request / response structs drift from
  `src/api/schema.json` (refresh: `BOOTSTRAP_API_SCHEMA=1 go test -run
  TestAPIDrift ./handlers/`).

**Features**
| File | Responsibility |
|---|---|
| `home.go` | Home page data (songs, titles, tags, artists, recent, setlists); `PostSong` (create, optional `artists`); `/new-song` → 301 home |
| `song.go` | Song view page, save/delete/rename/upload/list, versions (`song-versions`, `create-version` — a clone, or given `content`, `delete-version`) |
| `song_meta.go` | `SongMetaStore` (cached `.song-meta.json`), `/song-meta` (derives audio availability from disk via `songAudio`), version labels, export/restore |
| `proxy.go` | hopamchuan.com: URL proxy, search (with artists), versions list + chord-complexity scoring, HTML → ChordEdit format |
| `audio.go` | yt-dlp download (async, temp dir + rename, dedup by videoId), cookies upload, audio upload, `/audio` serving, `appPython()` |
| `stems.go` | Demucs stem separation (`/separate-stems`: POST starts, GET polls; async, one job at a time, temp dir + rename) |
| `tab.go` | Guitar Pro upload/serve/remove (≤5 MB, `.gp/.gp3/.gp4/.gp5/.gpx`); no UI |
| `setlist.go` / `setlist_handlers.go` | `SetlistStore` (`.setlists.json`) / HTTP layer incl. export/restore |
| `youtube.go` | YouTube Data API search (`YOUTUBE_API_KEY`), save video selection |
| `metronome.go` | Metronome settings (`bpm`, `timeSignature`, `beatAnchor`, `offsetMs` ±500) |
| `tags.go` | `TagConfig` (groups / implies / auto tags), `songAutoTags`, `/tag-config`, save tags |
| `artists.go` | `cleanArtists` |
| `access_tracker.go` | `.access_times.json` for Recently Played |

### Data storage (all under `SONGS_DIR`; prod `/var/data/chordedit/songs`, dev `./songs`)

- `<slug>.txt` — default version; `<slug>.v<N>.txt` — alternate versions.
  The slug (filename) never changes; "rename" only sets `title` in meta.
- `.song-meta.json` — `{slug: {title, tags, artists, metronome, youtubeVideoId,
  youtubeVideoTitle, audioSource, uploadedAudioId, uploadedAudioName,
  versionLabels, guitarTab, keyOffset}}`.
- `.setlists.json` — `{name: {name, songs: [slug…]}}`.
- `.access_times.json` — `{slug: RFC3339}`.
- `.yt-cookies.txt` — yt-dlp auth cookies (secret, mode 0600).
- `audio/youtube/<videoId>_{full,vocals,accompaniment}.mp3`
- `audio/upload/<uploadId>_{full,vocals,accompaniment}.mp3`
- `<original name>.gp*` — Guitar Pro tabs, referenced by `guitarTab`.

Audio is keyed by video / upload ID, not song, so songs sharing a video
share audio and stems. **Audio availability and the Audio / Stems tags are
derived from disk** — never store audio filenames in metadata.
`audioSource` (`youtube` | `upload`) is mutually exclusive.

Stores (`SongMetaStore`, `SetlistStore`, `AccessTracker`) are singletons
with an in-memory map + `sync.RWMutex`, flushed atomically on each write —
so a script that edits `.song-meta.json` must run with the service stopped.

### Frontend (`src/` → `static/dist/`)

Three Vite entries (`src/entries/{home,song,setlist}.ts`) map to three
templates in `templates/`. Templates inject initial data as `window.*`
globals; feature modules mount themselves on import. The only
module-published global is `window.songView` (used by `songMode` and the
specs). Modules talk via DOM events: `songmode:change`, `key:change`,
`metronome:change`.

- `routes.ts` — every URL the server exposes; never build URLs inline.
- `api/client.ts` (typed fetch, `ApiError`/`NetworkError`), `api/types.ts`
  (mirrors Go structs), `api/schema.json` (drift snapshot).
- `state/songMetaStore.ts` (one `/song-meta` fetch per page),
  `state/setlistStore.ts`.
- `utils/`: `chords.ts` (key detection, spelling, transpose, ♯/♭ display), `escape.ts`, `tags.ts`
  (tag rules), `text.ts` (title matching, `shortTitle`), `popover.ts`
  (dropdown open / close for the version picker, key menu + Edit ⋮).
- `features/`: `songMode/` (mode switcher, Perform tempo, Edit ⋮),
  `keySelector/` (the key menu), `songView/` (render + editing + `autoSave`, `parser`,
  `serializer` — skips `.edit-chrome` UI, `sectionPalette`), `videoPlayer/`
  (Practice: `videoPlayer.ts` — source, transport, stems, speed, pitch,
  metronome timing; `metronomeSheet.ts`; `tapTempo.ts`), `versionSelector/`,
  `tagEditor/`, `songPager/` (paged Perform), `wakeLock/`,
  `setlistContext/`, `setlistEditor/`, `home/` (song list, artist picker,
  setlists, add-song flow), `form/` (song page's Delete / Rename).

**Audio:** Tone.js plays everything, from the server's mp3 (yt-dlp download
or upload). Position = `playStartOffset` + (`Tone.now()` − `playStartTime`)
× speed. One AudioContext (the metronome uses `Tone.getContext().rawContext`
and schedules clicks in song time); iOS needs it unlocked synchronously
inside the click handler. **Nothing audio-related loads until Practice
first opens** (`loadAudio`; Tone.js is imported then too), then only the
full mix; vocals / backing load on their first pick and stay cached.
Decoded audio is ~90 MB per track for a 4-minute song — don't preload all
stems (see Screens → memory restarts).

CSS: one file, `static/css/styles.css` (~6,300 lines): shared preamble,
`@media (max-width: 767.98px)`, `@media (min-width: 768px)`, then the wide
touch block.

## Conventions & invariants

**Backend**
- Every user-supplied song slug goes through `sanitizeSongName()` before
  touching the filesystem. For JSON-body inputs where coercion would hide
  a bug, use `validSongName()` (`audio.go`), which rejects instead.
- Audio filenames go through `ValidAudioFilename()`; tab filenames
  through `isValidTabFilename()`; YouTube video IDs through
  `validVideoID()` (they become audio / stem filenames).
- User-driven outbound HTTP uses `safeHTTPClient()`.
- Persistent writes use `atomicWriteFile()`. A plain `os.WriteFile` for
  state is a bug.
- Method gating via `middleware.go` helpers only.
- Don't store derivable data in metadata (compute from fields + `os.Stat`).
- New request / response struct → update `src/api/types.ts` +
  `schema.json` (the drift test fails otherwise).
- Demucs: `--two-stems vocals --mp3 --mp3-bitrate 128 -n htdemucs` (small
  stems for iOS Safari's cache), under `nice`.

**Frontend** — the Design system section above, plus:
- Run `npm run test:all` before committing CSS / template / feature
  changes.
- Check changes on the running dev server (from a phone over the LAN
  for touch layouts) before committing; commit and deploy only when the
  owner asks.

**Repo hygiene**
- `deploy.sh` ships only the binary, `static/` and `templates/`; anything
  else ChordEdit needs on the server (units, Caddy site, env template)
  goes in `deploy/`; `deploy/setup-server.sh` installs it.
- `.claude/` is gitignored.
- Scripts in `deploy/` and the root `*.sh` must be committed as `100755`.

## Deployment (summary — full guide in `DEPLOYMENT.md`)

- **Shape:** Caddy (HTTPS, automatic certs) → the Go binary on
  `127.0.0.1:8080` under systemd `chordedit.service` (user `chordedit`,
  `Restart=always`, `EnvironmentFile=/etc/chordedit/env`,
  `WorkingDirectory=/opt/chordedit/current`). Data in
  `/var/data/chordedit/songs`.
- **Settings:** `deploy.env` (gitignored, from `deploy.env.example`):
  `CHORDEDIT_HOST` (ssh destination), optional `CHORDEDIT_ADMIN_HOST`
  (sudo, for provisioning), `CHORDEDIT_DOMAIN`.
- **Provisioning:** `./server.sh provision` copies `deploy/` and runs
  `setup-server.sh` (idempotent): packages (ffmpeg, Node 20+, Caddy), the
  `chordedit` user and dirs, the Python venv (yt-dlp + Demucs, CPU-only
  torch, pinned for Python 3.14) with the model in `TORCH_HOME`, systemd
  units, the Caddy site for the domain, and a sudoers rule letting the
  deploy user restart the app and start a backup.
- **Timers:** `chordedit-backup.timer` nightly tar (no audio) to
  `/var/backups/chordedit` (14 kept); `ytdlp-update.timer` upgrades
  yt-dlp daily.
- `deploy.sh`: optional `--backup` → `go test` → `npm ci` → typecheck →
  Vitest → `NODE_ENV=production npm run build` → cross-compile → rsync
  binary + `static/` + `templates/` to `/opt/chordedit/releases/vTS` →
  flip `current` symlink → restart → health check (auto-revert on fail).
  `--rollback` switches to the previous release. Ships an explicit file
  list, not the working tree.
- `server.sh`: `status | logs [svc] | restart | backup | provision | ssh`.

### Known operational gaps

- **No auth / no CSRF.** Every endpoint is public, including deletes and
  `/restore/*`. To lock it down, uncomment `basic_auth` in
  `deploy/chordedit.caddy` (DEPLOYMENT.md → Add a password).
- **No edit-conflict detection** — two devices editing a song overwrite
  each other.
- **Backups are on the same disk** as the data; off-box copies only happen
  when `./server.sh backup` / `./deploy.sh --backup` is run.
