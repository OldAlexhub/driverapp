// Diagnostics/uploading removed — provide no-op implementations so callers are safe.
export async function reportRuntimeError(_entry: {
  message: string;
  stack?: string | null;
  at?: string;
  fatal?: boolean;
  extra?: Record<string, any> | null;
}, _token?: string | null) {
  // no-op
}

export function setupGlobalHandlers(_getToken?: () => string | null) {
  // no-op
}

export default {
  reportRuntimeError,
  setupGlobalHandlers,
};
