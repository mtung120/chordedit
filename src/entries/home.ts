/**
 * Vite entry for the home page (/music/songs).
 *
 * Side-effect imports for each migrated home-page feature.
 */
import '../features/home/setlistsSection.js';
import '../features/home/addSong.js';
import '../features/home/songList.js';

if (import.meta.env.DEV) {
  console.debug('[entry: home] vite dev module loaded');
}
