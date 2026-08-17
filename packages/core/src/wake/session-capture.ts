/**
 * Extracts a Claude Code session id from a hook payload, using the real field
 * name confirmed by decompiling the installed claude.exe binary and cross-checked
 * against code.claude.com/docs/en/hooks.md's documented common input fields:
 * `session_id` (snake_case). This is intentionally a single, pure, well-tested
 * function rather than inlined at each hook-runtime call site, precisely because
 * getting this field name wrong once already caused a real, shipped bug (see
 * packages/hook-runtime/src/index.ts's fix commit) -- one verified place to get
 * it right, reused everywhere Relay needs a session id from a hook payload.
 */
export function captureSessionId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>).session_id;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return undefined;
  return trimmed;
}

/** Which of Relay's three retained hooks the payload can refresh identity from. */
export type SessionCaptureEvent = 'SessionStart' | 'PreCompact' | 'StopFailure';

export interface CapturedSessionIdentity {
  sessionId: string;
  event: SessionCaptureEvent;
  capturedAt: string;
}

/**
 * Convenience wrapper used by hook-runtime call sites: only returns an
 * identity when the event is one Relay actually persists state for, and only
 * when a session id was present. Callers are responsible for deciding
 * whether Automatic Wake is enabled before persisting anything (Part 5: "Do
 * not create wake.json for users who have not opted in").
 */
export function captureSessionIdentity(event: SessionCaptureEvent, payload: unknown): CapturedSessionIdentity | undefined {
  const sessionId = captureSessionId(payload);
  if (!sessionId) return undefined;
  return { sessionId, event, capturedAt: new Date().toISOString() };
}
