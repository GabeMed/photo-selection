import type { Photo, PhotoStatus } from "../api";
import { CartaoFoto, Mascote } from "../design-system";
import { cn } from "../design-system/lib/utils";
import { toPessoa } from "../people";

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
  selected: boolean;
  onToggle: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
}

function PhotoTile({ photo, selected, onToggle, onOpen }: PhotoTileProps) {
  return (
    <li className="relative">
      <CartaoFoto
        src={photo.thumbUrl ?? undefined}
        largura={photo.width ?? 1}
        altura={photo.height ?? 1}
        autor={toPessoa({ id: photo.uploaderId, name: photo.uploaderName })}
        descricao={photo.filename}
        className={cn(!photo.thumbUrl && "border-grosso border-dashed border-tinta bg-muted", selected && "ring-4 ring-primary")}
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
    </li>
  );
}

interface PhotoGridProps {
  photos: Photo[];
  selectedIds: ReadonlySet<string>;
  onToggle: (photo: Photo) => void;
  onOpen: (photo: Photo) => void;
}

export function PhotoGrid({ photos, selectedIds, onToggle, onOpen }: PhotoGridProps) {
  return (
    <div className="grid grid-cols-2 items-start gap-3">
      {splitIntoColumns(photos).map((column, index) => (
        <ul key={index} className="flex flex-col gap-3">
          {column.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} selected={selectedIds.has(photo.id)} onToggle={onToggle} onOpen={onOpen} />
          ))}
        </ul>
      ))}
    </div>
  );
}
