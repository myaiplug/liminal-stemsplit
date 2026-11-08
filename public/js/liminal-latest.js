/* Resolve the latest published NoDAW Liminal desktop installer from GitHub Releases.
 * Pages mark download anchors with data-liminal-download="windows"|"online"|"mac"
 * and release-page anchors with data-liminal-release. Falls back to the href already
 * in the HTML if the API is unreachable.
 */
const LIMINAL_RELEASES_API =
  'https://api.github.com/repos/myaiplug/liminal-stemsplit/releases/latest';

export function pickLiminalAsset(assets, kind = 'windows') {
  const list = Array.isArray(assets) ? assets : [];
  const nameOf = (asset) => String((asset && asset.name) || '');
  if (kind === 'mac') {
    return list.find((asset) => /\.dmg$/i.test(nameOf(asset))) || null;
  }
  if (kind === 'online') {
    return (
      list.find((asset) => /Liminal-StemSplit-Setup-.*Windows-x64-Online\.exe$/i.test(nameOf(asset))) ||
      list.find((asset) => /Online.*\.exe$/i.test(nameOf(asset))) ||
      null
    );
  }
  return (
    list.find((asset) => /^NoDAW\.Liminal_[\d.]+_x64-setup\.exe$/i.test(nameOf(asset))) ||
    list.find((asset) => /Liminal-StemSplit-Setup-v[\d.]+-Windows-x64\.exe$/i.test(nameOf(asset)) && !/Online/i.test(nameOf(asset))) ||
    list.find((asset) => /_x64-setup\.exe$/i.test(nameOf(asset))) ||
    list.find((asset) => /\.exe$/i.test(nameOf(asset)) && !/Online/i.test(nameOf(asset))) ||
    null
  );
}

export async function resolveLatestLiminalDesktop(fetchImpl = fetch) {
  const response = await fetchImpl(LIMINAL_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`Liminal release lookup failed (${response.status})`);
  }
  const release = await response.json();
  return {
    tag: release.tag_name,
    name: release.name || release.tag_name,
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    windows: pickLiminalAsset(release.assets, 'windows'),
    windowsOnline: pickLiminalAsset(release.assets, 'online'),
    mac: pickLiminalAsset(release.assets, 'mac'),
  };
}

function assetForKind(info, kind) {
  if (kind === 'online') return info.windowsOnline;
  if (kind === 'mac') return info.mac;
  return info.windows;
}

export function applyLiminalDownloads(doc, info) {
  if (!doc || !info) return info;
  doc.querySelectorAll('[data-liminal-download]').forEach((el) => {
    const kind = el.getAttribute('data-liminal-download') || 'windows';
    const asset = assetForKind(info, kind);
    if (!asset) return;
    const url = asset.browser_download_url || asset.url;
    if (url) el.setAttribute('href', url);
    if (asset.name) el.setAttribute('data-download', asset.name);
  });
  doc.querySelectorAll('[data-liminal-release]').forEach((el) => {
    if (info.htmlUrl) el.setAttribute('href', info.htmlUrl);
  });
  doc.querySelectorAll('[data-liminal-version]').forEach((el) => {
    el.textContent = info.tag || '';
  });
  try {
    if (typeof localStorage !== 'undefined' && info.tag) {
      localStorage.setItem('nodaw_liminal_latest_tag', info.tag);
    }
  } catch (_err) {
    /* private mode */
  }
  return info;
}

export async function mountLiminalDownloads(doc, fetchImpl = fetch) {
  const info = await resolveLatestLiminalDesktop(fetchImpl);
  applyLiminalDownloads(doc, info);
  return info;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.NoDAWLiminalLatest = {
    pickLiminalAsset,
    resolveLatestLiminalDesktop,
    applyLiminalDownloads,
    mountLiminalDownloads,
  };
  const start = () => {
    mountLiminalDownloads(document).catch(() => {});
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
