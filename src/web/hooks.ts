import { useCallback, useEffect, useState } from "react";
import { ApiError, type Photo } from "./api";
import { toggledAll } from "./selection";

export interface Loaded<T> {
  data: T | undefined;
  error: Error | undefined;
  reload: () => void;
  setData: (data: T) => void;
}

/** Loads on mount and whenever `deps` change; `reload` refetches while keeping the data on screen. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: Error }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setState({ data }),
      (error: Error) => current && setState((previous) => ({ ...previous, error })),
    );
    return () => {
      current = false;
    };
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const setData = useCallback((data: T) => setState({ data }), []);
  return { data: state.data, error: state.error, reload, setData };
}

export interface Action {
  busy: boolean;
  error: string | null;
  /** `messages` replaces the API's message for the listed error codes. */
  run: (action: () => Promise<void>, messages?: Record<string, string>) => Promise<void>;
}

/** Runs a user-triggered request, exposing its progress and the API's refusal as text. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, messages: Record<string, string> = {}) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(messages[failure.code] ?? failure.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export interface Selection {
  ids: ReadonlySet<string>;
  toggle: (photo: Photo) => void;
  /** Selects all of `photos`, or clears the selection when all of them already are. */
  toggleAll: (photos: Photo[]) => void;
  clear: () => void;
}

export function useSelection(): Selection {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = (photo: Photo) =>
    setIds((current) => {
      const next = new Set(current);
      if (!next.delete(photo.id)) next.add(photo.id);
      return next;
    });
  const toggleAll = (photos: Photo[]) => setIds((current) => toggledAll(photos, current));
  const clear = () => setIds(new Set());
  return { ids, toggle, toggleAll, clear };
}

export interface KnownDownloads {
  ids: ReadonlySet<string>;
  mark: (photos: Photo[]) => void;
}

/**
 * The photos downloaded on this page, shown as downloaded right away (with `withDownloaded`) and
 * through every later read of the photos, even one that started before the download.
 */
export function useKnownDownloads(): KnownDownloads {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const mark = useCallback((photos: Photo[]) => setIds((current) => new Set([...current, ...photos.map((photo) => photo.id)])), []);
  return { ids, mark };
}

/** Keeps the screen on while `active`. The lock is best effort: the browser may refuse it. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      // Refused when the tab is hidden or the device is saving battery; the upload goes on without it.
      const acquired = await navigator.wakeLock.request("screen").catch(() => null);
      if (released) return void acquired?.release();
      sentinel = acquired;
    };
    // The browser drops the lock whenever the tab is hidden, so it is asked again on return.
    const reacquire = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", reacquire);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", reacquire);
      void sentinel?.release();
    };
  }, [active]);
}
