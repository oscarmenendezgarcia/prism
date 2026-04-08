'use strict';

/**
 * PromptRefiner — orchestrates optional Inksmith refinement — blueprint §3.1, T-005.
 *
 * Responsibilities:
 *   1. Check feature flag (`prompts.inksmith.enabled`) and env key presence.
 *   2. Guard the call through the in-process CircuitBreaker.
 *   3. Delegate to InksmithClient.
 *   4. Record counters and emit structured log events (blueprint §3.7).
 *   5. NEVER throw — always return a result object.
 *
 * Return shape: { source: 'inksmith'|'local-fallback', prompt: string, refinementId: string|null, reason?: string }
 *
 * Counters (in-memory, reset on restart — acceptable per blueprint §T-007):
 *   getCounters() → { callsTotal, fallbackTotal, latencyMs, breakerState, lastFailures }
 */

const inksmithClient  = require('./inksmithClient');
const { CircuitBreaker } = require('./circuitBreaker');

// ---------------------------------------------------------------------------
// Module-level singletons (one breaker per process)
// ---------------------------------------------------------------------------

let _breaker = null;

/**
 * Lazily construct a CircuitBreaker on first call.
 * Settings changes (failureThreshold or openMs) take effect only after server
 * restart or an explicit resetBreaker() call — the breaker is created once and
 * retained for the process lifetime.
 */
function getBreaker(inksmithSettings) {
  const { failureThreshold = 5, openMs = 30000 } = inksmithSettings.circuitBreaker || {};

  if (!_breaker) {
    _breaker = new CircuitBreaker({ failureThreshold, openMs });
  }

  return _breaker;
}

/** Exposed for tests to reset breaker state between test suites. */
function resetBreaker() {
  _breaker = null;
}

// ---------------------------------------------------------------------------
// In-memory observability counters (blueprint §3.7, T-007)
// ---------------------------------------------------------------------------

const _counters = {
  callsTotal:   { success: 0, failure: 0 },
  fallbackTotal: {},
  latencySamples: [], // last 100 values (ms)
  lastFailures:  [],  // last 10 { reason, httpStatus?, ts }
};

const MAX_LATENCY_SAMPLES = 100;
const MAX_LAST_FAILURES   = 10;

function _incCallsTotal(outcome) {
  _counters.callsTotal[outcome] = (_counters.callsTotal[outcome] || 0) + 1;
}

function _incFallbackTotal(reason) {
  _counters.fallbackTotal[reason] = (_counters.fallbackTotal[reason] || 0) + 1;
}

function _recordLatency(ms) {
  _counters.latencySamples.push(ms);
  if (_counters.latencySamples.length > MAX_LATENCY_SAMPLES) {
    _counters.latencySamples.shift();
  }
}

function _recordFailureDetail(reason, httpStatus) {
  _counters.lastFailures.push({ reason, httpStatus: httpStatus || null, ts: new Date().toISOString() });
  if (_counters.lastFailures.length > MAX_LAST_FAILURES) {
    _counters.lastFailures.shift();
  }
}

/**
 * Return a snapshot of current observability counters.
 * Includes computed p50/p95 from recent latency samples.
 */
function getCounters() {
  const samples = _counters.latencySamples.slice().sort((a, b) => a - b);
  const p50 = samples.length ? samples[Math.floor(samples.length * 0.5)] : null;
  const p95 = samples.length ? samples[Math.floor(samples.length * 0.95)] : null;

  return {
    callsTotal:   { ..._counters.callsTotal },
    fallbackTotal: { ..._counters.fallbackTotal },
    latencyMs:    { p50, p95, sampleCount: samples.length },
    lastFailures: _counters.lastFailures.slice(),
    breakerState: _breaker ? _breaker.getState() : 'closed',
  };
}

/** Exposed for tests to reset counters between suites. */
function resetCounters() {
  _counters.callsTotal       = { success: 0, failure: 0 };
  _counters.fallbackTotal    = {};
  _counters.latencySamples   = [];
  _counters.lastFailures     = [];
}

// ---------------------------------------------------------------------------
// Structured logging (blueprint §3.7)
// ---------------------------------------------------------------------------

function _log(event, payload) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level:     'info',
    component: 'inksmith',
    event,
    ...payload,
  }));
}

// ---------------------------------------------------------------------------
// Main orchestration function
// ---------------------------------------------------------------------------

