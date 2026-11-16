import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Photo } from "../api";
import { BarraAcaoFixa, BarraProgressoEnvio, BotaoPrincipal, EstadoFotos } from "../design-system";
import { isAppleTouchDevice } from "../download";
import { formatBytes, plural } from "../format";
import { useWakeLock } from "../hooks";
import { isWaitingForRetry, type UploadItem, type UploadStatus } from "../uploadQueue";
import { useUploadQueue, type UploadQueueView } from "../useUploadQueue";
import { FilePickButton, Notice, SecondaryButton } from "./ui";

const sentBytesOf = (item: UploadItem) =>
  item.status === "done" || item.status === "duplicate" ? item.file.size : item.status === "uploading" ? item.sentBytes : 0;

/** Failed files listed one by one; the rest are only counted. */
const FAILED_ROWS_SHOWN = 3;

/**
 * Only files in flight get a thumbnail, and the queue sends a few at a time: an `<img>` of an
 * original makes the browser decode the whole file, tens of megabytes each, to draw 48 pixels.
 */
function UploadingRow({ item }: { item: UploadItem }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(item.file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);
  if (!thumbnail) return null;
  return (
    <li>
      <BarraProgressoEnvio
        miniatura={thumbnail}
        nome={item.file.name}
        progresso={item.file.size > 0 ? (item.sentBytes / item.file.size) * 100 : 0}
        estado="enviando"
      />
    </li>
  );
}

function FailedRow({ item }: { item: UploadItem }) {
  return (
    <li className="flex flex-col gap-1">
      <BarraProgressoEnvio nome={item.file.name} progresso={0} estado="erro" />
      {item.message && <span className="px-2 text-sm font-semibold">{item.message}</span>}
    </li>
  );
}

function UploadRows({ items }: { items: UploadItem[] }) {
  const uploading = items.filter((item) => item.status === "uploading");
  const failed = items.filter((item) => item.status === "failed");
  const hiddenFailed = failed.length - FAILED_ROWS_SHOWN;
  return (
    <ul className="flex flex-col gap-3">
      {uploading.map((item) => (
        <UploadingRow key={item.key} item={item} />
      ))}
      {failed.slice(0, FAILED_ROWS_SHOWN).map((item) => (
        <FailedRow key={item.key} item={item} />
      ))}
      {hiddenFailed > 0 && <li className="px-2 text-sm font-semibold">e outras {hiddenFailed} que não subiram</li>}
    </ul>
  );
}

interface BatchCounts {
  total: number;
  done: number;
  duplicates: number;
  notSent: number;
}

/** "320 fotos subiram. 80 já estavam no grupo." */
function sentSummary(done: number, duplicates: number): string {
  if (duplicates === 0) return `${plural(done, "foto subiu", "fotos subiram")}. A galera vai amar.`;
  if (done === 0) return duplicates === 1 ? "A foto já estava no grupo." : `As ${duplicates} fotos já estavam no grupo.`;
  return `${plural(done, "foto subiu", "fotos subiram")}. ${plural(duplicates, "já estava no grupo", "já estavam no grupo")}.`;
}

function BatchStatus({ queue, counts }: { queue: UploadQueueView; counts: BatchCounts }) {
  const { total, done, duplicates, notSent } = counts;
  if (queue.stopMessage) {
    return (
      <EstadoFotos variant="erro" size="sm" titulo="O envio parou">
        {queue.stopMessage}{" "}
        {queue.busy
          ? "Terminando as fotos que já tavam subindo…"
          : `${plural(done, "foto subiu", "fotos subiram")} e ${plural(notSent, "não subiu", "não subiram")}.`}
        {!queue.busy && duplicates > 0 && ` ${plural(duplicates, "já estava no grupo", "já estavam no grupo")}.`}
      </EstadoFotos>
    );
  }
  if (queue.busy) {
    return <EstadoFotos variant="esperando" size="sm" titulo={`${done + duplicates} de ${plural(total, "foto enviada", "fotos enviadas")}`} />;
  }
  if (notSent > 0) {
    return (
      <EstadoFotos variant="erro" size="sm" titulo="Ih, deu ruim…">
        {plural(notSent, "foto não subiu", "fotos não subiram")}. As outras {done + duplicates} já tão no grupo.
      </EstadoFotos>
    );
  }
  return (
    <EstadoFotos variant="pronto" size="sm" titulo="Achei!">
      {sentSummary(done, duplicates)}
    </EstadoFotos>
  );
}

