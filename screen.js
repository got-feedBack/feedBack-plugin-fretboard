// Fretboard View plugin
// Draws a horizontal guitar fretboard that lights up with active notes.

let _fbEnabled = false;
let _fbCanvas = null;
let _fbCtx = null;
let _fbDismissBtn = null;

const FB_DEFAULT_STRINGS = 6;
const FB_FRETS = 24;
const FB_STRING_COLORS = [
    '#cc0000', '#cca800', '#0066cc',
    '#cc6600', '#00cc66', '#9900cc',
    '#008b8b', '#cc3377',
];
const FB_STRING_BRIGHT = [
    '#ff4444', '#ffe050', '#4499ff',
    '#ff9944', '#44ff99', '#cc44ff',
    '#44dddd', '#ff66aa',
];
const FB_GUITAR_STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E', 'B', 'F#'];
const FB_BASS_STRING_NAMES = {
    4: ['G', 'D', 'A', 'E'],
    5: ['G', 'D', 'A', 'E', 'B'],
    6: ['C', 'G', 'D', 'A', 'E', 'B'],
};
const FB_DOT_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const FB_DOUBLE_DOT = [12, 24];

function _fbIsBass(songInfo) {
    const description = [
        songInfo && songInfo.arrangement,
        songInfo && songInfo.instrument,
    ].filter(Boolean).join(' ');
    return /bass/i.test(description);
}

function _fbResolveStringCount(highwayApi, songInfo = {}) {
    if (highwayApi && typeof highwayApi.getStringCount === 'function') {
        try {
            const count = Number(highwayApi.getStringCount());
            if (Number.isInteger(count) && count > 0) return count;
        } catch (_) {
            // Fall through to song metadata/defaults on older hosts.
        }
    }

    const metadataCount = Number(songInfo.stringCount);
    if (Number.isInteger(metadataCount) && metadataCount > 0) return metadataCount;
    return _fbIsBass(songInfo) ? 4 : FB_DEFAULT_STRINGS;
}

function _fbStringNames(stringCount, songInfo = {}) {
    if (_fbIsBass(songInfo) && FB_BASS_STRING_NAMES[stringCount]) {
        return [...FB_BASS_STRING_NAMES[stringCount]];
    }
    if (!_fbIsBass(songInfo) && stringCount <= FB_GUITAR_STRING_NAMES.length) {
        return FB_GUITAR_STRING_NAMES.slice(0, stringCount);
    }
    return Array.from({ length: stringCount }, (_, index) => `S${index + 1}`);
}

function _fbStringColor(rsString, bright = false) {
    const palette = bright ? FB_STRING_BRIGHT : FB_STRING_COLORS;
    const index = ((rsString % palette.length) + palette.length) % palette.length;
    return palette[index];
}

function _fbDisplayStringIndex(rsString, stringCount) {
    if (!Number.isInteger(rsString) || rsString < 0 || rsString >= stringCount) return -1;
    return stringCount - 1 - rsString;
}

function _fbLayout(width, height, stringCount) {
    const padL = 35;
    const padR = 10;
    const padT = 10;
    const padB = 20;
    const stringSpan = Math.max(0, stringCount - 1);
    const stringH = stringSpan > 0 ? (height - padT - padB) / stringSpan : 0;
    return {
        padL,
        padR,
        padT,
        padB,
        fretW: (width - padL - padR) / FB_FRETS,
        stringSpan,
        stringH,
        fretboardBottom: padT + stringSpan * stringH,
        singleDotY: padT + stringSpan * 0.5 * stringH,
        doubleDotYs: [
            padT + stringSpan * 0.3 * stringH,
            padT + stringSpan * 0.7 * stringH,
        ],
    };
}

// ── Toggle ──────────────────────────────────────────────────────────────

function _fbInjectButton() {
    const controls = document.getElementById('player-controls');
    if (!controls || document.getElementById('btn-fretboard')) return;

    const closeBtn = controls.querySelector('button:last-child');
    const btn = document.createElement('button');
    btn.id = 'btn-fretboard';
    btn.className = 'px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-400 transition';
    btn.textContent = 'Fretboard';
    btn.title = 'Toggle fretboard overlay';
    btn.onclick = _fbToggle;
    if (closeBtn && closeBtn.parentNode === controls) controls.insertBefore(btn, closeBtn); else controls.appendChild(btn);
}

function _fbToggle() {
    _fbEnabled = !_fbEnabled;
    const btn = document.getElementById('btn-fretboard');
    if (btn) {
        btn.className = _fbEnabled
            ? 'px-3 py-1.5 bg-teal-900/50 rounded-lg text-xs text-teal-300 transition'
            : 'px-3 py-1.5 bg-dark-600 hover:bg-dark-500 rounded-lg text-xs text-gray-400 transition';
        btn.textContent = _fbEnabled ? 'Fretboard ✓' : 'Fretboard';
    }

    if (_fbEnabled) {
        _fbCreateCanvas();
    } else {
        _fbRemoveCanvas();
    }
}

