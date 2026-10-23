(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstantTranscript = Object.assign(root.InstantTranscript || {}, api);
})(globalThis, function () {
  const YOUTUBE_ORIGIN = 'https://www.youtube.com';

  const APP_CLIENTS = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
    { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    { clientName: 'ANDROID_VR', clientVersion: '1.62.27', androidSdkVersion: 32, deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L' },
  ];

  const baseLanguage = (code) => String(code || '').toLowerCase().split('-')[0];

  function spokenLanguage(tracks, audio) {
    if (audio && audio.audioTrackId) return baseLanguage(String(audio.audioTrackId).split('.')[0]);
    const order = audio && Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
    const ordered = order.map((i) => tracks[i]).filter(Boolean);
    const generated = ordered.find((t) => t.kind === 'asr') || tracks.find((t) => t.kind === 'asr');
    return generated ? baseLanguage(generated.languageCode) : null;
  }

  function pickTrack(captions) {
    const tracks = (captions && captions.captionTracks) || [];
    if (!tracks.length) return null;
    const audio = captions.audioTracks && captions.audioTracks[captions.defaultAudioTrackIndex || 0];
    const preferred = audio && Number.isInteger(audio.defaultCaptionTrackIndex) ? tracks[audio.defaultCaptionTrackIndex] : undefined;
    const spoken = spokenLanguage(tracks, audio);
    if (spoken) {
      const inSpoken = (t) => baseLanguage(t.languageCode) === spoken;
      if (preferred && preferred.kind !== 'asr' && inSpoken(preferred)) return preferred;
      const match = tracks.find((t) => t.kind !== 'asr' && inSpoken(t)) || tracks.find((t) => t.kind === 'asr' && inSpoken(t));
      if (match) return match;
    }
    return preferred || tracks[0];
  }

  function parseJson3(json) {
    const events = (json && json.events) || [];
    return events
      .filter((e) => Array.isArray(e.segs))
      .map((e) => ({
        start: e.tStartMs || 0,
        dur: e.dDurationMs || 0,
        text: e.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
      }))
      .filter((l) => l.text);
  }

  function trackName(track) {
    const name = track.name || {};
    return name.simpleText || (name.runs || []).map((r) => r.text).join('') || track.languageCode;
  }

  async function askPlayer(fetchImpl, client, videoId, hl, origin) {
    const res = await fetchImpl(`${origin}/youtubei/v1/player?prettyPrint=false`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { ...client, hl, gl: 'US' } }, videoId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.playabilityStatus || data.playabilityStatus.status !== 'OK') return null;
    return data;
  }

  async function readTrack(fetchImpl, track, origin) {
    const url = new URL(track.baseUrl, origin);
    url.searchParams.set('fmt', 'json3');
    const res = await fetchImpl(url.toString(), { credentials: 'omit' });
    if (!res.ok) return [];
    return parseJson3(await res.json());
  }

  async function fetchTranscript(videoId, options = {}) {
    const fetchImpl = options.fetch || globalThis.fetch.bind(globalThis);
    const hl = options.hl || 'en';
    const origin = options.origin || YOUTUBE_ORIGIN;
    for (const client of APP_CLIENTS) {
      try {
        const data = await askPlayer(fetchImpl, client, videoId, hl, origin);
        if (!data) continue;
        const track = pickTrack(data.captions && data.captions.playerCaptionsTracklistRenderer);
        if (!track) return { status: 'empty', videoId };
        const lines = await readTrack(fetchImpl, track, origin);
        if (!lines.length) continue;
        return { status: 'ok', videoId, languageCode: track.languageCode, trackName: trackName(track), lines };
      } catch (_) {
        continue;
      }
    }
    return { status: 'error', videoId };
  }

  return { APP_CLIENTS, pickTrack, parseJson3, fetchTranscript };
});
