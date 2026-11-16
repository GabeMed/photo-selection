import * as api from "../api";
import type { Photo, PhotoTag } from "../api";
import { Avatar, botaoPrincipalVariants, FotoTelaCheia, type FotoTelaCheiaItem } from "../design-system";
import { cn } from "../design-system/lib/utils";
import { formatBytes, formatDate } from "../format";
import { useAction } from "../hooks";
import type { PersonOf } from "../people";
import { useSession } from "../session";
import { viewerPhotos } from "../viewerPhotos";
import { STATUS_LABEL } from "./PhotoGrid";
import { ConfirmButton, ErrorText, SecondaryButton, TextButton } from "./ui";

function appearanceText(photo: Photo): string {
  if (photo.myTag === "me") return "Você marcou que tá nessa foto.";
  if (photo.myTag === "not_me") return "Você marcou que não tá nessa foto.";
  if (photo.mine) return "Achei você nessa foto!";
  return "Não achei você nessa foto.";
}

const NO_PREVIEW_TEXT: Record<Photo["status"], string> = {
  enviando: "Essa foto ainda tá subindo.",
  recebida: "O original já dá pra baixar.",
  processando: "O original já dá pra baixar.",
  processada: "",
  falhou: "Não deu pra montar a visualização dessa foto. O original dá pra baixar.",
};

const stageItem = (photo: Photo): FotoTelaCheiaItem => ({
  id: photo.id,
  src: photo.previewUrl ?? undefined,
  descricao: photo.previewUrl
    ? `Foto ${photo.filename}, enviada por ${photo.uploaderName}`
    : `${STATUS_LABEL[photo.status]}. ${NO_PREVIEW_TEXT[photo.status]}`,
});

const PRESSED = "bg-accent text-accent-foreground";

interface PhotoActionsProps {
  photo: Photo;
  /** The color of the uploader on this page. */
  personOf: PersonOf;
  onChanged: (photo: Photo) => void;
  onDeleted: (photoId: string) => void;
  /** The API answers a reprocess request without the photo: the owner of the list reads it again. */
  onReprocessed: () => void;
  /** The original link was followed: the API counts the photo as downloaded from the request on. */
  onDownloaded?: (photos: Photo[]) => void;
}

/** Everything that acts on the photo, kept below the stage so nothing is drawn over the image. */
function PhotoActions({ photo, personOf, onChanged, onDeleted, onReprocessed, onDownloaded }: PhotoActionsProps) {
  const { user } = useSession();
  const action = useAction();

  const tag = (value: PhotoTag | null) => action.run(async () => onChanged(await api.setPhotoTag(photo.id, value)));
  const remove = () =>
    action.run(async () => {
      await api.deletePhoto(photo.id);
      onDeleted(photo.id);
    });
  const reprocess = () =>
    action.run(async () => {
      await api.reprocessPhoto(photo.id);
      onReprocessed();
    });

  return (
    <div className="mx-auto flex w-full max-w-coluna flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-palco-foreground">
      <div className="flex items-center gap-2 text-sm">
        <Avatar pessoa={personOf({ id: photo.uploaderId, name: photo.uploaderName })} size="sm" />
        <p className="min-w-0">
          <span className="font-bold">{photo.uploaderName}</span> · {formatDate(photo.createdAt)} · {formatBytes(photo.sizeBytes)}
          <br />
          {appearanceText(photo)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Você nessa foto">
        <SecondaryButton aria-pressed={photo.myTag === "me"} className={cn(photo.myTag === "me" && PRESSED)} disabled={action.busy} onClick={() => void tag("me")}>
          Sou eu
        </SecondaryButton>
        <SecondaryButton
          aria-pressed={photo.myTag === "not_me"}
          className={cn(photo.myTag === "not_me" && PRESSED)}
          disabled={action.busy}
          onClick={() => void tag("not_me")}
        >
          Não sou eu
        </SecondaryButton>
        {photo.myTag !== null && (
          <TextButton disabled={action.busy} onClick={() => void tag(null)}>
            Desfazer
          </TextButton>
        )}
      </div>
      {(photo.canDelete || (user.isAdmin && photo.status === "falhou")) && (
        <div className="flex flex-wrap gap-2">
          {user.isAdmin && photo.status === "falhou" && (
            <SecondaryButton disabled={action.busy} onClick={() => void reprocess()}>
              Analisar de novo
            </SecondaryButton>
          )}
          {photo.canDelete && <ConfirmButton label="Apagar" confirmLabel="Apagar de vez" disabled={action.busy} onConfirm={() => void remove()} />}
        </div>
      )}
      <ErrorText message={action.error} />
      <a className={botaoPrincipalVariants()} href={photo.originalUrl} download={photo.filename} onClick={() => onDownloaded?.([photo])}>
        Baixar original
      </a>
    </div>
  );
}

interface PhotoViewerProps extends Omit<PhotoActionsProps, "photo"> {
  /** The photos to swipe through. */
  photos: Photo[];
  /**
   * The photo on screen. It may be missing from `photos` (a tag can take it out of a filtered list):
   * the page keeps it open on its own, so the tag can still be undone.
   */
  opened: Photo;
  onMove: (photo: Photo) => void;
  onClose: () => void;
}

export function PhotoViewer({ photos, opened, onMove, onClose, ...actions }: PhotoViewerProps) {
  const { shown, index } = viewerPhotos(photos, opened);
  return (
    <FotoTelaCheia fotos={shown.map(stageItem)} indiceInicial={index} onFechar={onClose} onMudar={(next) => shown[next] && onMove(shown[next])}>
      {/* Keyed by photo so an error or a pending confirmation never carries over to the next one. */}
      <PhotoActions key={opened.id} photo={shown[index]} {...actions} />
    </FotoTelaCheia>
  );
}
