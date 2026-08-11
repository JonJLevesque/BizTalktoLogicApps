#!/usr/bin/env node
/**
 * Guards npm packaging against iCloud Drive conflict artifacts.
 *
 * When a Mac syncs a folder through iCloud Drive, edit conflicts produce
 * duplicate entries named "<name> 2", "<name> 3", "<name> 2.js", etc.
 * If those land in dist/ (or the sources they compile from), `npm pack`
 * happily ships them. This script fails the pack when any such entry exists
 * in a published directory.
 *
 * Wired into the "prepack" lifecycle hook, so it runs on every
 * `npm pack` / `npm publish`. The `files` allowlist in package.json also
 * carries a `!dist/**\/* [0-9]*` exclusion as a second layer of defense.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PUBLISHED_DIRS = ['dist', 'schemas'];

// "report 2", "report 2.js", "server 3.mjs", "dist 2" — a space + digits before
// the (optional) extension is iCloud's conflict-rename signature.
const ICLOUD_DUPE = /^.* \d+(\.[^.]+)*$/;

/** @param {string} dir @returns {string[]} */
function findDupes(dir) {
  /** @type {string[]} */
  const hits = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits; // directory not present (e.g. before first build) — nothing to check
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (ICLOUD_DUPE.test(entry.name)) hits.push(full);
    if (entry.isDirectory()) hits.push(...findDupes(full));
  }
  return hits;
}

const dupes = PUBLISHED_DIRS.flatMap(findDupes);

if (dupes.length > 0) {
  console.error('✖ iCloud conflict duplicates detected in published directories:');
  for (const d of dupes) console.error(`   ${d}`);
  console.error('\nDelete these files (they are iCloud sync artifacts) and re-run.');
  console.error('Tip: run `npm run clean && npm run build` to regenerate dist/ from scratch.');
  process.exit(1);
}

console.log('✔ No iCloud conflict duplicates in published directories.');
