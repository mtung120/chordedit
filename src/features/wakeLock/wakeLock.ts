/**
 * Keep the screen awake while the song view is visible.
 *
 * Uses the Screen Wake Lock API. No-ops on browsers without support
 * (older Safari, some embedded webviews) — graceful degradation.
 *
 * Re-acquires the lock on visibilitychange because browsers automatically
 * release wake locks when the tab is hidden (phone locked, app switched).
 *
 * Side-effect import — runs its mount on first load. Tests stub `navigator.wakeLock` via the visual
 * helper so the request never actually prompts.
 */

let sentinel: WakeLockSentinel | null = null;

async function request(): Promise<void> {
  if (sentinel) return;
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Battery too low, permission denied, or unsupported. Nothing to do.
  }
}

function mount(): void {
  if (!('wakeLock' in navigator)) return;
  void request();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void request();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
