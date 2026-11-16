import { useState } from "react";
import type { Photo } from "../api";
import { BotaoPrincipal } from "../design-system";
import { firstZipPart, sharesToPhotoLibrary } from "../download";
import { notDownloaded } from "../photoList";
import { ShareDialog } from "./ShareDialog";
import { SecondaryButton } from "./ui";
import { ZipButton } from "./ZipButton";

interface DownloadNewButtonProps {
  /** The photos of the current filter, all of one group. */
  photos: Photo[];
  /** More photos of the filter exist than are loaded: the count covers only the loaded ones. */
  hasMore: boolean;
  groupId: string;
  groupName: string;
  onDownloaded: (photos: Photo[]) => void;
}

/** Downloads what I have not downloaded yet: in share batches on iPhone, otherwise one ZIP part per tap. */
export function DownloadNewButton({ photos, hasMore, groupId, groupName, onDownloaded }: DownloadNewButtonProps) {
  // Taken when the dialog opens: the list shrinks as each photo arrives, the dialog's batches do not.
  const [sharing, setSharing] = useState<Photo[] | null>(null);
  return (
    <>
      <DownloadNewAction photos={photos} hasMore={hasMore} groupName={groupName} onShare={setSharing} onDownloaded={onDownloaded} />
      {/* Outside the action: delivering the last new photo empties it, and the dialog must stay to say so. */}
      {sharing && (
        <ShareDialog
          photos={sharing}
          groupNames={{ [groupId]: groupName }}
          onClose={() => setSharing(null)}
          onDelivered={(photo) => onDownloaded([photo])}
        />
      )}
    </>
  );
}

interface DownloadNewActionProps extends Omit<DownloadNewButtonProps, "groupId"> {
  onShare: (photos: Photo[]) => void;
}

function DownloadNewAction({ photos, hasMore, groupName, onShare, onDownloaded }: DownloadNewActionProps) {
  const fresh = notDownloaded(photos);
  if (fresh.length === 0) {
    // The pages not loaded yet may still hold new photos: say so instead of going silent.
    if (hasMore) return <p className="text-sm text-muted-foreground">Carrega mais fotos pra ver se ainda tem novas.</p>;
    return <SecondaryButton disabled>Você já baixou tudo</SecondaryButton>;
  }
  const label = `Baixar as novas (${fresh.length}${hasMore ? "+" : ""})`;
  if (sharesToPhotoLibrary()) {
    return (
      <BotaoPrincipal type="button" variant="suave" onClick={() => onShare(fresh)}>
        {label}
      </BotaoPrincipal>
    );
  }
  const part = firstZipPart(fresh);
  return <ZipButton photos={part} groupName={groupName} label={label} primary={false} onSaved={() => onDownloaded(part)} />;
}
