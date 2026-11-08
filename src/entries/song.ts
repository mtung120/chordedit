/**
 * Vite entry for the song-view page (/music/song?songName=…).
 *
 * Side-effect imports: each feature module mounts itself on DOMContentLoaded
 * (or immediately, if the DOM is already ready).
 */
// songMetaStore must mount before any feature that depends on it.
// It's a no-op on pages without window.songName.
import '../state/songMetaStore.js';
import '../features/setlistContext/setlistContext.js';
import '../features/wakeLock/wakeLock.js';
import '../features/tagEditor/tagEditor.js';
import '../features/videoPlayer/videoPlayer.js';
// Before songView: it hears songView's first key:change.
import '../features/keySelector/keySelector.js';
import '../features/songView/songView.js';
import '../features/form/form.js';
import '../features/versionSelector/versionSelector.js';
// After songView: setMode() calls window.songView.setEditMode().
import '../features/songMode/songMode.js';
import '../features/songPager/songPager.js';

if (import.meta.env.DEV) {
  console.debug('[entry: song] vite dev module loaded');
}
