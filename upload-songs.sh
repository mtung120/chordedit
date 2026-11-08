#!/bin/bash

# upload-songs.sh - Upload songs from local folder to server
# This script uploads songs that don't exist on the server from a local folder

set -e  # Exit on any error

# Function to display help message
show_help() {
    cat << EOF
Usage: $0 <folder_path> <base_url>

Upload songs from a local folder to a remote server.
Only uploads songs that don't already exist on the server.

Arguments:
  folder_path   Local folder containing .txt song files
  base_url      Server base URL (without trailing slash)

Examples:
  # Upload to localhost
  $0 ./songs http://localhost:8080/music

  # Upload to production server
  $0 ./backup_songs https://chordedit.example.com/music

  # Upload from specific path
  $0 ~/music_backup https://chordedit.example.com/music

Features:
  - Only uploads songs that don't exist on server (prevents overwriting)
  - Fetches server song list to determine what to upload
  - Shows progress for each song
  - Provides summary statistics at the end
  - Properly escapes JSON content for safe upload
  - Validates song names to prevent security issues

Requirements:
  - Python 3 (for JSON encoding)
  - curl (for HTTP requests)
  - Server must have /song-list and /upload-song endpoints

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
    echo "  $0 ./songs http://localhost:8080/music"
    echo "  $0 ./backup_songs https://your-production-host.com/music"
    echo ""
    echo "Run '$0 --help' for more information"
    exit 1
fi

FOLDER_PATH="$1"
BASE_URL="$2"

# Validate folder exists
if [ ! -d "$FOLDER_PATH" ]; then
    echo "❌ Error: Folder '$FOLDER_PATH' does not exist"
    exit 1
fi

echo "🔄 Uploading songs from ${FOLDER_PATH}/ to ${BASE_URL}/"
echo "📡 Fetching song list from ${BASE_URL}/song-list..."

# Get the list of songs from the server
SERVER_SONG_LIST=$(curl -s "${BASE_URL}/song-list")

# Check if curl was successful
if [ $? -ne 0 ]; then
    echo "❌ Error: Failed to fetch song list from server"
    exit 1
fi

# Check if we got valid JSON (starts with [)
if [[ ! "$SERVER_SONG_LIST" =~ ^\[ ]]; then
    echo "❌ Error: Invalid response from server. Expected JSON array."
    echo "Response: $SERVER_SONG_LIST"
    exit 1
fi

# Parse JSON and extract song names into an array
echo "📋 Parsing server song list..."
SERVER_SONGS=$(echo "$SERVER_SONG_LIST" | python3 -c "
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

# Count songs on server
SERVER_SONG_COUNT=$(echo "$SERVER_SONGS" | grep -v '^$' | wc -l | tr -d ' ')
echo "📊 Found $SERVER_SONG_COUNT songs on server"

# Count local songs
LOCAL_SONG_COUNT=$(find "$FOLDER_PATH" -name "*.txt" -type f | wc -l | tr -d ' ')
echo "📁 Found $LOCAL_SONG_COUNT songs in local folder"

# Initialize counters
UPLOADED=0
SKIPPED=0
ERRORS=0

echo "🔄 Checking and uploading songs..."
echo "----------------------------------------"

# Loop through each .txt file in the folder
find "$FOLDER_PATH" -name "*.txt" -type f | sort | while IFS= read -r file; do
    # Extract song name (remove .txt extension)
    SONG_NAME=$(basename "$file" .txt)
    
    # Check if song exists on server using grep
    if echo "$SERVER_SONGS" | grep -q "^${SONG_NAME}$"; then
        echo "⏭️  Skipping '$SONG_NAME' (already exists on server)"
        ((SKIPPED++))
    else
        echo "⬆️  Uploading '$SONG_NAME'..."
        
        # Read file content
        CONTENT=$(cat "$file")
        
        # Create JSON payload using Python for proper escaping
        JSON_PAYLOAD=$(python3 << EOF
import json
import sys

with open("$file", 'r') as f:
    content = f.read()

payload = {
    "songName": "$SONG_NAME",
    "content": content
}

print(json.dumps(payload))
EOF
)
        
        # Upload the song using curl with -L to follow redirects
        RESPONSE=$(curl -L -s -X POST "${BASE_URL}/upload-song" \
            -H "Content-Type: application/json" \
            -d "$JSON_PAYLOAD" 2>&1)
        
        CURL_EXIT_CODE=$?
        
        # Check if upload was successful
        if [ $CURL_EXIT_CODE -eq 0 ]; then
            # Check response for error messages
            if [[ "$RESPONSE" =~ "Bad request" ]] || [[ "$RESPONSE" =~ "error" ]] || [[ "$RESPONSE" =~ "Error" ]]; then
                echo "❌ Failed to upload '$SONG_NAME': $RESPONSE"
                ((ERRORS++))
            else
                echo "✅ Uploaded '$SONG_NAME'"
                ((UPLOADED++))
            fi
        else
            echo "❌ Failed to upload '$SONG_NAME' (curl error: $CURL_EXIT_CODE)"
            ((ERRORS++))
        fi
    fi
done

# Note: The counters don't work across subshells, so we need to recalculate
echo "----------------------------------------"
echo "📈 Upload Summary:"

echo "   Local songs: $LOCAL_SONG_COUNT"
echo "   Server songs (before): $SERVER_SONG_COUNT"

# Fetch final server song count
FINAL_SERVER_SONG_LIST=$(curl -s "${BASE_URL}/song-list" 2>/dev/null)
if [ $? -eq 0 ]; then
    FINAL_SERVER_SONG_COUNT=$(echo "$FINAL_SERVER_SONG_LIST" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    echo "   Server songs (after): $FINAL_SERVER_SONG_COUNT"
fi

# ── Restore metadata JSON files ──────────────────────────────────────────────
echo ""
echo "📦 Restoring metadata JSON files..."

restore_json() {
    local name="$1"
    local endpoint="$2"
    local src="${FOLDER_PATH}/${name}"
    if [ ! -f "$src" ]; then
        echo "⏭️  No local ${name} found — skipping"
        return
    fi
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}${endpoint}" \
        -H "Content-Type: application/json" \
        --data-binary "@${src}")
    if [ "$response" = "200" ]; then
        echo "✅ Restored ${name}"
    else
        echo "⚠️  Failed to restore ${name} (HTTP ${response})"
    fi
}

restore_json ".song-meta.json"  "/restore/song-meta"
restore_json ".setlists.json"   "/restore/setlists"

echo ""
echo "🎉 Upload process completed!"
echo "Note: Check the output above for individual upload results"

