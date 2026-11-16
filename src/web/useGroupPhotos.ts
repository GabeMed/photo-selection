import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Photo, PhotoListFilter, PhotoPage } from "./api";
import { fetchThrough, mergePhotos, withDownloaded } from "./photoList";

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
  /** Shows these photos as downloaded now, and keeps them so through every later read of the list. */
  markDownloaded: (photos: Photo[]) => void;
}

export function useGroupPhotos(groupId: string, listFilter: PhotoListFilter): GroupPhotos {
  const { filter, onlyNotDownloaded } = listFilter;
  const filterKey = `${filter} ${onlyNotDownloaded}`;
  const [list, setList] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  // A page that answers after the filter changed belongs to a list no longer on screen.
  const filterRef = useRef(filterKey);
  filterRef.current = filterKey;
  // A list read that started before a download may answer without it.
  const downloadedIdsRef = useRef(new Set<string>());
  // Counts every local change of the list. A refresh that started before the latest one is
  // discarded: its snapshot would undo a tag, bring back a deleted photo or drop an uploaded one.
  const generationRef = useRef(0);

  const change = useCallback((next: (current: PhotoPage) => PhotoPage) => {
    generationRef.current += 1;
    setList(next);
  }, []);
  const withKnownDownloads = (page: PhotoPage): PhotoPage => ({ ...page, photos: withDownloaded(page.photos, downloadedIdsRef.current) });
  const merge = useCallback(
    (incoming: Photo[]) => change((current) => ({ ...current, photos: mergePhotos(current.photos, incoming) })),
    [change],
  );
  const remove = useCallback(
    (photoId: string) => change((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== photoId) })),
    [change],
  );

  const markDownloaded = useCallback(
    (photos: Photo[]) => {
      for (const photo of photos) downloadedIdsRef.current.add(photo.id);
      change((current) => withKnownDownloads(current));
    },
    [change],
  );

  const fetchPage = useCallback(
    (cursor: string | undefined, apply: (page: PhotoPage) => void) => {
      setLoading(true);
      api
        .listGroupPhotos(groupId, { filter, onlyNotDownloaded }, cursor)
        .then((page) => {
          if (filterRef.current !== filterKey) return;
          apply(withKnownDownloads(page));
          setError(null);
        }, setError)
        .finally(() => setLoading(false));
    },
    [groupId, filter, onlyNotDownloaded, filterKey],
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
    fetchThrough((cursor) => api.listGroupPhotos(groupId, { filter, onlyNotDownloaded }, cursor), listRef.current.photos.at(-1)).then(
      (fresh) => {
        if (generationRef.current !== generation) return;
        setList(withKnownDownloads(fresh));
        setError(null);
      },
      setError,
    );
  }, [groupId, filter, onlyNotDownloaded]);

  return { photos: list.photos, loading, error, hasMore: list.nextCursor !== null, loadMore, refresh, merge, remove, markDownloaded };
}