/**
 * Attempt to refine a raw prompt via Inksmith.
 * Falls back silently to the raw prompt on any failure.
 *
 * @param {string} rawPrompt   - Locally assembled prompt text.
 * @param {object} metadata    - { agentId, taskId, spaceId }
 * @param {object} settings    - Full Prism settings object (from readSettings).
 * @returns {Promise<{
 *   source:       'inksmith'|'local-fallback',
 *   prompt:       string,
 *   refinementId: string|null,
 *   reason?:      string
 * }>}
 */
async function refine(rawPrompt, metadata, settings) {
  const inksmithSettings = (settings && settings.prompts && settings.prompts.inksmith) || {};
  const apiKey           = process.env.INKSMITH_API_KEY || '';
  const enabled          = !!(inksmithSettings.enabled && apiKey);

  // ── Feature flag / missing key ───────────────────────────────────────────
  if (!enabled) {
    const reason = 'disabled';
    _incFallbackTotal(reason);
    _log('inksmith_fallback_used', { taskId: metadata && metadata.taskId, reason });
    return { source: 'local-fallback', prompt: rawPrompt, refinementId: null, reason };
  }

  // ── Circuit breaker ──────────────────────────────────────────────────────
  const breaker = getBreaker(inksmithSettings);

  if (!breaker.canPass()) {
    const reason = 'breaker_open';
    _incFallbackTotal(reason);
    _log('inksmith_fallback_used', { taskId: metadata && metadata.taskId, reason });
    return { source: 'local-fallback', prompt: rawPrompt, refinementId: null, reason };
  }

  // ── Call Inksmith ────────────────────────────────────────────────────────
  const start = Date.now();

  _log('inksmith_call_started', {
    taskId:   metadata && metadata.taskId,
    agentId:  metadata && metadata.agentId,
    endpoint: inksmithSettings.endpoint,
  });

  try {
    const result    = await inksmithClient.refine(rawPrompt, metadata, inksmithSettings);
    const latencyMs = Date.now() - start;

    if (!result.ok) {
      breaker.recordFailure();
      _incCallsTotal('failure');
      _incFallbackTotal(result.reason || 'inksmith_error');
      _recordLatency(latencyMs);
      _recordFailureDetail(result.reason || 'inksmith_error', result.httpStatus);

      _log('inksmith_call_failed', {
        taskId:     metadata && metadata.taskId,
        latencyMs,
        reason:     result.reason,
        httpStatus: result.httpStatus || null,
      });
      _log('inksmith_fallback_used', {
        taskId: metadata && metadata.taskId,
        reason: result.reason || 'inksmith_error',
      });

      if (breaker.getState() === 'open') {
        _log('inksmith_breaker_opened', { taskId: metadata && metadata.taskId });
      }

      return {
        source:       'local-fallback',
        prompt:       rawPrompt,
        refinementId: null,
        reason:       result.reason || 'inksmith_error',
      };
    }

    // ── Happy path ───────────────────────────────────────────────────────
    const prevState = breaker.getState();
    breaker.recordSuccess();
    _incCallsTotal('success');
    _recordLatency(latencyMs);

    // Emit breaker-closed event when a HALF_OPEN probe succeeds (blueprint §3.7).
    if (prevState === 'half-open') {
      _log('inksmith_breaker_closed', { taskId: metadata && metadata.taskId });
    }

    _log('inksmith_call_succeeded', {
      taskId:       metadata && metadata.taskId,
      latencyMs,
      refinementId: result.refinementId,
      inputTokens:  result.usage && result.usage.inputTokens,
      outputTokens: result.usage && result.usage.outputTokens,
    });

    return {
      source:       'inksmith',
      prompt:       result.refinedPrompt,
      refinementId: result.refinementId || null,
    };

  } catch (err) {
    // Unexpected error (should not happen — client wraps its own errors)
    const latencyMs = Date.now() - start;
    const reason    = 'unexpected_error';

    breaker.recordFailure();
    _incCallsTotal('failure');
    _incFallbackTotal(reason);
    _recordLatency(latencyMs);
    _recordFailureDetail(reason, null);

    _log('inksmith_call_failed', {
      taskId:   metadata && metadata.taskId,
      latencyMs,
      reason,
    });
    _log('inksmith_fallback_used', {
      taskId: metadata && metadata.taskId,
      reason,
    });

    return { source: 'local-fallback', prompt: rawPrompt, refinementId: null, reason };
  }
}

module.exports = { refine, getCounters, resetBreaker, resetCounters };
