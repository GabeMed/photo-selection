import { useState } from "react";
import * as api from "../api";
import { botaoPrincipalVariants } from "../design-system";
import { useAction, useLoad } from "../hooks";
import { ConfirmButton, CopyButton, ErrorText } from "./ui";

const SHORTCUT_URL = "/atalho/Cade-as-Fotos.shortcut";

/**
 * The iPhone way around the browser's photo picker: a Shortcut that sends each photo to the person's upload link.
 * Closed by default; the link is only asked for once it is opened.
 */
export function ShortcutUpload({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="rounded-lg text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer rounded-md px-2 py-2 font-bold underline outline-none focus-visible:ring-4 focus-visible:ring-ring">
        Muitas fotos de uma vez? Usa o Atalho
      </summary>
      {open && <ShortcutTutorial groupId={groupId} />}
    </details>
  );
}

function ShortcutTutorial({ groupId }: { groupId: string }) {
  const link = useLoad(() => api.getUploadLink(groupId), [groupId]);
  const rotation = useAction();
  const rotate = () => rotation.run(async () => link.setData(await api.getUploadLink(groupId, true)));

  return (
    <div className="flex flex-col gap-3 px-2 pt-2">
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        <li className="flex flex-col items-start gap-2">
          <span>Baixa o atalho e toca no arquivo baixado pra abrir no app Atalhos.</span>
          <a href={SHORTCUT_URL} className={botaoPrincipalVariants({ variant: "suave", size: "md" })}>
            Baixar o atalho
          </a>
        </li>
        <li className="flex flex-col items-start gap-2">
          <span>
            Copia o seu link de envio e cola quando o atalho pedir. Se ele não pedir: no app Atalhos, toca nos três pontinhos do
            "Cade-as-Fotos" e, na primeira caixa "Texto", troca <code className="break-all">COLE_AQUI_O_LINK_DE_ENVIO</code> pelo link.
          </span>
          {link.data && <CopyButton text={link.data} label="Copiar link de envio" />}
        </li>
        <li>
          Libera o envio de muitas fotos: Ajustes &gt; Apps &gt; Atalhos &gt; Avançado &gt; "Permitir Compartilhamento de Grandes
          Quantidades de Dados".
        </li>
        <li>
          Abre o atalho, escolhe as fotos e, quando o iPhone perguntar, toca em "Permitir Sempre". Espera a notificação "Envio
          terminado".
        </li>
      </ol>
      <ErrorText message={link.error?.message ?? rotation.error} />
      <p className="text-muted-foreground">
        Esse link é uma chave só de envio: quem tiver o link consegue mandar fotos no seu nome. Vazou? Gera outro e cola o novo no atalho: o
        antigo para de funcionar.
      </p>
      <ConfirmButton label="Gerar outro link" confirmLabel="Gerar e desativar o antigo" disabled={rotation.busy || !link.data} onConfirm={() => void rotate()} />
    </div>
  );
}
