import { useEffect, useState } from "react";
import * as api from "../api";
import type { Photo } from "../api";
import { BotaoPrincipal, EstadoFotos } from "../design-system";
import { fetchOriginalFile, shareBatches } from "../download";
import { plural } from "../format";
import { Modal, Notice } from "./ui";
import { ZipButton } from "./ZipButton";

interface ShareDialogProps {
  photos: Photo[];
  groupNames: Record<string, string>;
  onClose: () => void;
  /** Each photo the share sheet took, or that left in a ZIP: it counts as downloaded from then on. */
  onDelivered?: (photo: Photo) => void;
}

/**
 * Downloads the originals batch by batch and hands each batch to the system share sheet.
 * Sharing needs a tap of its own: the browser refuses it after the wait for the download.
 */
export function ShareDialog({ photos, groupNames, onClose, onDelivered }: ShareDialogProps) {
  const [batches] = useState(() => shareBatches(photos));
  const [batchIndex, setBatchIndex] = useState(0);
  // Files are kept with the batch they belong to, so a new batch never starts out looking ready.
  const [prepared, setPrepared] = useState<{ batchIndex: number; files: File[] }>({ batchIndex: 0, files: [] });
  const [error, setError] = useState<Error | null>(null);
  // Bumped by "Tentar de novo": the current batch is downloaded again, the earlier ones stay delivered.
  const [attempt, setAttempt] = useState(0);
  const batch = batches[batchIndex] as Photo[] | undefined;
  const files = prepared.batchIndex === batchIndex ? prepared.files : [];
  const ready = batch !== undefined && files.length === batch.length;
  // Asked with the real files: a device can share files in general and still refuse these.
  const shareRefused = ready && !navigator.canShare({ files });

  useEffect(() => {
    if (!batch) return;
    let current = true;
    const prepare = async () => {
      const fetched: File[] = [];
      setPrepared({ batchIndex, files: [] });
      for (const photo of batch) {
        fetched.push(await fetchOriginalFile(photo));
        if (!current) return;
        setPrepared({ batchIndex, files: [...fetched] });
      }
    };
    prepare().catch((failure: Error) => current && setError(failure));
    return () => {
      current = false;
    };
  }, [batch, batchIndex, attempt]);

  const nextBatch = () => {
    setError(null);
    setBatchIndex(batchIndex + 1);
  };
  const retryDownload = () => {
    setError(null);
    setAttempt(attempt + 1);
  };
  const share = async () => {
    setError(null);
    try {
      await navigator.share({ files });
    } catch (failure) {
      // The person closed the share sheet; the batch stays ready for another tap.
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      return setError(new Error("O aparelho não conseguiu abrir o compartilhamento desse lote. Tenta de novo."));
    }
    void delivered(batch!, true);
  };
  /** The share sheet took the batch (or the ZIP was saved, which the API already recorded). */
  const delivered = async (photosOfBatch: Photo[], report: boolean) => {
    nextBatch();
    // A history that fails to save must not stop the next batch: these photos only show as new again.
    if (report) await api.recordDownloads(photosOfBatch.map((photo) => photo.id)).catch(() => undefined);
    photosOfBatch.forEach((photo) => onDelivered?.(photo));
  };

  return (
    <Modal title="Salvar fotos" onClose={onClose}>
      {!batch && (
        <EstadoFotos variant="pronto" size="sm" titulo="Achei!">
          {plural(photos.length, "foto entregue", "fotos entregues")}.
        </EstadoFotos>
      )}
      {batch && (
        <>
          <p>
            Lote {batchIndex + 1} de {batches.length}. Na folha que abrir, toca em <strong>Salvar imagens</strong> pra guardar os
            originais na Fototeca.
          </p>
          <p className="text-sm text-muted-foreground" role="status">
            {ready ? "Lote pronto." : error ? "O download desse lote parou." : `Baixando ${files.length + 1} de ${batch.length}…`}
          </p>
          {error && <Notice tone="error">{error.message}</Notice>}
          {error && !ready && (
            <BotaoPrincipal type="button" onClick={retryDownload}>
              Tentar de novo
            </BotaoPrincipal>
          )}
          {shareRefused && (
            <>
              <Notice tone="info">Esse aparelho não aceita compartilhar esse lote. Baixa ele em ZIP.</Notice>
              <ZipButton
                photos={batch}
                groupName={groupNames[batch[0].groupId]}
                label={`Baixar ${plural(batch.length, "foto", "fotos")} em ZIP`}
                primary
                onSaved={() => void delivered(batch, false)}
              />
            </>
          )}
          {!shareRefused && !(error && !ready) && (
            <BotaoPrincipal type="button" disabled={!ready} onClick={() => void share()}>
              {error ? "Tentar de novo" : `Salvar ${plural(batch.length, "foto", "fotos")}`}
            </BotaoPrincipal>
          )}
        </>
      )}
    </Modal>
  );
}
