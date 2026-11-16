import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Photo } from "../api";
import { BarraAcaoFixa, BotaoPrincipal } from "../design-system";
import { SHARE_BATCH_MAX_BYTES, sharesToPhotoLibrary, splitByGroup, totalBytes } from "../download";
import { formatBytes, plural } from "../format";
import { ShareDialog } from "./ShareDialog";
import { TextButton } from "./ui";
import { ZipButton } from "./ZipButton";

interface SelectionBarProps {
  selected: Photo[];
  /** Names the ZIP of each group. */
  groupNames: Record<string, string>;
  onClear: () => void;
}

/** The element's height, kept current while it is on screen. */
function useHeight(ref: RefObject<HTMLElement | null>, shown: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown]);
  return height;
}

/** While photos are selected, downloading them is the screen's main action. */
export function SelectionBar({ selected, groupNames, onClear }: SelectionBarProps) {
  const [sharing, setSharing] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const barHeight = useHeight(bar, selected.length > 0);
  if (selected.length === 0) return null;
  const sharePrimary = sharesToPhotoLibrary();
  const bytes = totalBytes(selected);
  const byGroup = splitByGroup(selected);
  // Where the share sheet delivers in small batches, a large ZIP held in memory is the worse way out.
  const zipOffered = !sharePrimary || bytes <= SHARE_BATCH_MAX_BYTES;
  const zipLabel = (ofGroup: Photo[]) => {
    if (byGroup.length > 1) return `ZIP de ${groupNames[ofGroup[0].groupId]}`;
    return sharePrimary ? "Baixar em ZIP" : "Baixar selecionadas";
  };

  return (
    <>
      {/* The bar is taller than the room the page keeps at its bottom: this keeps the last photos reachable above it. */}
      <div aria-hidden style={{ height: barHeight }} />
      <BarraAcaoFixa ref={bar} role="region" aria-label="Fotos selecionadas" className="pt-4">
        <div className="flex flex-col gap-2 rounded-xl border-grosso border-tinta bg-card p-2 text-card-foreground shadow-pop">
          <div className="flex items-center justify-between gap-2 pl-2">
            <span className="text-sm font-bold">
              {plural(selected.length, "selecionada", "selecionadas")} · {formatBytes(bytes)}
            </span>
            <TextButton onClick={onClear}>Limpar</TextButton>
          </div>
          {sharePrimary && (
            <BotaoPrincipal type="button" onClick={() => setSharing(true)}>
              Baixar selecionadas
            </BotaoPrincipal>
          )}
          {zipOffered &&
            byGroup.map((ofGroup) => (
              <ZipButton
                key={ofGroup[0].groupId}
                photos={ofGroup}
                groupName={groupNames[ofGroup[0].groupId]}
                label={zipLabel(ofGroup)}
                primary={!sharePrimary}
              />
            ))}
          {!zipOffered && (
            <span className="text-sm text-muted-foreground">
              Acima de {formatBytes(SHARE_BATCH_MAX_BYTES)} não tem ZIP nesse aparelho: ele passaria inteiro pela memória. “Baixar
              selecionadas” entrega em lotes.
            </span>
          )}
        </div>
        {sharing && <ShareDialog photos={selected} groupNames={groupNames} onClose={() => setSharing(false)} />}
      </BarraAcaoFixa>
    </>
  );
}
