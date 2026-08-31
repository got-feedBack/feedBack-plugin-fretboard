'use strict';
// Coverage for _fbGetActiveNotes: the window/sustain/fade logic that
// decides which fretboard dots light up at a given playhead time.
// Runs under the org reusable CI as `node tests/screen.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshPlugin() {
    global.window = {};
    const file = path.join(__dirname, '..', 'screen.js');
    delete require.cache[require.resolve(file)];
    return require(file);
}

const mod = freshPlugin();

test('uses the host string count for bass and extended-range charts', () => {
    for (const count of [4, 6, 7, 8]) {
        const highway = { getStringCount: () => count };
        assert.equal(mod._fbResolveStringCount(highway), count);
    }
});

test('falls back to metadata and instrument-aware defaults on older hosts', () => {
    assert.equal(mod._fbResolveStringCount({}, { stringCount: 7 }), 7);
    assert.equal(mod._fbResolveStringCount({}, { arrangement: 'Bass' }), 4);
    assert.equal(mod._fbResolveStringCount({}, { arrangement: 'Lead' }), 6);
});

test('builds standard top-to-bottom labels for common string counts', () => {
    assert.deepEqual(mod._fbStringNames(4, { arrangement: 'Bass' }), ['G', 'D', 'A', 'E']);
    assert.deepEqual(mod._fbStringNames(5, { arrangement: 'Bass' }), ['G', 'D', 'A', 'E', 'B']);
    assert.deepEqual(mod._fbStringNames(6, { arrangement: 'Bass' }), ['C', 'G', 'D', 'A', 'E', 'B']);
    assert.deepEqual(mod._fbStringNames(6, { arrangement: 'Lead' }), ['e', 'B', 'G', 'D', 'A', 'E']);
    assert.deepEqual(mod._fbStringNames(7, { arrangement: 'Lead' }), ['e', 'B', 'G', 'D', 'A', 'E', 'B']);
    assert.deepEqual(mod._fbStringNames(8, { arrangement: 'Lead' }), ['e', 'B', 'G', 'D', 'A', 'E', 'B', 'F#']);
});

test('maps low-to-high chart indices onto high-to-low display rows', () => {
    assert.equal(mod._fbDisplayStringIndex(0, 4), 3);
    assert.equal(mod._fbDisplayStringIndex(3, 4), 0);
    assert.equal(mod._fbDisplayStringIndex(0, 7), 6);
    assert.equal(mod._fbDisplayStringIndex(6, 7), 0);
    assert.equal(mod._fbDisplayStringIndex(7, 7), -1);
});

test('provides stable normal and bright colors for extended strings', () => {
    for (let string = 0; string < 8; string++) {
        assert.match(mod._fbStringColor(string), /^#[0-9a-f]{6}$/i);
        assert.match(mod._fbStringColor(string, true), /^#[0-9a-f]{6}$/i);
    }
});

test('scales string spacing and fret markers for every supported width', () => {
    for (const count of [4, 6, 7, 8]) {
        const layout = mod._fbLayout(800, 150, count);
        assert.equal(layout.stringSpan, count - 1);
        assert.equal(layout.fretboardBottom, 130);
        assert.equal(layout.singleDotY, 70);
        assert.ok(layout.doubleDotYs[0] < layout.singleDotY);
        assert.ok(layout.doubleDotYs[1] > layout.singleDotY);
        assert.equal(layout.doubleDotYs[0] + layout.doubleDotYs[1], 140);
    }
});

test('a note within the 80ms window and no sustain is fully active', () => {
    const active = mod._fbGetActiveNotes(1.0, [{ t: 1.0, s: 0, f: 3 }], null);
    assert.deepEqual(active, [{ s: 0, f: 3, alpha: 1 }]);
});

test('a note outside the window is excluded', () => {
    const active = mod._fbGetActiveNotes(1.0, [{ t: 0.5, s: 0, f: 3 }], null);
    assert.deepEqual(active, []);
});

test('a note with sustain fades linearly toward a 0.3 floor', () => {
    const notes = [{ t: 0, s: 0, f: 0, sus: 1.0 }];
    const early = mod._fbGetActiveNotes(0.1, notes, null)[0];
    const late = mod._fbGetActiveNotes(0.9, notes, null)[0];
    assert.ok(early.alpha > late.alpha);
    assert.ok(late.alpha >= 0.3);
});

test('a sustained note stays active through its full duration', () => {
    const notes = [{ t: 0, s: 0, f: 0, sus: 2.0 }];
    assert.equal(mod._fbGetActiveNotes(1.9, notes, null).length, 1);
    assert.equal(mod._fbGetActiveNotes(2.5, notes, null).length, 0); // well past sustain+window
});

test('notes iteration stops early via the sorted-by-time break guard', () => {
    // A note far in the future (>0.5s ahead) should not suppress earlier
    // active notes reachable before the break fires.
    const notes = [
        { t: 1.0, s: 0, f: 0 },
        { t: 5.0, s: 1, f: 1 }, // way ahead -> triggers break on the next iteration
    ];
    const active = mod._fbGetActiveNotes(1.0, notes, null);
    assert.deepEqual(active, [{ s: 0, f: 0, alpha: 1 }]);
});

test('chord notes within window are all included', () => {
    const chords = [{ t: 1.0, notes: [{ s: 0, f: 0 }, { s: 1, f: 2 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    assert.deepEqual(active, [
        { s: 0, f: 0, alpha: 1 },
        { s: 1, f: 2, alpha: 1 },
    ]);
});

test('a chord well before the current time is excluded (0.3s lookback)', () => {
    const chords = [{ t: 0.5, notes: [{ s: 0, f: 0 }] }];
    assert.deepEqual(mod._fbGetActiveNotes(1.0, null, chords), []);
});

test('individual chord-member sustain still governs member inclusion', () => {
    // Chord onset within the 0.3s lookback gate; members have different sustains.
    const chords = [{ t: 0.85, notes: [{ s: 0, f: 0, sus: 0 }, { s: 1, f: 1, sus: 2.0 }] }];
    const active = mod._fbGetActiveNotes(1.0, null, chords);
    // Only the long-sustain member should still be ringing at t=1.0.
    assert.equal(active.length, 1);
    assert.equal(active[0].s, 1);
});

test('handles missing notes/chords gracefully', () => {
    assert.deepEqual(mod._fbGetActiveNotes(1.0, null, null), []);
    assert.deepEqual(mod._fbGetActiveNotes(1.0, undefined, undefined), []);
});

test('combines standalone notes and chords in one active list', () => {
    const notes = [{ t: 1.0, s: 0, f: 0 }];
    const chords = [{ t: 1.0, notes: [{ s: 1, f: 1 }] }];
    const active = mod._fbGetActiveNotes(1.0, notes, chords);
    assert.equal(active.length, 2);
});
