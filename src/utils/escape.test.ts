import { describe, expect, it } from 'vitest';

import { escapeHTML } from './escape.js';

describe('escapeHTML', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHTML('&')).toBe('&amp;');
    expect(escapeHTML('<')).toBe('&lt;');
    expect(escapeHTML('>')).toBe('&gt;');
    expect(escapeHTML('"')).toBe('&quot;');
    expect(escapeHTML("'")).toBe('&#39;');
  });

  it('handles a representative XSS attempt', () => {
    const payload = `<script>alert("x");</script>`;
    expect(escapeHTML(payload)).toBe('&lt;script&gt;alert(&quot;x&quot;);&lt;/script&gt;');
  });

  it('escapes & first so escaped entities are not double-escaped', () => {
    // If & got escaped after >, the literal `&gt;` would become `&amp;gt;`.
    // Order check: escape ampersands before the other replacements.
    expect(escapeHTML('a&<b')).toBe('a&amp;&lt;b');
  });

  it('returns empty string for null and undefined', () => {
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });

  it('coerces non-strings to string before escaping', () => {
    expect(escapeHTML(42)).toBe('42');
    expect(escapeHTML(true)).toBe('true');
    expect(escapeHTML({ toString: () => '<o>' })).toBe('&lt;o&gt;');
  });

  it('passes through plain text unchanged', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
    expect(escapeHTML('Cơn Mưa Nhỏ')).toBe('Cơn Mưa Nhỏ');
  });
});
