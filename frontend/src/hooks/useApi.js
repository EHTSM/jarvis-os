/**
 * useApi — shared loading/error/retry hook used by all phase-wired components.
 *
 * Usage:
 *   const { data, loading, error, reload } = useApi(fetchFn, [], { fallback: [] });
 *
 * - fetchFn is called on mount and on every reload().
 * - deps array triggers a re-fetch when any value changes (like useEffect deps).
 * - fallback is returned as data while loading or on error.
 * - Errors expose { message, status } — status is the HTTP status code if available.
 */
import { useState, useEffect, useCallback, useRef } from "react";

export function useApi(fetchFn, deps = [], { fallback = null, autoLoad = true } = {}) {
  const [data,    setData]    = useState(fallback);
  const [loading, setLoading] = useState(autoLoad);
  const [error,   setError]   = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current)
        setError({ message: err.message || "Request failed", status: err.status || 0 });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFn, ...deps]);

  useEffect(() => {
    if (autoLoad) load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, error, reload: load };
}

/**
 * useApiAction — for mutation calls (POST/DELETE) with loading + error state.
 * Returns [run, { loading, error, result }].
 */
export function useApiAction(actionFn) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [result,  setResult]  = useState(null);

  const run = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const r = await actionFn(...args);
      setResult(r);
      return r;
    } catch (err) {
      const e = { message: err.message || "Action failed", status: err.status || 0 };
      setError(e);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [actionFn]);

  return [run, { loading, error, result }];
}