interface UploaderProps {
  groupId: string;
  /** False while another action owns the bar pinned to the bottom of the screen. */
  showAction: boolean;
  /** `null` when the photo arrived in an earlier attempt and the API did not describe it. */
  onUploaded: (photo: Photo | null) => void;
  /** Called when a batch stops having files in flight. */
  onSettled: () => void;
}

export function Uploader({ groupId, showAction, onUploaded, onSettled }: UploaderProps) {
  const queue = useUploadQueue(groupId, onUploaded);
  useWakeLock(queue.busy);

  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !queue.busy) onSettled();
    wasBusy.current = queue.busy;
  }, [queue.busy]);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    queue.add([...event.target.files!]);
    event.target.value = "";
  };

  const count = (status: UploadStatus) => queue.items.filter((item) => item.status === status).length;
  const counts = { total: queue.items.length, done: count("done"), duplicates: count("duplicate"), notSent: count("failed") + count("skipped") };
  const retryable = queue.items.filter(isWaitingForRetry).length;
  const totalBytes = queue.items.reduce((total, item) => total + item.file.size, 0);
  const sentBytes = queue.items.reduce((total, item) => total + sentBytesOf(item), 0);

  return (
    <section className="flex flex-col gap-3" aria-label="Enviar fotos">
      {isAppleTouchDevice() && (
        <Notice tone="info">
          <strong>No iPhone ou iPad:</strong> escolhe até <strong>80 fotos por vez</strong>; com mais que isso o iPhone trava ou entrega
          fotos quebradas. Enquanto um lote sobe, <strong>+ Mais fotos</strong> já aceita o próximo. No seletor, toca em{" "}
          <strong>Opções</strong> e escolhe o formato <strong>Atual</strong> pra mandar o original. Depois de tocar em Adicionar, o iPhone
          prepara as fotos sem mostrar nada: espera, pode levar alguns minutos. Deixa a tela ligada e essa aba aberta até o envio acabar.
          Pra muitas fotos de uma vez, usa o Atalho, logo abaixo.
        </Notice>
      )}

      {queue.items.length > 0 && (
        <>
          <BatchStatus queue={queue} counts={counts} />
          {/* Outside the status region: a byte count that changes all the time would be read aloud nonstop. */}
          <p className="text-sm text-muted-foreground">
            {formatBytes(sentBytes)} de {formatBytes(totalBytes)}
          </p>
          <UploadRows items={queue.items} />
          <div className="flex flex-wrap gap-2">
            {queue.busy && (
              <FilePickButton variant="suave" size="md" multiple accept="image/*" onChange={pick}>
                + Mais fotos
              </FilePickButton>
            )}
            {!queue.busy && retryable > 0 && (
              <SecondaryButton onClick={queue.retry}>
                {retryable === 1 ? "Tentar de novo a que não subiu" : `Tentar de novo as ${retryable} que não subiram`}
              </SecondaryButton>
            )}
            {!queue.busy && <SecondaryButton onClick={queue.clear}>Limpar lista</SecondaryButton>}
          </div>
        </>
      )}

      {showAction && (
        <BarraAcaoFixa>
          {queue.busy ? (
            <BotaoPrincipal type="button" carregando progresso={totalBytes > 0 ? (sentBytes / totalBytes) * 100 : 0}>
              Enviando…
            </BotaoPrincipal>
          ) : (
            <FilePickButton multiple accept="image/*" onChange={pick}>
              {queue.items.length > 0 ? "Subir mais fotos" : "Subir fotos"}
            </FilePickButton>
          )}
        </BarraAcaoFixa>
      )}
    </section>
  );
}
