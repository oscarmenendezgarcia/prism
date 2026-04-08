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
  /**
   * @param {object} [opts]
   * @param {number} [opts.failureThreshold=5]  Consecutive failures before opening.
   * @param {number} [opts.openMs=30000]        How long to stay open before probing.
   */
  constructor({ failureThreshold = 5, openMs = 30000 } = {}) {
    this._failureThreshold   = failureThreshold;
    this._openMs             = openMs;
    this._state              = STATE.CLOSED;
    this._consecutiveFailures = 0;
    this._openedAt           = null;
  }

  /**
   * Returns true if a request should be allowed through.
   *
   * CLOSED   → always passes.
   * OPEN     → blocks unless the open window has expired; on expiry transitions to
   *             HALF_OPEN and allows exactly one probe.
   * HALF_OPEN → blocks all calls (probe already in flight).
   */
  canPass() {
    if (this._state === STATE.CLOSED) {
      return true;
    }

    if (this._state === STATE.OPEN) {
      if (Date.now() - this._openedAt >= this._openMs) {
        // Transition: allow single probe
        this._state = STATE.HALF_OPEN;
        return true;
      }
      return false;
    }

    // HALF_OPEN: probe already in flight — block further attempts
    return false;
  }

  /**
   * Record a successful call. Resets failure count and closes the breaker.
   */
  recordSuccess() {
    this._consecutiveFailures = 0;
    this._state               = STATE.CLOSED;
    this._openedAt            = null;
  }

  /**
   * Record a failed call. Opens the breaker after threshold is reached,
   * or immediately if we are in HALF_OPEN (failed probe).
   */
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

  /**
   * Returns the current state string: 'closed' | 'open' | 'half-open'.
   */
  getState() {
    return this._state;
  }
}

module.exports = { CircuitBreaker, STATE };
