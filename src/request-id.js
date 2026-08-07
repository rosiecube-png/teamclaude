// An identifier that joins a response the user is holding to a line in the
// server log (FR-17.3, seam S2).
//
// `reqId` (`src/server.js`) already numbers requests, but for the activity
// stream: it reaches the TUI hooks and not the log lines, and it restarts with
// the process. Conflating the two would change what the TUI displays for no
// benefit, so this is separate and does one thing.
//
// Eight hex characters because it is read aloud, pasted into a message, and
// typed back — a UUID is none of those things. Collisions are not a correctness
// problem: an operator searching the log has a timestamp and a host as well,
// and 32 bits keeps repeats rare enough not to mislead.

import { randomBytes } from 'node:crypto';

/** The documented shape, so a test can assert it rather than describe it. */
export const CORRELATION_ID_RE = /^[0-9a-f]{8}$/;

/** A fresh correlation id: 8 lowercase hex characters. */
export function newCorrelationId() {
  return randomBytes(4).toString('hex');
}
