import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = 'RachidAFL/roc-player-releases';
export const ASSET = 'roc-player-pro.apk';
export const PERMANENT_URL = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
export const CERT = 'f29515608dd8726c6fe8b45a1786c780846d30c77c2f4561c7bb032011428712';
export function version(value) {
  return /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number) ?? null;
}
export function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
export function selectRelease(releases) {
  const candidates = releases.filter(r => !r.draft && !r.prerelease && version(r.tag_name) &&
    r.assets.some(a => a.name === ASSET && a.state === 'uploaded' && a.size > 0));
  candidates.sort((a, b) => compare(version(b.tag_name), version(a.tag_name)));
  assert(candidates.length, 'No stable Pro release with a complete APK exists');
  return candidates[0];
}
export function updatePatch(row, release, digest) {
  assert.equal(row.id, 1, 'Only Pro update row 1 may change');
  const next = version(release.tag_name);
  const current = version(row.android_native_version ?? '0.0.0');
  assert(current && compare(next, current) >= 0, 'Refusing to downgrade the Pro update feed');
  assert.match(digest, /^[a-f0-9]{64}$/);
  return {
    android_native_version: next.join('.'),
    // Pin the manifest URL to its checksum. Downloader keeps using PERMANENT_URL.
    android_native_url: `https://github.com/${REPO}/releases/download/${release.tag_name}/${ASSET}`,
    android_native_sha256: digest,
    android_native_mandatory: row.android_native_mandatory ?? false,
  };
}
async function request(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  assert(r.ok, `HTTP ${r.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return r;
}
async function download(url) {
  const r = await request(url, { headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(new URL(r.url).protocol, 'https:');
  assert(new URL(r.url).host.endsWith('.githubusercontent.com'), 'Unexpected APK download host');
  return Buffer.from(await r.arrayBuffer());
}
function validateApk(bytes, release, asset) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, asset.size, 'Incomplete APK download');
  if (asset.digest) assert.equal(`sha256:${digest}`, asset.digest, 'GitHub asset checksum mismatch');
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  assert(sdk, 'Android SDK required to verify the APK signature and package');
  const tools = readdirSync(join(sdk, 'build-tools')).filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => compare(version(b), version(a)));
  assert(tools.length, 'Android build tools unavailable');
  const dir = mkdtempSync(join(tmpdir(), 'roc-pro-health-'));
  try {
    const file = join(dir, ASSET);
    writeFileSync(file, bytes);
    const toolDir = join(sdk, 'build-tools', tools[0]);
    const cert = execFileSync(join(toolDir, 'apksigner'), ['verify', '--print-certs', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert(cert.includes(`certificate SHA-256 digest: ${CERT}`), 'APK has the wrong signing key');
    const badging = execFileSync(join(toolDir, 'aapt2'), ['dump', 'badging', file], { encoding: 'utf8' });
    assert.match(badging, /package: name='com\.rocplayer\.pro'/);
    assert(badging.includes(`versionName='${version(release.tag_name).join('.')}'`), 'APK version differs from release tag');
    assert(!badging.includes('application-debuggable'), 'Debug APK cannot be published');
    assert(badging.includes('android.permission.REQUEST_INSTALL_PACKAGES'), 'APK must be the sideload flavor');
    return digest;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const base = process.env.PRO_UPDATE_SUPABASE_URL;
  const key = process.env.PRO_UPDATE_SUPABASE_KEY;
  assert(token && base && key, 'GitHub token and Pro update configuration are required');
  const api = async (path, options = {}) => (await request(`https://api.github.com/repos/${REPO}/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  })).json();
  const releases = [];
  for (let page = 1; ; page++) {
    const items = await api(`releases?per_page=100&page=${page}`);
    releases.push(...items);
    if (items.length < 100) break;
  }
  const chosen = selectRelease(releases);
  const asset = chosen.assets.find(a => a.name === ASSET);
  const bytes = await download(`https://github.com/${REPO}/releases/download/${chosen.tag_name}/${ASSET}`);
  const digest = validateApk(bytes, chosen, asset);
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rows = await (await request(`${base}/rest/v1/app_updates?id=eq.1&select=*`, { headers })).json();
  assert.equal(rows.length, 1);
  const row = rows[0];
  const patch = updatePatch(row, chosen, digest);
  if (Object.entries(patch).some(([k, v]) => row[k] !== v)) {
    const query = new URLSearchParams({ id: 'eq.1', android_native_version: row.android_native_version == null ? 'is.null' : `eq.${row.android_native_version}`, android_native_sha256: row.android_native_sha256 == null ? 'is.null' : `eq.${row.android_native_sha256}` });
    const updated = await (await request(`${base}/rest/v1/app_updates?${query}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch),
    })).json();
    assert.equal(updated.length, 1, 'Concurrent feed change; refusing to overwrite it');
    assert.deepEqual(updated[0], { ...row, ...patch }, 'Unexpected update field change');
    console.log(`Pro update feed synchronized to ${patch.android_native_version}`);
  }
  const latest = await api('releases/latest');
  if (latest.id !== chosen.id) {
    await api(`releases/${chosen.id}`, { method: 'PATCH', body: JSON.stringify({ make_latest: 'true' }) });
    console.log(`Restored latest to Pro release ${chosen.tag_name}`);
  }
  const served = await download(PERMANENT_URL);
  assert.equal(createHash('sha256').update(served).digest('hex'), digest, 'Permanent link serves the wrong APK');
  const feed = await (await request('https://www.rocplayer.com/api/device/check-update?platform=roc-player-pro&v=0.0.0')).json();
  assert.equal(feed.success, true);
  assert.equal(feed.latest_version, patch.android_native_version);
  assert.equal(feed.apk_sha256, digest);
  assert.equal(feed.apk_url, patch.android_native_url);
  console.log(`Healthy: Downloader 9204537 -> ${chosen.tag_name}; signed APK ${digest}; Pro feed matches.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