function _fbCreateCanvas() {
    if (_fbCanvas) return;
    const player = document.getElementById('player');
    if (!player) return;

    // `bottom` is set dynamically by _fbResize to match the controls-bar height
    // (which changes when the bar flex-wraps to multiple rows on narrow windows).
    _fbCanvas = document.createElement('canvas');
    _fbCanvas.id = 'fretboard-canvas';
    _fbCanvas.style.cssText = 'position:absolute;left:0;right:0;z-index:20;pointer-events:none;';

    // Insert before the controls bar
    const controls = document.getElementById('player-controls');
    if (controls && controls.parentNode === player) player.insertBefore(_fbCanvas, controls); else player.appendChild(_fbCanvas);

    // Dismiss button — small ✕ at top-right of the overlay. Sibling of the
    // canvas (not drawn into it) so pointer-events:auto makes it clickable
    // even though the canvas itself keeps pointer-events:none.
    _fbDismissBtn = document.createElement('button');
    _fbDismissBtn.id = 'btn-fretboard-dismiss';
    _fbDismissBtn.textContent = '✕';
    _fbDismissBtn.title = 'Hide fretboard overlay';
    _fbDismissBtn.style.cssText =
        'position:absolute;right:8px;z-index:21;width:24px;height:24px;' +
        'display:flex;align-items:center;justify-content:center;' +
        'background:rgba(8,8,16,0.85);border:1px solid rgba(100,100,130,0.5);' +
        'border-radius:4px;color:#aaa;cursor:pointer;font-size:12px;' +
        'pointer-events:auto;';
    _fbDismissBtn.onclick = _fbToggle;
    if (controls && controls.parentNode === player) player.insertBefore(_fbDismissBtn, controls); else player.appendChild(_fbDismissBtn);

    _fbCtx = _fbCanvas.getContext('2d');
    _fbResize();
    window.addEventListener('resize', _fbResize);
    requestAnimationFrame(_fbDraw);
}

function _fbRemoveCanvas() {
    if (_fbCanvas) {
        window.removeEventListener('resize', _fbResize);
        _fbCanvas.remove();
        _fbCanvas = null;
        _fbCtx = null;
    }
    if (_fbDismissBtn) {
        _fbDismissBtn.remove();
        _fbDismissBtn = null;
    }
}

function _fbResize() {
    if (!_fbCanvas) return;
    const player = document.getElementById('player');
    const controls = document.getElementById('player-controls');
    if (!player) return;

    // Sit flush above the controls bar regardless of how many rows it wrapped to.
    const controlsH = controls ? controls.offsetHeight : 50;
    _fbCanvas.style.bottom = controlsH + 'px';
    _fbCanvas.width = player.clientWidth;
    _fbCanvas.height = Math.max(120, player.clientHeight * 0.15);

    // Park the dismiss button at the top-right of the fretboard area.
    if (_fbDismissBtn) {
        _fbDismissBtn.style.bottom = (controlsH + _fbCanvas.height - 30) + 'px';
    }
}

// ── Drawing ─────────────────────────────────────────────────────────────

