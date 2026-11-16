import { Download, Loader2 } from "lucide-react";
import type { Photo, PhotoStatus } from "../api";
import { CartaoFoto, Mascote } from "../design-system";
import { cn } from "../design-system/lib/utils";
import { downloadCorner, saveOriginal } from "../download";
import { useAction } from "../hooks";
import type { PersonOf } from "../people";
import { DownloadedSeal, ErrorText } from "./ui";

/** What a tile says while the photo has no thumbnail. */
export const STATUS_LABEL: Record<PhotoStatus, string> = {
  enviando: "Enviando",
  recebida: "Em análise",
  processando: "Em análise",
  processada: "Pronta",
  falhou: "Sem miniatura",
};

/** Height over width; a photo not analyzed yet has no measures and takes a square. */
const heightRatio = (photo: Photo) => (photo.width && photo.height ? photo.height / photo.width : 1);

/** Two columns, each photo going to the shorter one, so no photo is cropped to fit a row. */
function splitIntoColumns(photos: Photo[]): Photo[][] {
  const columns: Photo[][] = [[], []];
  const heights = [0, 0];
  for (const photo of photos) {
    const shorter = heights[0] <= heights[1] ? 0 : 1;
    columns[shorter].push(photo);
    heights[shorter] += heightRatio(photo);
  }
  return columns;
}

interface PhotoTileProps {
  photo: Photo;
  personOf: PersonOf;
  selected: boolean;
  onToggle: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
  /** The original was saved: the photo shows as downloaded from then on. */
  onDownloaded: (photos: Photo[]) => void;
}

interface QuickDownloadButtonProps {
  photo: Photo;
  busy: boolean;
  onClick: () => void;
}

/** Drawn smaller than its 44px target, so it stays a corner of the photo. */
function QuickDownloadButton({ photo, busy, onClick }: QuickDownloadButtonProps) {
  return (
    <button
      type="button"
      aria-label={busy ? `Baixando ${photo.filename}` : `Baixar ${photo.filename}`}
      title="Baixar"
      disabled={busy}
      aria-busy={busy || undefined}
      className="group/baixar pointer-events-auto grid size-11 place-items-center rounded-pill outline-none focus-visible:ring-4 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="grid size-8 place-items-center rounded-pill border-grosso border-tinta bg-card text-tinta shadow-pop-sm group-active/baixar:translate-x-0.5 group-active/baixar:translate-y-0.5 group-active/baixar:shadow-none">
        {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="size-4" strokeWidth={2.5} aria-hidden />}
      </span>
    </button>
  );
}

function PhotoTile({ photo, personOf, selected, onToggle, onOpen, onDownloaded }: PhotoTileProps) {
  const download = useAction();
  const corner = downloadCorner(photo);
  return (
    <li className="flex flex-col gap-2">
      <div className="relative">
        {/* At least tall enough for the top and bottom corner controls never to overlap; a wider photo is cropped to fit. */}
        <CartaoFoto
          src={photo.thumbUrl ?? undefined}
          largura={photo.width ?? 1}
          altura={photo.height ?? 1}
          autor={personOf({ id: photo.uploaderId, name: photo.uploaderName })}
          descricao={photo.filename}
          className={cn("min-h-24", !photo.thumbUrl && "border-grosso border-dashed border-tinta bg-muted", selected && "ring-4 ring-primary")}
          onClick={() => onOpen(photo)}
        >
          <span className="flex size-full flex-col items-center justify-center gap-1 px-2 pb-8 text-center">
            <Mascote pose={photo.status === "falhou" ? "triste" : "esperando"} size="xs" />
            <span className="font-display text-sm font-semibold">{STATUS_LABEL[photo.status]}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{photo.filename}</span>
          </span>
        </CartaoFoto>
        <label className="absolute right-0 top-0 grid size-11 place-items-center">
          <input
            type="checkbox"
            className="size-6 rounded-sm accent-primary outline-none focus-visible:ring-4 focus-visible:ring-ring"
            checked={selected}
            onChange={() => onToggle(photo)}
            aria-label={`Selecionar ${photo.filename}`}
          />
        </label>
        {photo.mine && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-pill border-grosso border-tinta bg-accent px-2 py-0.5 font-display text-xs font-semibold text-accent-foreground">
            Você
          </span>
        )}
        <span className="pointer-events-none absolute bottom-0 right-0 grid size-11 place-items-center">
          {corner === "seal" && <DownloadedSeal />}
          {corner === "button" && (
            <QuickDownloadButton photo={photo} busy={download.busy} onClick={() => void download.run(() => saveOriginal(photo, onDownloaded))} />
          )}
        </span>
      </div>
      <ErrorText message={download.error} />
    </li>
  );
}

interface PhotoGridProps {
  photos: Photo[];
  /** The color of each uploader on this page. */
  personOf: PersonOf;
  selectedIds: ReadonlySet<string>;
  onToggle: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
  onDownloaded: (photos: Photo[]) => void;
}

export function PhotoGrid({ photos, personOf, selectedIds, onToggle, onOpen, onDownloaded }: PhotoGridProps) {
  return (
    <div className="grid grid-cols-2 items-start gap-3">
      {splitIntoColumns(photos).map((column, index) => (
        <ul key={index} className="flex flex-col gap-3">
          {column.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} personOf={personOf} selected={selectedIds.has(photo.id)} onToggle={onToggle} onOpen={onOpen} onDownloaded={onDownloaded} />
          ))}
        </ul>
      ))}
    </div>
  );
}
