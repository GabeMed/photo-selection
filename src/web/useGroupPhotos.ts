import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Photo, PhotoFilter, PhotoPage } from "./api";
import { fetchThrough, mergePhotos } from "./photoList";

const EMPTY: PhotoPage = { photos: [], nextCursor: null };

export interface GroupPhotos {
  photos: Photo[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Reads again everything loaded: new photos appear, loaded ones update, deleted ones leave. */
  refresh: () => void;
  merge: (photos: Photo[]) => void;
  remove: (photoId: string) => void;
}

export function useGroupPhotos(groupId: string, filter: PhotoFilter): GroupPhotos {
  const [list, setList] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  // A page that answers after the filter changed belongs to a list no longer on screen.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  // Counts every local change of the list. A refresh that started before the latest one is
  // discarded: its snapshot would undo a tag, bring back a deleted photo or drop an uploaded one.
  const generationRef = useRef(0);

  const change = useCallback((next: (current: PhotoPage) => PhotoPage) => {
    generationRef.current += 1;
    setList(next);
  }, []);
  const merge = useCallback(
    (incoming: Photo[]) => change((current) => ({ ...current, photos: mergePhotos(current.photos, incoming) })),
    [change],
  );
  const remove = useCallback(
    (photoId: string) => change((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) })),
    [change],
  );

  const fetchPage = useCallback(
    (cursor: string | undefined, apply: (page: PhotoPage) => void) => {
      setLoading(true);
      api
        .listGroupPhotos(groupId, filter, cursor)
        .then((page) => {
          if (filterRef.current !== filter) return;
          apply(page);
          setError(null);
        }, setError)
        .finally(() => setLoading(false));
    },
    [groupId, filter],
  );

  useEffect(() => {
    change(() => EMPTY);
    fetchPage(undefined, (page) => change(() => page));
  }, [fetchPage, change]);

  const loadMore = () =>
    fetchPage(list.nextCursor!, (page) =>
      change((current) => ({ photos: mergePhotos(current.photos, page.photos), nextCursor: page.nextCursor })),
    );

  const refresh = useCallback(() => {
    // Counting the refresh itself makes the latest of two overlapping refreshes the one that applies.
    const generation = ++generationRef.current;
    fetchThrough((cursor) => api.listGroupPhotos(groupId, filter, cursor), listRef.current.photos.at(-1)).then((fresh) => {
      if (generationRef.current !== generation) return;
      setList(fresh);
      setError(null);
    }, setError);
  }, [groupId, filter]);

  return { photos: list.photos, loading, error, hasMore: list.nextCursor !== null, loadMore, refresh, merge, remove };
}
