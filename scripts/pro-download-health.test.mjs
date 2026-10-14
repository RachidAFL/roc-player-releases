import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRelease, updatePatch, ASSET } from './pro-download-health.mjs';
const release = (tag, extra = {}) => ({ tag_name: tag, assets: [{ name: ASSET, state: 'uploaded', size: 100 }], ...extra });
test('Windows, demos, prereleases, drafts and partial uploads cannot hijack the Pro link', () => {
  const expected = release('v1.3.31');
  assert.equal(selectRelease([
    release('windows-v9.0.0'), release('fgs-demos-2026-09'), release('v9.0.0', { prerelease: true }),
    release('v8.0.0', { draft: true }), release('v7.0.0', { assets: [] }),
    release('v6.0.0', { assets: [{ name: ASSET, state: 'new', size: 0 }] }),
    release('v1.3.9'), expected, release('v1.3.28'),
  ]), expected);
});
test('missing valid Pro releases fails safely', () => assert.throws(() => selectRelease([release('windows-v2.1.2')])));
test('feed URL remains pinned to the APK version and checksum and preserves update policy', () => {
  const digest = 'a'.repeat(64);
  const patch = updatePatch({ id: 1, android_native_version: '1.3.28', android_native_mandatory: true }, release('v1.3.31'), digest);
  assert.deepEqual(patch, {
    android_native_version: '1.3.31',
    android_native_url: 'https://github.com/RachidAFL/roc-player-releases/releases/download/v1.3.31/roc-player-pro.apk',
    android_native_sha256: digest, android_native_mandatory: true,
  });
});
test('never downgrade or modify another app channel', () => {
  assert.throws(() => updatePatch({ id: 1, android_native_version: '1.4.0' }, release('v1.3.31'), 'a'.repeat(64)));
  assert.throws(() => updatePatch({ id: 2, android_native_version: '1.0.0' }, release('v1.3.31'), 'a'.repeat(64)));
});
