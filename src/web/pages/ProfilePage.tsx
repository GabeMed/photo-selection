import { useState, type ChangeEvent, type FormEvent } from "react";
import * as api from "../api";
import { ConfirmButton, ErrorText, Field, FilePickButton, Notice, SecondaryButton } from "../components/ui";
import { Avatar, BarraAcaoFixa, EstadoFotos } from "../design-system";
import { useAction } from "../hooks";
import { userAsPessoa, useSession } from "../session";

const MAX_SELFIES = 5;

const SELFIE_MESSAGES: Record<string, string> = {
  multiple_faces: "A selfie precisa ter só você. Manda uma foto em que apareça só o seu rosto.",
  face_service_unavailable: "A análise de rostos tá acordando. Tenta de novo daqui a um minuto.",
};

function NameForm() {
  const { user, setUser } = useSession();
  const action = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    void action.run(async () => setUser(await api.updateName(name)));
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-labelledby="name">
      <h2 id="name" className="text-xl font-semibold">
        Seu nome
      </h2>
      <Field label="Nome" name="name" defaultValue={user.name} autoComplete="name" required maxLength={80} />
      <ErrorText message={action.error} />
      <SecondaryButton type="submit" className="self-start" carregando={action.busy}>
        Salvar nome
      </SecondaryButton>
    </form>
  );
}

function PasswordForm() {
  const { user, setUser } = useSession();
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = user.hasPassword ? String(form.get("currentPassword")) : undefined;
    setSaved(false);
    void action.run(async () => {
      await api.changePassword(String(form.get("newPassword")), currentPassword);
      formElement.reset();
      setUser({ ...user, hasPassword: true });
      setSaved(true);
    });
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit} aria-labelledby="password">
      <h2 id="password" className="text-xl font-semibold">
        {user.hasPassword ? "Trocar a senha" : "Criar uma senha"}
      </h2>
      {!user.hasPassword && (
        <p className="text-sm text-muted-foreground">Sua conta entra só pelo Google. Com uma senha, você também entra com e-mail e senha.</p>
      )}
      {user.hasPassword && <Field label="Senha atual" name="currentPassword" type="password" autoComplete="current-password" required />}
      <Field
        label="Nova senha"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={200}
        hint="Pelo menos 8 caracteres."
      />
      <ErrorText message={action.error} />
      {saved && <Notice tone="success">Senha salva. Os outros aparelhos em que você tava saíram da conta.</Notice>}
      <SecondaryButton type="submit" className="self-start" carregando={action.busy}>
        Salvar senha
      </SecondaryButton>
    </form>
  );
}

function Selfies() {
  const { user, setUser } = useSession();
  const action = useAction();

  const add = (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files![0];
    event.target.value = "";
    void action.run(async () => {
      const selfie = await api.addSelfie(image);
      setUser({ ...user, selfies: [...user.selfies, selfie] });
    }, SELFIE_MESSAGES);
  };
  const remove = (selfieId: string) =>
    action.run(async () => {
      await api.removeSelfie(selfieId);
      setUser({ ...user, selfies: user.selfies.filter((selfie) => selfie.id !== selfieId) });
    });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="selfies">
      <h2 id="selfies" className="text-xl font-semibold">
        Suas selfies ({user.selfies.length} de {MAX_SELFIES})
      </h2>
      <p>
        A gente compara as fotos do grupo com as suas selfies pra achar você. Manda foto só do seu rosto,{" "}
        <strong>sem óculos escuros nem boné</strong>. Duas ou três selfies diferentes ajudam.
      </p>
      {user.selfies.length === 0 && <EstadoFotos titulo="Cadê a sua selfie? 👀" size="sm" />}
      <ul className="grid grid-cols-3 items-start gap-3">
        {user.selfies.map((selfie, index) => (
          <li key={selfie.id} className="flex flex-col items-center gap-2">
            <img className="w-full rounded-lg border-grosso border-tinta" src={selfie.url} alt={`Selfie ${index + 1}`} />
            <ConfirmButton label="Remover" confirmLabel="Remover" disabled={action.busy} onConfirm={() => void remove(selfie.id)} />
          </li>
        ))}
      </ul>
      {action.busy && (
        <EstadoFotos variant="esperando" size="sm" titulo="Analisando…">
          A primeira análise pode levar até um minuto, porque o serviço precisa acordar.
        </EstadoFotos>
      )}
      <ErrorText message={action.error} />
      {user.selfies.length < MAX_SELFIES && (
        <>
          <div>
            <FilePickButton variant="suave" size="md" accept="image/*" disabled={action.busy} onChange={add}>
              Escolher da galeria
            </FilePickButton>
          </div>
          <BarraAcaoFixa>
            <FilePickButton accept="image/*" capture="user" disabled={action.busy} onChange={add}>
              Tirar selfie
            </FilePickButton>
          </BarraAcaoFixa>
        </>
      )}
    </section>
  );
}

export function ProfilePage() {
  const { user } = useSession();
  return (
    <>
      <header className="flex flex-col items-center gap-2 py-4 text-center">
        <Avatar pessoa={userAsPessoa(user)} size="lg" />
        <h1 className="text-3xl font-bold">Oi, {user.name}!</h1>
        <p className="text-muted-foreground">{user.email}</p>
      </header>
      <Selfies />
      <NameForm />
      <PasswordForm />
    </>
  );
}
