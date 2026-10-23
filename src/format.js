(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstantTranscript = Object.assign(root.InstantTranscript || {}, api);
})(globalThis, function () {
  const PARAGRAPH_PAUSE_MS = 2000;
  const PARAGRAPH_SOFT_LIMIT = 500;
  const PARAGRAPH_HARD_LIMIT = 1000;

  function formatTime(ms) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
    return `${minutes}:${seconds}`;
  }

  function toTimestampedText(lines) {
    return lines.map((l) => `${formatTime(l.start)} ${l.text}`).join('\n');
  }

  function toPlainText(lines) {
    const paragraphs = [];
    let current = '';
    let previous = null;
    for (const l of lines) {
      if (previous && current) {
        const pause = l.start - (previous.start + previous.dur);
        const sentenceEnded = /[.?!…]["')\]]*$/.test(previous.text);
        if (
          pause >= PARAGRAPH_PAUSE_MS ||
          (current.length >= PARAGRAPH_SOFT_LIMIT && sentenceEnded) ||
          current.length >= PARAGRAPH_HARD_LIMIT
        ) {
          paragraphs.push(current);
          current = '';
        }
      }
      current = current ? `${current} ${l.text}` : l.text;
      previous = l;
    }
    if (current) paragraphs.push(current);
    return paragraphs.join('\n\n');
  }

  function fileNameFor(title) {
    const clean = String(title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.+$/, '')
      .slice(0, 120)
      .trim();
    return `${clean || 'transcript'}.txt`;
  }

  function buildDownload({ title, url, lines, showTimestamps }) {
    const body = showTimestamps ? toTimestampedText(lines) : toPlainText(lines);
    return `${title}\n${url}\n\n${body}\n`;
  }

  function findActiveIndex(lines, ms) {
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lines[mid].start <= ms) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  return { formatTime, toTimestampedText, toPlainText, fileNameFor, buildDownload, findActiveIndex };
});
