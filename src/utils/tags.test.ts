import { describe, expect, it } from 'vitest';
import type { TagConfig } from '../api/types.js';
import { matchesTag, withTag } from './tags.js';

const config: TagConfig = {
  groups: [
    ['Verified', 'Gig-ready'],
    ['Ballad', 'Sôi động'],
  ],
  implies: { 'Gig-ready': ['Verified'] },
  auto: ['Audio', 'Stems'],
};

describe('withTag', () => {
  it('replaces the other tag of the same group', () => {
    expect(withTag(['Verified', 'Ballad'], 'Gig-ready', config)).toEqual(['Ballad', 'Gig-ready']);
    expect(withTag(['Ballad'], 'Sôi động', config)).toEqual(['Sôi động']);
  });

  it('keeps tags from other groups', () => {
    expect(withTag(['Ballad'], 'Verified', config)).toEqual(['Ballad', 'Verified']);
  });
});

describe('matchesTag', () => {
  it('matches the tag itself', () => {
    expect(matchesTag(['Ballad'], 'Ballad', config)).toBe(true);
    expect(matchesTag(['Ballad'], 'Sôi động', config)).toBe(false);
  });

  it('matches implied tags one way only', () => {
    expect(matchesTag(['Gig-ready'], 'Verified', config)).toBe(true);
    expect(matchesTag(['Verified'], 'Gig-ready', config)).toBe(false);
  });
});
