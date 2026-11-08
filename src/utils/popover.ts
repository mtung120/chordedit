/**
 * Minimal dropdown behaviour shared by the song page's menus (version
 * picker, Edit ⋮): the trigger toggles the panel's `hidden` attribute, and
 * the panel closes on outside click, Escape, or after any item is chosen.
 */
export function wirePopover(trigger: HTMLElement, panel: HTMLElement): void {
  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  panel.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest('button, [role="menuitem"]')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });
}