function _fbDraw() {
    if (!_fbEnabled || !_fbCanvas || !_fbCtx) return;
    requestAnimationFrame(_fbDraw);

    const W = _fbCanvas.width;
    const H = _fbCanvas.height;
    const ctx = _fbCtx;
    const songInfo = (typeof highway.getSongInfo === 'function' && highway.getSongInfo()) || {};
    const stringCount = _fbResolveStringCount(highway, songInfo);

    // Clear
    ctx.fillStyle = 'rgba(8, 8, 16, 0.92)';
    ctx.fillRect(0, 0, W, H);

    const {
        padL, padR, padT, fretW, stringSpan, stringH,
        fretboardBottom, singleDotY, doubleDotYs,
    } = _fbLayout(W, H, stringCount);

    // Draw fret lines
    ctx.strokeStyle = '#2a2a40';
    ctx.lineWidth = 1;
    for (let f = 0; f <= FB_FRETS; f++) {
        const x = padL + f * fretW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + stringSpan * stringH);
        ctx.stroke();

        // Nut (thicker at fret 0)
        if (f === 0) {
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, padT);
            ctx.lineTo(x, padT + stringSpan * stringH);
            ctx.stroke();
            ctx.strokeStyle = '#2a2a40';
            ctx.lineWidth = 1;
        }
    }

    // Draw fret dots
    for (const f of FB_DOT_FRETS) {
        if (f > FB_FRETS) continue;
        const x = padL + (f - 0.5) * fretW;
        const isDouble = FB_DOUBLE_DOT.includes(f);
        ctx.fillStyle = '#1a1a30';
        if (isDouble) {
            const [y1, y2] = doubleDotYs;
            ctx.beginPath(); ctx.arc(x, y1, 4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x, y2, 4, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.beginPath(); ctx.arc(x, singleDotY, 4, 0, Math.PI * 2); ctx.fill();
        }
    }

    // Draw strings
    for (let s = 0; s < stringCount; s++) {
        const y = padT + s * stringH;
        // Display strings high-to-low; chart strings are indexed low-to-high.
        const rsString = stringCount - 1 - s;
        ctx.strokeStyle = _fbStringColor(rsString);
        ctx.lineWidth = 1 + s * 0.3;  // thicker for lower strings
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Draw fret numbers
    ctx.fillStyle = '#444';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = 1; f <= FB_FRETS; f++) {
        const x = padL + (f - 0.5) * fretW;
        ctx.fillText(f, x, fretboardBottom + 5);
    }

    // String names
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 10px sans-serif';
    const stringNames = _fbStringNames(stringCount, songInfo);
    for (let s = 0; s < stringCount; s++) {
        const y = padT + s * stringH;
        const rsString = stringCount - 1 - s;
        ctx.fillStyle = _fbStringColor(rsString);
        ctx.fillText(stringNames[s], padL - 8, y);
    }

    // Get active notes
    const t = highway.getTime();
    const notes = highway.getNotes();
    const chords = highway.getChords();
    const activeNotes = _fbGetActiveNotes(t, notes, chords);

    // Draw active notes
    for (const n of activeNotes) {
        const rsString = n.s;  // the chart string (0=low E)
        const fret = n.f;
        const drawString = _fbDisplayStringIndex(rsString, stringCount);
        if (drawString < 0) continue;

        const y = padT + drawString * stringH;
        let x;
        if (fret === 0) {
            x = padL - 2;  // open string: at the nut
        } else {
            x = padL + (fret - 0.5) * fretW;
        }

        const color = _fbStringColor(rsString, true);
        const alpha = n.alpha || 1;

        // Glow
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();

        // Note dot
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();

        // Fret number
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fret, x, y);

        ctx.globalAlpha = 1;
    }
}

function _fbGetActiveNotes(t, notes, chords) {
    const active = [];
    const window = 0.08;  // notes within 80ms of current time

    // Standalone notes
    if (notes) {
        for (const n of notes) {
            const noteEnd = n.t + (n.sus || 0);
            if (n.t <= t + window && noteEnd >= t - window) {
                // Fade based on sustain progress
                let alpha = 1;
                if (n.sus > 0 && t > n.t) {
                    alpha = Math.max(0.3, 1 - (t - n.t) / n.sus * 0.7);
                }
                active.push({ s: n.s, f: n.f, alpha });
            }
            if (n.t > t + 0.5) break;  // notes are sorted by time
        }
    }

    // Chord notes
    if (chords) {
        for (const c of chords) {
            if (c.t <= t + window && c.t >= t - 0.3) {
                for (const cn of (c.notes || [])) {
                    const noteEnd = c.t + (cn.sus || 0);
                    if (noteEnd >= t - window) {
                        let alpha = 1;
                        if (cn.sus > 0 && t > c.t) {
                            alpha = Math.max(0.3, 1 - (t - c.t) / cn.sus * 0.7);
                        }
                        active.push({ s: cn.s, f: cn.f, alpha });
                    }
                }
            }
            if (c.t > t + 0.5) break;
        }
    }

    return active;
}

// Node-only export hook for tests; browsers fall through to the hooks IIFE.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        _fbDisplayStringIndex,
        _fbGetActiveNotes,
        _fbIsBass,
        _fbLayout,
        _fbResolveStringCount,
        _fbStringColor,
        _fbStringNames,
    };
} else {

// ── Hooks ───────────────────────────────────────────────────────────────

(function() {
    // Idempotency: if screen.js is re-evaluated (loader cache miss, hot reload,
    // older core builds without the load-side guard), don't re-wrap playSong —
    // each re-wrap captures the previous wrapper, growing the chain and
    // leaking closures.
    const HOOK_KEY = '__slopsmithFretboardHooksInstalled';
    if (window[HOOK_KEY]) return;
    window[HOOK_KEY] = true;

    const origPlaySong = window.playSong;
    window.playSong = async function(filename, arrangement) {
        await origPlaySong(filename, arrangement);
        _fbInjectButton();
        if (_fbEnabled) {
            _fbRemoveCanvas();
            _fbCreateCanvas();
        }
    };
})();

}
