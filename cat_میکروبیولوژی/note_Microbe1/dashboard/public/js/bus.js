// Minimal pub/sub bus: views stay decoupled from the document controller.

const listeners = new Map();

/**
 * Subscribe to an event.
 * @returns {() => void} unsubscribe
 */
export function on(eventName, handler) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(handler);

    return () => listeners.get(eventName)?.delete(handler);
}

export function emit(eventName, payload) {
    const handlers = listeners.get(eventName);
    if (!handlers) return;

    for (const handler of [...handlers]) {
        try {
            handler(payload);
        } catch (error) {
            // One broken listener must not stop the others.
            console.error(`Listener for "${eventName}" failed:`, error);
        }
    }
}
