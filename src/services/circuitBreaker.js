'use strict';

/**
 * Minimal in-process circuit breaker — blueprint §3.1, T-003.
 *
 * State machine:
 *   CLOSED  → (N consecutive failures) → OPEN
 *   OPEN    → (openMs elapsed)         → HALF_OPEN  (single probe)
 *   HALF_OPEN → success                → CLOSED
 *   HALF_OPEN → failure                → OPEN  (reset timer)
 *
 * No setTimeout / timer leaks: state transitions use Date.now() comparisons.
 * Zero external dependencies.
 *
 * Public API: canPass(), recordSuccess(), recordFailure(), getState()
 */

const STATE = Object.freeze({
  CLOSED:    'closed',
  OPEN:      'open',
  HALF_OPEN: 'half-open',
});

class CircuitBreaker {
  constructor({ failureThreshold = 5, openMs = 30000 } = {}) {
    this._failureThreshold    = failureThreshold;
    this._openMs              = openMs;
    this._state               = STATE.CLOSED;
    this._consecutiveFailures = 0;
    this._openedAt            = null;
  }

  canPass() {
    if (this._state === STATE.CLOSED) return true;
    if (this._state === STATE.OPEN) {
      if (Date.now() - this._openedAt >= this._openMs) {
        this._state = STATE.HALF_OPEN;
        return true;
      }
      return false;
    }
    return false; // HALF_OPEN: probe already in flight
  }

  recordSuccess() {
    this._consecutiveFailures = 0;
    this._state               = STATE.CLOSED;
    this._openedAt            = null;
  }

  recordFailure() {
    this._consecutiveFailures++;
    const shouldOpen =
      this._state === STATE.HALF_OPEN ||
      this._consecutiveFailures >= this._failureThreshold;
    if (shouldOpen) {
      this._state               = STATE.OPEN;
      this._openedAt            = Date.now();
      this._consecutiveFailures = 0;
    }
  }

  getState() {
    return this._state;
  }
}

module.exports = { CircuitBreaker, STATE };
