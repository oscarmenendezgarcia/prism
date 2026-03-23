/**
 * activityLogger.js — Activity Event Capture Facade
 *
 * ADR-1 (Activity Feed) §2.1: ActivityLogger receives mutation metadata,
 * constructs ActivityEvent objects, calls ActivityStore.append(), and
 * broadcasts to registered WebSocket listeners.
 *
 * Design: fire-and-forget. Errors in append or broadcast are caught and
 * logged — never re-thrown. Mutation handlers that call log() are not
 * blocked or affected if the logger fails.
 *
 * Usage:
 *   const logger = createActivityLogger({ store, broadcast });
 *   logger.log('task.created', spaceId, { taskId, taskTitle });
 */

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an ActivityLogger instance.
 *
 * @param {object} deps
 * @param {{ append: (event: object) => void }} deps.store      - ActivityStore instance.
 * @param {(event: object) => void}             deps.broadcast  - Broadcast function from activity-ws.
 * @returns {{ log: (type: string, spaceId: string, payload: object) => void }}
 */
function createActivityLogger({ store, broadcast }) {
  if (!store || typeof store.append !== 'function') {
    throw new Error('ActivityLogger requires a store with an append() method');
  }
  if (typeof broadcast !== 'function') {
    throw new Error('ActivityLogger requires a broadcast function');
  }

  /**
   * Construct and persist an activity event, then broadcast to all WS clients.
   *
   * @param {string} type     - ActivityEventType (e.g. 'task.created').
   * @param {string} spaceId  - Space in which the event occurred.
   * @param {object} payload  - Contextual metadata (taskId, taskTitle, from, to, spaceName, etc.).
   */
  function log(type, spaceId, payload) {
    const event = {
      id:        crypto.randomUUID(),
      type,
      spaceId,
      timestamp: new Date().toISOString(),
      actor:     'system',
      payload:   payload || {},
    };

    // Append to disk — fire-and-forget.
    try {
      store.append(event);
    } catch (err) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'error',
        component: 'activity-logger',
        event:     'append_failed',
        eventType: type,
        spaceId,
        error:     err.message,
      }));
    }

    // Broadcast to WS clients — fire-and-forget.
    try {
      broadcast(event);
    } catch (err) {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level:     'error',
        component: 'activity-logger',
        event:     'broadcast_failed',
        eventType: type,
        spaceId,
        error:     err.message,
      }));
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'activity-logger',
      event:     'event_logged',
      eventType: type,
      spaceId,
      eventId:   event.id,
    }));
  }

  return { log };
}

module.exports = { createActivityLogger };
