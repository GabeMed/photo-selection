import { useState } from "react";
import type { Photo } from "../api";
import { BotaoPrincipal } from "../design-system";
import { saveZip, totalBytes, ZIP_WARNING_BYTES } from "../download";
import { formatBytes } from "../format";
import { useAction } from "../hooks";
import { ErrorText, Notice, SecondaryButton } from "./ui";

interface ZipButtonProps {
  /** Photos of a single group. */
  photos: Photo[];
  groupName: string;
  label: string;
  primary: boolean;
  onSaved?: () => void;
}

/** One ZIP per tap: the browser only lets a download start from the tap that asked for it. */
export function ZipButton({ photos, groupName, label, primary, onSaved }: ZipButtonProps) {
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const bytes = totalBytes(photos);

  const save = () => {
    setConfirming(false);
    void action.run(async () => {
      await saveZip(photos, groupName);
      onSaved?.();
    });
  };

  if (confirming) {
    return (
      <Notice tone="info">
        Esse ZIP tem {formatBytes(bytes)} e passa inteiro pela memória do navegador antes de salvar. Se o aparelho não aguentar, escolhe
        menos fotos e baixa em partes.
        <span className="mt-2 flex flex-wrap gap-2">
          <SecondaryButton onClick={save}>Baixar mesmo assim</SecondaryButton>
          <SecondaryButton onClick={() => setConfirming(false)}>Cancelar</SecondaryButton>
        </span>
      </Notice>
    );
  }
  return (
    <>
      <BotaoPrincipal
        type="button"
        variant={primary ? "destaque" : "suave"}
        size={primary ? "lg" : "md"}
        className="max-w-full"
        carregando={action.busy}
        onClick={bytes > ZIP_WARNING_BYTES ? () => setConfirming(true) : save}
      >
        <span className="min-w-0 truncate">{action.busy ? "Montando o ZIP…" : label}</span>
      </BotaoPrincipal>
      <ErrorText message={action.error} />
    </>
  );
}
