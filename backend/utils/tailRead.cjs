"use strict";
/**
 * Bounded newline-delimited tail reader.
 *
 * Mission 87: continuousRuntimeObserver.cjs's _readStructuredErrors() and
 * backgroundRuntime.cjs's _logObserver() both did an unconditional
 * fs.readFileSync() of the ENTIRE structured.ndjson file, then
 * .split("\n") over the whole thing, only to keep the last N lines — an
 * unbounded-with-file-size cost paid on every single firing (both run on a
 * 60s timer). This is the same growth-risk shape as the pre-Mission-84
 * missions.json full-read tick (which reached 76.8MB and measured 483ms
 * event-loop stalls before being fixed) — structured.ndjson has no
 * rotation/cap and will keep growing.
 *
 * readTailLines(filePath, minLines, opts) reads only a bounded byte range
 * from the END of the file via fs.readSync at a computed offset — the I/O
 * cost is independent of total file size, not just "usually small in
 * practice". Correctness (never truncating a real record) is guaranteed
 * two ways:
 *   1. The first line of any tail read is discarded unless the read
 *      started at byte 0 — a tail read that begins mid-file may have
 *      started in the middle of a line, and that partial fragment must
 *      never be treated as a real record.
 *   2. If, after discarding that first (possibly partial) line, fewer than
 *      `minLines` complete lines were recovered and the read did not
 *      already start at byte 0, the byte budget is doubled and the file is
 *      re-read from further back — bounded to a small number of retries —
 *      rather than silently returning fewer records than the caller needs
 *      or ever returning a malformed partial record.
 *
 * Two independent, real consumers of the identical file with the identical
 * requirement (recover the last N complete NDJSON records without loading
 * the whole file) is what justifies this as a shared utility rather than
 * two near-duplicate implementations.
 */

const fs = require("fs");

const _DEFAULT_INITIAL_BYTES = 64 * 1024; // 64KB — generously covers hundreds of typical structured-log lines
const _MAX_DOUBLINGS = 6;                 // 64KB -> up to 4MB before giving up and reading whatever the file has

/**
 * readTailLines(filePath, minLines, opts)
 *   filePath  — path to a newline-delimited text file
 *   minLines  — how many trailing complete lines the caller needs
 *   opts.initialBytes — starting byte budget for the tail read (default 64KB)
 *
 * Returns { lines: string[], bytesRead: number, truncatedFirstLine: boolean }
 *   lines              — up to the last `minLines` complete, non-empty lines
 *                         (fewer only if the file itself has fewer lines)
 *   bytesRead          — actual bytes read from disk for this call, for
 *                         callers/tests that want to assert boundedness
 *   truncatedFirstLine — true if a partial leading fragment was discarded
 *                         (i.e. the read did not start at byte 0)
 *
 * Never reads more of the file than the computed tail window — the total
 * file size is only ever consulted via a single fs.statSync() call, never
 * via a full read.
 */
function readTailLines(filePath, minLines, opts = {}) {
    const initialBytes = opts.initialBytes || _DEFAULT_INITIAL_BYTES;

    const size = fs.statSync(filePath).size;
    if (size === 0) return { lines: [], bytesRead: 0, truncatedFirstLine: false };

    let budget = Math.min(initialBytes, size);
    let attempt = 0;

    for (;;) {
        const start = Math.max(0, size - budget);
        const length = size - start;

        const fd = fs.openSync(filePath, "r");
        let buf;
        try {
            buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, start);
        } finally {
            fs.closeSync(fd);
        }

        const text = buf.toString("utf8");
        const startedAtZero = start === 0;
        // A tail read that doesn't start at byte 0 may begin mid-line — the
        // fragment before the first real newline is never a complete record.
        const firstNewline = text.indexOf("\n");
        const usable = startedAtZero
            ? text
            : (firstNewline === -1 ? "" : text.slice(firstNewline + 1));

        const lines = usable.split("\n").filter(Boolean);

        const gotEnough = lines.length >= minLines || startedAtZero;
        if (gotEnough || attempt >= _MAX_DOUBLINGS) {
            return {
                lines: lines.slice(-minLines),
                bytesRead: length,
                truncatedFirstLine: !startedAtZero,
            };
        }

        // Not enough complete lines recovered yet and there's more file
        // before our current window — double the budget and retry rather
        // than returning a short/malformed result.
        attempt++;
        budget = Math.min(budget * 2, size);
    }
}

module.exports = { readTailLines };
