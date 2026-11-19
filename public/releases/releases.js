/* Liminal releases page
 * Fetches published GitHub releases at load; falls back to a committed snapshot.
 * Drafts are never listed. Notes come only from the release body.
 */
(function () {
  const API = 'https://api.github.com/repos/myaiplug/liminal-stemsplit/releases?per_page=100';
  const FALLBACK = '/releases/fallback.json';
  const listEl = document.getElementById('release-list');
  const statusEl = document.getElementById('release-status');
  const countEl = document.getElementById('release-counts');

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Louisville',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(d);
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) {
      const kb = n / 1024;
      return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
    }
    const mb = n / (1024 * 1024);
    const text = mb >= 10 ? mb.toFixed(1) : mb.toFixed(1);
    return text.replace(/\.0$/, '') + ' MB';
  }

  function classify(name) {
    const n = (name || '').toLowerCase();
    if (/\.(sig)$/.test(n) || n.endsWith('.sha256') || n.includes('checksum') || n === 'latest.json') {
      return 'support';
    }
    if (n.endsWith('.exe') || n.endsWith('.msi')) return 'windows';
    if (n.endsWith('.dmg')) return 'macos';
    if (n.endsWith('.appimage') || n.endsWith('.deb') || n.endsWith('.rpm')) return 'linux';
    return 'other';
  }

  function assetLabel(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('online') && n.endsWith('.exe')) return 'Windows online installer';
    if (n.endsWith('-setup.exe') || n.endsWith('_x64-setup.exe') || (n.endsWith('.exe') && n.includes('setup'))) {
      return 'Windows installer';
    }
    if (n.endsWith('.msi')) return 'Windows MSI package';
    if (n.endsWith('.exe')) return 'Windows executable';
    if (n.endsWith('.dmg') && n.includes('aarch64')) return 'macOS disk image (Apple silicon)';
    if (n.endsWith('.dmg')) return 'macOS disk image';
    if (n.endsWith('.appimage')) return 'Linux AppImage';
    if (n.endsWith('.deb')) return 'Linux Debian package';
    if (n.endsWith('.sha256') && n.includes('windows')) return 'Windows SHA-256 checksums';
    if (n.endsWith('.sha256') && n.includes('mac')) return 'macOS SHA-256 checksums';
    if (n.endsWith('.sha256')) return 'SHA-256 checksums';
    if (n.endsWith('.sig')) return 'Signature file';
    if (n === 'latest.json') return 'Latest-version manifest';
    return name;
  }

  function stripMd(s) {
    return String(s || '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
      .replace(/[*_`#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function notesFromBody(body, htmlUrl) {
    const raw = (body || '').replace(/\r/g, '').trim();
    if (!raw) {
      return { kind: 'empty', items: [], changelog: null };
    }
    const plain = stripMd(raw).replace(/\s+/g, ' ').trim();
    const changelogOnly = /^(Full Changelog:?\s+)(https?:\/\/\S+)$/i.exec(plain);
    const lines = raw.split('\n');
    const items = [];
    for (const line of lines) {
      const m = line.match(/^\s*[-*]\s+(.*)$/);
      if (!m) continue;
      const text = stripMd(m[1]);
      if (!text) continue;
      if (/^full changelog/i.test(text)) continue;
      items.push(text);
    }
    if (items.length) {
      return { kind: 'bullets', items: items.slice(0, 8), changelog: null };
    }
    if (changelogOnly) {
      const url = (changelogOnly[2] || changelogOnly[1] || htmlUrl || '').trim();
      return { kind: 'changelog', items: [], changelog: url.startsWith('http') ? url : null };
    }
    const para = stripMd(raw);
    if (!para) return { kind: 'empty', items: [], changelog: null };
    return { kind: 'text', items: [para], changelog: null };
  }


  function sortWindows(a, b) {
    const rank = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('online')) return 3;
      if (n.endsWith('.msi')) return 2;
      if (n.includes('setup') && n.endsWith('.exe')) return 1;
      if (n.endsWith('.exe')) return 1;
      return 4;
    };
    return rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name));
  }

  function pickWindowsPrimary(assets) {
    const wins = assets.filter((a) => classify(a.name) === 'windows');
    const setup = wins.find((a) => /setup\.exe$/i.test(a.name) && !/online/i.test(a.name));
    return setup || wins.find((a) => /\.exe$/i.test(a.name)) || wins[0] || null;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderAsset(a) {
    const size = formatSize(a.size);
    const label = assetLabel(a.name);
    return (
      '<li class="asset">' +
        '<a class="asset-link" href="' + escapeHtml(a.browser_download_url) + '" rel="noopener">' +
          '<span class="asset-label">' + escapeHtml(label) + '</span>' +
          '<span class="asset-file">' + escapeHtml(a.name) + (size ? ' · ' + escapeHtml(size) : '') + '</span>' +
        '</a>' +
      '</li>'
    );
  }

  function renderGroup(title, assets, note) {
    if (!assets.length) return '';
    return (
      '<div class="asset-group">' +
        '<h4>' + escapeHtml(title) + '</h4>' +
        (note ? '<p class="asset-note">' + note + '</p>' : '') +
        '<ul class="asset-list">' + assets.map(renderAsset).join('') + '</ul>' +
      '</div>'
    );
  }

  function renderRelease(rel, isLatest) {
    const tag = rel.tag_name || rel.name || 'release';
    const title = rel.name && rel.name !== tag ? rel.name : tag;
    const date = formatDate(rel.published_at);
    const notes = notesFromBody(rel.body, rel.html_url);
    const assets = Array.isArray(rel.assets) ? rel.assets.slice() : [];
    const windows = assets.filter((a) => classify(a.name) === 'windows').sort(sortWindows);
    const support = assets.filter((a) => classify(a.name) === 'support');
    const other = assets.filter((a) => {
      const k = classify(a.name);
      return k === 'macos' || k === 'linux' || k === 'other';
    });

    let notesHtml = '';
    if (notes.kind === 'bullets') {
      notesHtml = '<ul class="notes">' + notes.items.map((i) => '<li>' + escapeHtml(i) + '</li>').join('') + '</ul>';
    } else if (notes.kind === 'text') {
      notesHtml = '<p class="notes-text">' + escapeHtml(notes.items[0]) + '</p>';
    } else if (notes.kind === 'changelog' && notes.changelog) {
      notesHtml = '<p class="notes-text">Release notes on GitHub are a changelog link only. <a href="' + escapeHtml(notes.changelog) + '" target="_blank" rel="noopener">View the full changelog</a>.</p>';
    } else {
      notesHtml = '<p class="notes-text muted">No release notes were published for this version.</p>';
    }

    const otherNote = other.length
      ? 'macOS and Linux are not officially supported yet. These files are listed just in case.'
      : '';

    const badges = [];
    if (isLatest) badges.push('<span class="badge badge-latest">Latest</span>');
    if (rel.prerelease) badges.push('<span class="badge">Pre-release</span>');

    return (
      '<article class="release-card' + (isLatest ? ' is-latest' : '') + '" id="' + escapeHtml(tag) + '">' +
        '<header class="release-head">' +
          '<div>' +
            '<h3>' + escapeHtml(title) + ' ' + badges.join(' ') + '</h3>' +
            '<p class="release-meta">' +
              (date ? '<time datetime="' + escapeHtml(rel.published_at) + '">' + escapeHtml(date) + '</time>' : '') +
              (rel.html_url ? ' · <a href="' + escapeHtml(rel.html_url) + '" target="_blank" rel="noopener">GitHub release</a>' : '') +
            '</p>' +
          '</div>' +
        '</header>' +
        notesHtml +
        renderGroup('Windows installers', windows) +
        renderGroup('Supporting files', support) +
        renderGroup('Other files', other, otherNote) +
      '</article>'
    );
  }

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' status-' + kind : '');
  }

  function applyLatestCta(releases) {
    const newest = releases.find((r) => !r.prerelease) || releases[0];
    if (!newest) return;
    const primary = pickWindowsPrimary(newest.assets || []);
    const btn = document.getElementById('latest-windows');
    const meta = document.getElementById('latest-meta');
    if (btn && primary) {
      btn.href = primary.browser_download_url;
      btn.textContent = 'Download ' + (newest.tag_name || 'latest') + ' for Windows';
    }
    if (meta && primary) {
      const size = formatSize(primary.size);
      const date = formatDate(newest.published_at);
      meta.textContent = [primary.name, size, date].filter(Boolean).join(' · ');
    }
  }

  function render(releases, source) {
    const published = (releases || []).filter((r) => !r.draft);
    published.sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
    const latestIdx = published.findIndex((r) => !r.prerelease);

    const assetCount = published.reduce((n, r) => n + ((r.assets && r.assets.length) || 0), 0);
    if (countEl) {
      countEl.textContent = published.length + ' published releases · ' + assetCount + ' files';
    }
    applyLatestCta(published);
    listEl.innerHTML = published.map((r, i) => renderRelease(r, i === latestIdx)).join('');
    const srcLabel = source === 'api' ? 'Live from GitHub Releases.' : 'Showing a saved snapshot because GitHub could not be reached.';
    setStatus(srcLabel, source === 'api' ? 'ok' : 'fallback');
  }

  async function loadFallback() {
    const res = await fetch(FALLBACK, { cache: 'no-store' });
    if (!res.ok) throw new Error('fallback ' + res.status);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.releases || []);
  }

  async function load() {
    setStatus('Loading releases…');
    try {
      const res = await fetch(API, {
        headers: { Accept: 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error('api ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('api shape');
      render(data, 'api');
    } catch (err) {
      try {
        const fallback = await loadFallback();
        render(fallback, 'fallback');
      } catch (err2) {
        setStatus('Releases could not be loaded. Try the GitHub releases page.', 'error');
        listEl.innerHTML = '<p class="notes-text">Open <a href="https://github.com/myaiplug/liminal-stemsplit/releases" target="_blank" rel="noopener">github.com/myaiplug/liminal-stemsplit/releases</a>.</p>';
      }
    }
  }

  load();
})();
