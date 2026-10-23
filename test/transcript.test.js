const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickTrack, parseJson3, fetchTranscript, APP_CLIENTS } = require('../src/transcript.js');

const track = (languageCode, kind, name) => ({
  languageCode,
  ...(kind ? { kind } : {}),
  name: { runs: [{ text: name || languageCode }] },
  baseUrl: `https://www.youtube.com/api/timedtext?v=abc&lang=${languageCode}${kind ? `&kind=${kind}` : ''}`,
});

const captions = (captionTracks, defaultCaptionTrackIndex) => ({
  captionTracks,
  audioTracks: defaultCaptionTrackIndex === undefined ? undefined : [{ defaultCaptionTrackIndex }],
  defaultAudioTrackIndex: 0,
});

test('pickTrack returns null when there are no tracks', () => {
  assert.equal(pickTrack(undefined), null);
  assert.equal(pickTrack(captions([])), null);
});

test('pickTrack prefers a human-made track in the spoken language', () => {
  const tracks = [track('ar'), track('en', 'asr'), track('en'), track('it')];
  assert.equal(pickTrack(captions(tracks)), tracks[2]);
});

test('pickTrack uses YouTube\'s default when it is in the spoken language', () => {
  const tracks = [track('en', 'asr'), track('en', null, 'English'), track('en', null, 'English (UK)')];
  assert.equal(pickTrack(captions(tracks, 2)), tracks[2]);
});

test('pickTrack ignores a default that is a different language than the speech', () => {
  const tracks = [track('de', 'asr'), track('en'), track('de')];
  assert.equal(pickTrack(captions(tracks, 1)), tracks[2]);
});

test('pickTrack matches regional variants of the spoken language', () => {
  const tracks = [track('en', 'asr'), track('en-GB')];
  assert.equal(pickTrack(captions(tracks)), tracks[1]);
});

test('pickTrack falls back to the auto-generated track', () => {
  const tracks = [track('fr'), track('de', 'asr')];
  assert.equal(pickTrack(captions(tracks)), tracks[1]);
});

test('pickTrack uses YouTube\'s default, then the first track, when the speech language is unknown', () => {
  const tracks = [track('de'), track('fr')];
  assert.equal(pickTrack(captions(tracks, 1)), tracks[1]);
  assert.equal(pickTrack(captions(tracks)), tracks[0]);
});

const DUBBED_LANGUAGES = ['ar', 'bn', 'nl', 'en', 'fr', 'de', 'iw', 'hi', 'id', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'es'];

function dubbedCaptions({ originalAt, extraTracks = [] }) {
  const captionTracks = [...DUBBED_LANGUAGES.map((code) => track(code, 'asr')), ...extraTracks];
  const englishIndex = DUBBED_LANGUAGES.indexOf('en');
  const captionTrackIndices = [englishIndex, ...captionTracks.map((_, i) => i).filter((i) => i !== englishIndex)];
  const dubIds = ['hi.10', 'ru.10', 'nl-NL.10', 'ar.10', 'de-DE.10', 'ja.10'];
  const audioTracks = dubIds.map((audioTrackId) => ({ audioTrackId, captionTrackIndices }));
  audioTracks.splice(originalAt, 0, { audioTrackId: 'en-US.4', captionTrackIndices });
  return { captionTracks, audioTracks, defaultAudioTrackIndex: originalAt };
}

test('pickTrack uses the original audio language on auto-dubbed videos', () => {
  const captions = dubbedCaptions({ originalAt: 4 });
  const picked = pickTrack(captions);
  assert.equal(picked.languageCode, 'en');
  assert.equal(picked.kind, 'asr');
});

test('pickTrack finds the original language wherever the default audio track sits', () => {
  for (const originalAt of [0, 2, 6]) {
    assert.equal(pickTrack(dubbedCaptions({ originalAt })).languageCode, 'en');
  }
});

test('pickTrack prefers human-written captions in the original language on dubbed videos', () => {
  const human = track('en', null, 'English');
  assert.equal(pickTrack(dubbedCaptions({ originalAt: 1, extraTracks: [human] })), human);
});

test('pickTrack follows the audio track caption order when there is no audio track id', () => {
  const tracks = [track('ar', 'asr'), track('bn', 'asr'), track('en', 'asr')];
  const captions = { captionTracks: tracks, audioTracks: [{ captionTrackIndices: [2, 0, 1] }], defaultAudioTrackIndex: 0 };
  assert.equal(pickTrack(captions), tracks[2]);
});

