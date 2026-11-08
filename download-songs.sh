#!/bin/bash

# download-songs.sh - Download songs from server to local folder
# This script downloads songs that don't exist locally from a remote server

set -e  # Exit on any error

# Function to display help message
show_help() {
    cat << EOF
Usage: $0 <folder_path> <base_url>

Download songs from a remote server to a local folder.
Only downloads songs that don't already exist in the local folder.

Arguments:
  folder_path   Local folder where songs will be saved
  base_url      Server base URL (without trailing slash)

Examples:
  # Download from localhost
  $0 ./downloaded_songs http://localhost:8080/music

  # Download from production server
  $0 ./backup_songs https://chordedit.example.com/music

  # Download to specific path
  $0 ~/music_backup https://chordedit.example.com/music

Features:
  - Only downloads songs that don't exist locally (skips duplicates)
  - Creates target folder if it doesn't exist
  - Shows progress for each song
  - Provides summary statistics at the end
  - Cleans up excessive blank lines in downloaded content

EOF
    exit 0
}

# Check for help flag
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
fi

# Check if correct number of arguments provided
if [ $# -ne 2 ]; then
    echo "❌ Error: Invalid number of arguments"
    echo ""
    echo "Usage: $0 <folder_path> <base_url>"
    echo ""
    echo "Examples:"
    echo "  $0 ./downloaded_songs http://localhost:8080/music"
    echo "  $0 ./backup_songs https://your-production-host.com/music"
    echo ""
    echo "Run '$0 --help' for more information"
    exit 1
fi

FOLDER_PATH="$1"
BASE_URL="$2"

# Create folder if it doesn't exist
mkdir -p "$FOLDER_PATH"

echo "🔄 Syncing songs from ${BASE_URL} to ${FOLDER_PATH}/"
echo "📡 Fetching song list from ${BASE_URL}/song-list..."

# Get the list of songs from the server
SONG_LIST=$(curl -s "${BASE_URL}/song-list")

# Check if curl was successful
if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to fetch song list from server"
    exit 1
fi

# Check if we got valid JSON (starts with [)
if [[ ! "$SONG_LIST" =~ ^\[ ]]; then
    echo "❌ Error: Invalid response from server. Expected JSON array."
    echo "Response: $SONG_LIST"
    exit 1
fi

# Parse JSON and extract song names
echo "📋 Parsing song list..."
SONG_NAMES=$(echo "$SONG_LIST" | python3 -c "
import sys, json
try:
    songs = json.load(sys.stdin)
    for song in songs:
        print(song)
except Exception as e:
    print(f'Error parsing JSON: {e}', file=sys.stderr)
    sys.exit(1)
")

if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to parse song list JSON"
    exit 1
fi

# Count total songs
TOTAL_SONGS=$(echo "$SONG_NAMES" | wc -l)
echo "📊 Found $TOTAL_SONGS songs on server"

# Initialize counters
DOWNLOADED=0
SKIPPED=0
ERRORS=0

echo "🔄 Checking and downloading songs..."
echo "----------------------------------------"

# Loop through each song
while IFS= read -r SONG_NAME; do
    # Skip empty lines
    if [ -z "$SONG_NAME" ]; then
        continue
    fi
    
    # Remove quotes if present
    SONG_NAME=$(echo "$SONG_NAME" | sed 's/^"//;s/"$//')
    
    # Define file paths
    LOCAL_FILE="${FOLDER_PATH}/${SONG_NAME}.txt"
    REMOTE_URL="${BASE_URL}/song?songName=${SONG_NAME}&raw=true"
    
    # Check if file already exists locally
    if [ -f "$LOCAL_FILE" ]; then
        echo "⏭️  Skipping '$SONG_NAME' (already exists)"
        ((SKIPPED++))
    else
        echo "⬇️  Downloading '$SONG_NAME'..."
        
        # Download the raw song content
        if curl -s "$REMOTE_URL" > "$LOCAL_FILE"; then
            # Check if file was created and has content
            if [ -s "$LOCAL_FILE" ]; then
                echo "✅ Downloaded '$SONG_NAME'"
                ((DOWNLOADED++))
            else
                echo "⚠️  Warning: '$SONG_NAME' downloaded but file is empty"
                rm -f "$LOCAL_FILE"  # Remove empty file
                ((ERRORS++))
            fi
        else
            echo "❌ Failed to download '$SONG_NAME'"
            ((ERRORS++))
        fi
    fi
done <<< "$SONG_NAMES"

echo "----------------------------------------"
echo "📈 Sync Summary:"
echo "   Total songs: $TOTAL_SONGS"
echo "   Downloaded: $DOWNLOADED"
echo "   Skipped: $SKIPPED"
echo "   Errors: $ERRORS"

# ── Download metadata JSON files ─────────────────────────────────────────────
echo ""
echo "📦 Downloading metadata JSON files..."

download_json() {
    local name="$1"
    local endpoint="$2"
    local dest="${FOLDER_PATH}/${name}"
    local response
    response=$(curl -s -w "%{http_code}" -o "${dest}.tmp" "${BASE_URL}${endpoint}")
    if [ "$response" = "200" ] && [ -s "${dest}.tmp" ]; then
        mv "${dest}.tmp" "$dest"
        echo "✅ Downloaded ${name}"
    else
        rm -f "${dest}.tmp"
        echo "⚠️  Could not download ${name} (HTTP ${response}) — skipping"
    fi
}

download_json ".song-meta.json"  "/export/song-meta"
download_json ".setlists.json"   "/export/setlists"

# ── Download Guitar Pro (.gp*) files referenced from song-meta ───────────────
META_FILE="${FOLDER_PATH}/.song-meta.json"
if [ -f "$META_FILE" ]; then
    echo ""
    echo "🎸 Downloading Guitar Pro files referenced in metadata..."
    TAB_FILES=$(python3 -c "
import sys, json
try:
    with open('${META_FILE}') as f:
        meta = json.load(f)
    seen = set()
    for slug, m in meta.items():
        tab = (m or {}).get('guitarTab') or ''
        if tab and tab not in seen:
            seen.add(tab)
            print(tab)
except Exception as e:
    print(f'Error parsing metadata: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null)
    if [ -n "$TAB_FILES" ]; then
        while IFS= read -r TAB_NAME; do
            [ -z "$TAB_NAME" ] && continue
            LOCAL_TAB="${FOLDER_PATH}/${TAB_NAME}"
            if [ -f "$LOCAL_TAB" ]; then
                echo "⏭️  Skipping '$TAB_NAME' (already exists)"
            else
                echo "⬇️  Downloading '$TAB_NAME'..."
                if curl -s -o "$LOCAL_TAB" "${BASE_URL}/tab?file=${TAB_NAME}" && [ -s "$LOCAL_TAB" ]; then
                    echo "✅ Downloaded '$TAB_NAME'"
                else
                    rm -f "$LOCAL_TAB"
                    echo "⚠️  Failed to download '$TAB_NAME'"
                fi
            fi
        done <<< "$TAB_FILES"
    else
        echo "ℹ️  No Guitar Pro tabs referenced in metadata"
    fi
fi

if [ $ERRORS -eq 0 ]; then
    echo "🎉 Sync completed successfully!"
    exit 0
else
    echo "⚠️  Sync completed with $ERRORS errors"
    exit 1
fi
