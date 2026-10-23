(() => {
  const IT = globalThis.InstantTranscript;
  const BUTTON_ID = 'instant-transcript-button';
  const PANEL_ID = 'instant-transcript-panel';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_PANEL_HEIGHT = 360;
  const STACKED_PANEL_HEIGHT = 480;
  const USER_SCROLL_PAUSE_MS = 4000;

  const ICONS = {
    transcript: 'M3 5h3v2H3zm5 0h13v2H8zM3 11h3v2H3zm5 0h13v2H8zm-5 6h3v2H3zm5 0h9v2H8z',
    copy: 'M9 2h10a2 2 0 0 1 2 2v12h-2V4H9zM5 6h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v12h10V8z',
    download: 'M11 3h2v9.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4 3.6 3.6zM5 18h14v2H5z',
    close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  };

  const cache = new Map();
  const state = {
    videoId: null,
    open: false,
    result: null,
    showTimestamps: true,
    activeIndex: -1,
    userScrollUntil: 0,
  };
  const ui = {};
  let watchedVideo = null;
  let resizeObserver = null;
  let scheduled = false;

  const msg = (key) => chrome.i18n.getMessage(key) || key;

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') el.textContent = value;
      else if (key === 'className') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) el.append(child);
    return el;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'it-icon');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill-rule', 'evenodd');
    svg.append(path);
    return svg;
  }

  function currentVideoId() {
    if (location.pathname !== '/watch') return null;
    return new URLSearchParams(location.search).get('v');
  }

  function firstVisible(selector) {
    const all = [...document.querySelectorAll(selector)];
    return all.find((el) => el.getBoundingClientRect().width > 0) || all[0] || null;
  }

  function videoElement() {
    return document.querySelector('#movie_player video') || document.querySelector('video');
  }

  function videoTitle() {
    const heading = firstVisible('ytd-watch-metadata h1');
    const text = heading && heading.textContent.trim();
    return text || document.title.replace(/ - YouTube$/, '').trim();
  }

  function load(videoId) {
    if (!cache.has(videoId)) {
      const hl = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
      const pending = IT.fetchTranscript(videoId, { hl }).then((result) => {
        if (result.status === 'error') cache.delete(videoId);
        return result;
      });
      cache.set(videoId, pending);
    }
    return cache.get(videoId);
  }

  function ensureButton() {
    let button = document.getElementById(BUTTON_ID);
    if (button && button.isConnected && button.getBoundingClientRect().width > 0) return;
    const row = firstVisible('ytd-watch-metadata #top-level-buttons-computed');
    if (!row) return;
    if (button && button.parentElement === row) return;
    if (!button) {
      button = h(
        'button',
        { id: BUTTON_ID, className: 'it-action', type: 'button', 'aria-pressed': String(state.open), title: msg('buttonLabel'), onclick: togglePanel },
        [icon('transcript'), h('span', { text: msg('buttonLabel') })]
      );
    }
    row.append(button);
    const reference = row.querySelector('button:not(#' + BUTTON_ID + ')');
    if (reference) {
      const height = reference.getBoundingClientRect().height;
      if (height > 0) {
        button.style.height = `${height}px`;
        button.style.borderRadius = `${height / 2}px`;
      }
    }
  }

  function buildPanel() {
    ui.subtitle = h('div', { className: 'it-subtitle' });
    ui.timestamps = h('button', { className: 'it-chip it-toggle', type: 'button', onclick: toggleTimestamps }, [h('span', { text: msg('timestamps') })]);
    ui.copyLabel = h('span', { text: msg('copy') });
    ui.copy = h('button', { className: 'it-chip', type: 'button', onclick: copyTranscript }, [icon('copy'), ui.copyLabel]);
    ui.download = h('button', { className: 'it-chip', type: 'button', onclick: downloadTranscript }, [icon('download'), h('span', { text: msg('download') })]);
    ui.body = h('div', { className: 'it-body' });

    const pauseAutoScroll = () => {
      state.userScrollUntil = Date.now() + USER_SCROLL_PAUSE_MS;
    };
    ui.body.addEventListener('wheel', pauseAutoScroll, { passive: true });
    ui.body.addEventListener('touchmove', pauseAutoScroll, { passive: true });
    ui.body.addEventListener('keydown', pauseAutoScroll);
    ui.body.addEventListener('click', onLineClick);

    ui.panel = h('section', { id: PANEL_ID, className: 'it-panel', 'aria-label': msg('panelTitle') }, [
      h('header', { className: 'it-header' }, [
        h('div', { className: 'it-titles' }, [h('h2', { className: 'it-title', text: msg('panelTitle') }), ui.subtitle]),
        h('button', { className: 'it-icon-button', type: 'button', title: msg('close'), 'aria-label': msg('close'), onclick: closePanel }, [icon('close')]),
      ]),
      h('div', { className: 'it-toolbar' }, [ui.timestamps, h('span', { className: 'it-spacer' }), ui.copy, ui.download]),
      ui.body,
    ]);
    applyTimestampSetting();
    return ui.panel;
  }

  function placePanel() {
    if (!ui.panel || !state.open) return;
    const secondary = document.querySelector('ytd-watch-flexy #secondary-inner');
    const sideColumn = secondary && secondary.getBoundingClientRect().width > 0;
    if (sideColumn) {
      if (secondary.firstElementChild !== ui.panel) secondary.prepend(ui.panel);
    } else {
      const metadata = firstVisible('ytd-watch-metadata');
      if (metadata && metadata.nextElementSibling !== ui.panel) metadata.after(ui.panel);
    }
    ui.panel.classList.toggle('it-stacked', !sideColumn);
    sizePanel(sideColumn);
  }

  function sizePanel(sideColumn) {
    const flexy = document.querySelector('ytd-watch-flexy');
    const player = document.querySelector('#movie_player');
    const theater = flexy && (flexy.hasAttribute('theater') || flexy.hasAttribute('fullscreen'));
    let height = STACKED_PANEL_HEIGHT;
    if (sideColumn && !theater && player) height = Math.max(MIN_PANEL_HEIGHT, Math.round(player.getBoundingClientRect().height));
    if (ui.panel.style.height !== `${height}px`) ui.panel.style.height = `${height}px`;
  }

  function setStatus(kind, text, withRetry) {
    ui.body.replaceChildren();
    const children = [];
    if (kind === 'loading') {
      children.push(h('div', { className: 'it-skeleton' }, Array.from({ length: 6 }, () => h('div', { className: 'it-skeleton-line' }))));
    }
    children.push(h('p', { className: 'it-status-text', text }));
    if (withRetry) children.push(h('button', { className: 'it-chip', type: 'button', onclick: () => showVideo(state.videoId) }, [h('span', { text: msg('retry') })]));
    ui.body.append(h('div', { className: `it-status it-status-${kind}`, role: 'status' }, children));
  }

  function setActionsEnabled(enabled) {
    ui.copy.disabled = !enabled;
    ui.download.disabled = !enabled;
  }

  function renderLines(result) {
    const fragment = document.createDocumentFragment();
    result.lines.forEach((line, index) => {
      fragment.append(
        h('button', { className: 'it-line', type: 'button', 'data-index': String(index) }, [
          h('span', { className: 'it-time', text: IT.formatTime(line.start) }),
          h('span', { className: 'it-text', text: line.text }),
        ])
      );
    });
    ui.body.replaceChildren(fragment);
    ui.body.scrollTop = 0;
  }

  async function showVideo(videoId) {
    if (!videoId || !ui.panel) return;
    state.result = null;
    state.activeIndex = -1;
    ui.subtitle.textContent = '';
    setActionsEnabled(false);
    setStatus('loading', msg('loading'));
    const result = await load(videoId);
    if (videoId !== state.videoId || !state.open) return;
    state.result = result;
    if (result.status === 'ok') {
      ui.subtitle.textContent = result.trackName;
      renderLines(result);
      setActionsEnabled(true);
      watchVideo();
      syncActiveLine(true);
    } else if (result.status === 'empty') {
      setStatus('empty', msg('noTranscript'));
    } else {
      setStatus('error', msg('failed'), true);
    }
  }

  function watchVideo() {
    const video = videoElement();
    if (video === watchedVideo) return;
    unwatchVideo();
    watchedVideo = video;
    if (!video) return;
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onTimeUpdate);
  }

  function unwatchVideo() {
    if (!watchedVideo) return;
    watchedVideo.removeEventListener('timeupdate', onTimeUpdate);
    watchedVideo.removeEventListener('seeked', onTimeUpdate);
    watchedVideo = null;
  }

  function onTimeUpdate() {
    syncActiveLine(false);
  }

  function syncActiveLine(force) {
    if (!state.open || !state.result || state.result.status !== 'ok' || !watchedVideo) return;
    const index = IT.findActiveIndex(state.result.lines, watchedVideo.currentTime * 1000);
    if (index === state.activeIndex && !force) return;
    const rows = ui.body.children;
    if (rows[state.activeIndex]) rows[state.activeIndex].classList.remove('it-active');
    state.activeIndex = index;
    const row = rows[index];
    if (!row) return;
    row.classList.add('it-active');
    if (Date.now() >= state.userScrollUntil) {
      ui.body.scrollTo({ top: row.offsetTop - ui.body.clientHeight / 3, behavior: force ? 'auto' : 'smooth' });
    }
  }

  function onLineClick(event) {
    const row = event.target.closest('.it-line');
    if (!row || !state.result || state.result.status !== 'ok') return;
    const line = state.result.lines[Number(row.dataset.index)];
    const video = videoElement();
    if (!line || !video) return;
    state.userScrollUntil = 0;
    video.currentTime = line.start / 1000;
  }

  function transcriptText() {
    const lines = state.result.lines;
    return state.showTimestamps ? IT.toTimestampedText(lines) : IT.toPlainText(lines);
  }

  async function copyTranscript() {
    if (!state.result || state.result.status !== 'ok') return;
    const text = transcriptText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      const area = h('textarea', { className: 'it-offscreen' });
      area.value = text;
      document.body.append(area);
      area.select();
      ok = document.execCommand('copy');
      area.remove();
    }
    ui.copyLabel.textContent = msg(ok ? 'copied' : 'copyFailed');
    clearTimeout(copyTranscript.timer);
    copyTranscript.timer = setTimeout(() => {
      ui.copyLabel.textContent = msg('copy');
    }, 1600);
  }

  function downloadTranscript() {
    if (!state.result || state.result.status !== 'ok') return;
    const title = videoTitle();
    const content = IT.buildDownload({
      title,
      url: `https://www.youtube.com/watch?v=${state.result.videoId}`,
      lines: state.result.lines,
      showTimestamps: state.showTimestamps,
    });
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = h('a', { href: url, download: IT.fileNameFor(title), className: 'it-offscreen' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function applyTimestampSetting() {
    if (!ui.panel) return;
    ui.panel.classList.toggle('it-no-times', !state.showTimestamps);
    ui.timestamps.setAttribute('aria-pressed', String(state.showTimestamps));
  }

  function toggleTimestamps() {
    state.showTimestamps = !state.showTimestamps;
    chrome.storage.local.set({ showTimestamps: state.showTimestamps });
    applyTimestampSetting();
  }

  function openPanel() {
    if (!state.videoId) return;
    state.open = true;
    if (!ui.panel) buildPanel();
    placePanel();
    const button = document.getElementById(BUTTON_ID);
    if (button) button.setAttribute('aria-pressed', 'true');
    if (!resizeObserver && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => placePanel());
      const player = document.querySelector('#movie_player');
      if (player) resizeObserver.observe(player);
    }
    showVideo(state.videoId);
  }

  function closePanel() {
    state.open = false;
    unwatchVideo();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (ui.panel) ui.panel.remove();
    const button = document.getElementById(BUTTON_ID);
    if (button) button.setAttribute('aria-pressed', 'false');
  }

  function togglePanel() {
    if (state.open) closePanel();
    else openPanel();
  }

  function sync() {
    scheduled = false;
    const videoId = currentVideoId();
    if (!videoId) {
      if (state.open) closePanel();
      state.videoId = null;
      return;
    }
    ensureButton();
    if (videoId !== state.videoId) {
      state.videoId = videoId;
      if (state.open) {
        placePanel();
        showVideo(videoId);
      }
      return;
    }
    if (state.open) {
      placePanel();
      if (state.result && state.result.status === 'ok' && videoElement() !== watchedVideo) watchVideo();
    }
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(sync, 250);
  }

  chrome.storage.local.get({ showTimestamps: true }, (stored) => {
    state.showTimestamps = stored.showTimestamps !== false;
    applyTimestampSetting();
  });

  document.addEventListener('yt-navigate-finish', scheduleSync);
  window.addEventListener('resize', scheduleSync);
  new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
  scheduleSync();
})();
