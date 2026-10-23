const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatTime,
  toTimestampedText,
  toPlainText,
  fileNameFor,
  buildDownload,
  findActiveIndex,
} = require('../src/format.js');

const line = (start, text, dur = 2000) => ({ start, dur, text });

test('formatTime renders minutes and seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(4000), '0:04');
  assert.equal(formatTime(4999), '0:04');
  assert.equal(formatTime(65000), '1:05');
  assert.equal(formatTime(600000), '10:00');
});

test('formatTime adds hours for long videos', () => {
  assert.equal(formatTime(3600000), '1:00:00');
  assert.equal(formatTime(3725000), '1:02:05');
});

test('toTimestampedText puts one line per row with its start time', () => {
  const text = toTimestampedText([line(0, 'Hello there'), line(4200, 'General Kenobi')]);
  assert.equal(text, '0:00 Hello there\n0:04 General Kenobi');
});

test('toPlainText joins lines into a paragraph', () => {
  const text = toPlainText([line(0, 'one', 1000), line(1000, 'two', 1000), line(2000, 'three', 1000)]);
  assert.equal(text, 'one two three');
});

test('toPlainText starts a new paragraph after a long pause', () => {
  const text = toPlainText([line(0, 'before', 1000), line(5000, 'after', 1000)]);
  assert.equal(text, 'before\n\nafter');
});

test('toPlainText breaks long paragraphs at the end of a sentence', () => {
  const long = 'word '.repeat(110).trim() + '.';
  const text = toPlainText([line(0, long, 1000), line(1000, 'Next sentence.', 1000)]);
  assert.equal(text, `${long}\n\nNext sentence.`);
});

test('toPlainText keeps short paragraphs together even at sentence ends', () => {
  const text = toPlainText([line(0, 'Short.', 1000), line(1000, 'Also short.', 1000)]);
  assert.equal(text, 'Short. Also short.');
});

test('toPlainText caps paragraphs when there is no punctuation at all', () => {
  const chunk = 'word '.repeat(60).trim();
  const lines = Array.from({ length: 6 }, (_, i) => line(i * 1000, chunk, 1000));
  const paragraphs = toPlainText(lines).split('\n\n');
  assert.ok(paragraphs.length > 1);
  assert.ok(paragraphs.every((p) => p.length <= 1000 + chunk.length));
});

test('fileNameFor strips characters that are not allowed in file names', () => {
  assert.equal(fileNameFor('What: is "this" <video>?'), 'What is this video.txt');
  assert.equal(fileNameFor('a/b\\c|d*e'), 'abcde.txt');
});

test('fileNameFor falls back when the title is empty', () => {
  assert.equal(fileNameFor(''), 'transcript.txt');
  assert.equal(fileNameFor('   '), 'transcript.txt');
  assert.equal(fileNameFor(undefined), 'transcript.txt');
});

test('buildDownload puts the title and link above the transcript', () => {
  const lines = [line(0, 'Hi'), line(3000, 'there')];
  const withTimes = buildDownload({ title: 'Talk', url: 'https://www.youtube.com/watch?v=abc', lines, showTimestamps: true });
  assert.equal(withTimes, 'Talk\nhttps://www.youtube.com/watch?v=abc\n\n0:00 Hi\n0:03 there\n');
  const plain = buildDownload({ title: 'Talk', url: 'https://www.youtube.com/watch?v=abc', lines, showTimestamps: false });
  assert.equal(plain, 'Talk\nhttps://www.youtube.com/watch?v=abc\n\nHi there\n');
});

test('findActiveIndex returns the last line that has started', () => {
  const lines = [line(1000, 'a'), line(3000, 'b'), line(7000, 'c')];
  assert.equal(findActiveIndex(lines, 0), -1);
  assert.equal(findActiveIndex(lines, 1000), 0);
  assert.equal(findActiveIndex(lines, 2999), 0);
  assert.equal(findActiveIndex(lines, 3000), 1);
  assert.equal(findActiveIndex(lines, 99999), 2);
  assert.equal(findActiveIndex([], 5000), -1);
});
