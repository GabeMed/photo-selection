import { useRef, useState } from "react";
import * as api from "./api";
import type { Photo } from "./api";
import { createUploadQueue, sha256OfFile, type UploadQueue, type UploadQueueState } from "./uploadQueue";

export interface UploadQueueView extends UploadQueueState, UploadQueue {
  busy: boolean;
}

/** The queue lives outside React and outlives renders; this mirrors its state onto the screen. */
export function useUploadQueue(groupId: string, onUploaded: (photo: Photo | null) => void): UploadQueueView {
  const [state, setState] = useState<UploadQueueState>({ items: [], stopMessage: null });
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const [queue] = useState(() =>
    createUploadQueue({ api, hashFile: sha256OfFile, groupId, onChange: setState, onUploaded: (photo) => onUploadedRef.current(photo) }),
  );
  const busy = state.items.some((item) => item.status === "queued" || item.status === "uploading");
  return { ...state, ...queue, busy };
}
