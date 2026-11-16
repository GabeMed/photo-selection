import * as api from "../api";
import { botaoPrincipalVariants } from "../design-system";
import { useAction, useLoad } from "../hooks";
import { Card, ConfirmButton, CopyButton, ErrorText } from "./ui";

const SHORTCUT_URL = "/atalho/Cade-as-Fotos.shortcut";

/** The iPhone way around the browser's photo picker: a Shortcut that sends each photo to the person's upload link. */
export function ShortcutUpload({ groupId }: { groupId: string }) {
  const link = useLoad(() => api.getUploadLink(groupId), [groupId]);
  const rotation = useAction();
  const rotate = () => rotation.run(async () => link.setData(await api.getUploadLink(groupId, true)));

  return (
    <Card>
      <h2 className="text-lg font-bold">Subir muitas fotos de uma vez (Atalho)</h2>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>Baixa o atalho e instala ele no app Atalhos.</li>
        <li>Copia o seu link de envio e cola quando o atalho pedir.</li>
        <li>Abre o atalho e escolhe as fotos: ele manda uma por uma pra esse grupo.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <a href={SHORTCUT_URL} className={botaoPrincipalVariants({ variant: "suave", size: "md" })}>
          Baixar o atalho
        </a>
        {link.data && <CopyButton text={link.data} label="Copiar link de envio" />}
      </div>
      <ErrorText message={link.error?.message ?? rotation.error} />
      <p className="text-sm text-muted-foreground">Quem tiver esse link consegue mandar fotos no seu nome. Vazou? Gera outro, e cola o novo no atalho: o antigo para de funcionar.</p>
      <ConfirmButton label="Gerar outro link" confirmLabel="Gerar e desativar o antigo" disabled={rotation.busy || !link.data} onConfirm={() => void rotate()} />
    </Card>
  );
}