test('parseJson3 turns caption events into clean lines', () => {
  const json = {
    events: [
      { tStartMs: 0, dDurationMs: 50000, id: 1, wpWinPosId: 1 },
      { tStartMs: 160, dDurationMs: 4000, segs: [{ utf8: 'Thank' }, { utf8: ' you', tOffsetMs: 300 }] },
      { tStartMs: 2400, dDurationMs: 1700, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 4100, dDurationMs: 3000, segs: [{ utf8: 'two\nlines  here ' }] },
      { tStartMs: 7000, segs: [{ utf8: '   ' }] },
    ],
  };
  assert.deepEqual(parseJson3(json), [
    { start: 160, dur: 4000, text: 'Thank you' },
    { start: 4100, dur: 3000, text: 'two lines here' },
  ]);
});

test('parseJson3 copes with an empty response', () => {
  assert.deepEqual(parseJson3({}), []);
  assert.deepEqual(parseJson3(null), []);
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    for (const route of routes) {
      const res = route(String(url), body);
      if (res) return res;
    }
    throw new Error(`unexpected request ${url}`);
  };
  fn.calls = calls;
  return fn;
}

const playerOk = (tracks, extra = {}) =>
  jsonResponse({ playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks, ...extra } } });

const timedtext = (url) =>
  url.includes('/api/timedtext') ? jsonResponse({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello' }] }] }) : null;

test('fetchTranscript asks YouTube as the first app client and reads the chosen track', async () => {
  const fetch = fakeFetch([
    (url) => (url.includes('/youtubei/v1/player') ? playerOk([track('en', 'asr', 'English (auto-generated)')]) : null),
    timedtext,
  ]);
  const result = await fetchTranscript('abc', { fetch, hl: 'de' });
  assert.deepEqual(result, {
    status: 'ok',
    videoId: 'abc',
    languageCode: 'en',
    trackName: 'English (auto-generated)',
    lines: [{ start: 0, dur: 1000, text: 'hello' }],
  });
  const playerCall = fetch.calls[0];
  assert.equal(playerCall.body.videoId, 'abc');
  assert.equal(playerCall.body.context.client.clientName, APP_CLIENTS[0].clientName);
  assert.equal(playerCall.body.context.client.hl, 'de');
  const captionUrl = new URL(fetch.calls[1].url);
  assert.equal(captionUrl.searchParams.get('fmt'), 'json3');
  assert.equal(captionUrl.searchParams.get('kind'), 'asr');
});

test('fetchTranscript tries the next app client when one is turned away', async () => {
  let playerCalls = 0;
  const fetch = fakeFetch([
    (url) => {
      if (!url.includes('/youtubei/v1/player')) return null;
      playerCalls += 1;
      if (playerCalls === 1) return jsonResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
      return playerOk([track('en')]);
    },
    timedtext,
  ]);
  const result = await fetchTranscript('abc', { fetch });
  assert.equal(result.status, 'ok');
  assert.equal(fetch.calls[1].body.context.client.clientName, APP_CLIENTS[1].clientName);
});

test('fetchTranscript tries the next app client when a caption file comes back empty', async () => {
  let captionCalls = 0;
  const fetch = fakeFetch([
    (url) => (url.includes('/youtubei/v1/player') ? playerOk([track('en')]) : null),
    (url) => {
      if (!url.includes('/api/timedtext')) return null;
      captionCalls += 1;
      return captionCalls === 1 ? jsonResponse({}) : timedtext(url);
    },
  ]);
  const result = await fetchTranscript('abc', { fetch });
  assert.equal(result.status, 'ok');
  assert.equal(result.lines.length, 1);
});

test('fetchTranscript reports a video with no captions as empty', async () => {
  const fetch = fakeFetch([
    (url) => (url.includes('/youtubei/v1/player') ? jsonResponse({ playabilityStatus: { status: 'OK' } }) : null),
  ]);
  assert.deepEqual(await fetchTranscript('abc', { fetch }), { status: 'empty', videoId: 'abc' });
  assert.equal(fetch.calls.length, 1);
});

test('fetchTranscript reports an error when every app client fails', async () => {
  const fetch = fakeFetch([
    (url) => (url.includes('/youtubei/v1/player') ? jsonResponse({ error: { code: 400 } }, 400) : null),
  ]);
  const result = await fetchTranscript('abc', { fetch });
  assert.equal(result.status, 'error');
  assert.equal(result.videoId, 'abc');
  assert.equal(fetch.calls.length, APP_CLIENTS.length);
});

test('fetchTranscript reports an error when the network throws', async () => {
  const fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const result = await fetchTranscript('abc', { fetch });
  assert.equal(result.status, 'error');
});
