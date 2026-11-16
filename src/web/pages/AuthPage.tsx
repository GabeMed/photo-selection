import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../api";
import { ApiError, type SignupRequest } from "../api";
import { ErrorText, Field, Notice, TextButton } from "../components/ui";
import { BarraAcaoFixa, BotaoPrincipal, botaoPrincipalVariants, Logo, Mascote, TelaCelular } from "../design-system";
import { safeNextPath } from "../format";
import { useAction, useLoad } from "../hooks";

const COPY = {
  login: { title: "Bora entrar?", submit: "Entrar", other: "Ainda não tem conta?", otherLink: "Criar conta", otherPath: "/cadastrar" },
  signup: { title: "Bora criar sua conta?", submit: "Criar conta", other: "Já tem conta?", otherLink: "Entrar", otherPath: "/entrar" },
} as const;

const FORM_ID = "auth-form";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const config = useLoad(api.getAuthConfig, []);
  const action = useAction();
  const [setupCodeShown, setSetupCodeShown] = useState(false);
  const next = safeNextPath(params.get("next"), window.location.origin);
  const copy = COPY[mode];

  // The admin e-mail asks for the installation code: the refusal shows the field that takes it.
  const signup = (request: SignupRequest) =>
    api.signup(request).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "setup_code_required") setSetupCodeShown(true);
      throw error;
    });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    void action.run(async () => {
      if (mode === "login") await api.login(field("email"), field("password"));
      else await signup({ email: field("email"), password: field("password"), name: field("name"), setupCode: field("setupCode") || undefined });
      navigate(next, { replace: true });
    });
  };

  return (
    <TelaCelular>
      <main className="flex flex-col gap-4 pt-6">
        <div className="flex items-center justify-between gap-4">
          <Logo size="md" />
          <Mascote pose="curioso" size="sm" />
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">{copy.title}</h1>
          <p className="mt-1">As fotos da viagem num lugar só. Sem ninguém esquecer de mandar 👀</p>
        </div>
        {params.get("erro") === "google" && <Notice tone="error">Não deu pra entrar com o Google. Tenta de novo.</Notice>}
        <form id={FORM_ID} className="flex flex-col gap-3" onSubmit={submit}>
          {mode === "signup" && <Field label="Nome" name="name" autoComplete="name" required maxLength={80} />}
          <Field label="E-mail" name="email" type="email" autoComplete="email" required maxLength={254} />
          <Field
            label="Senha"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            hint={mode === "signup" ? "Pelo menos 8 caracteres." : undefined}
          />
          {mode === "signup" && setupCodeShown && <Field label="Código de instalação" name="setupCode" autoComplete="off" />}
          <ErrorText message={action.error} />
        </form>
        {config.data?.googleEnabled && (
          <a className={botaoPrincipalVariants({ variant: "suave" })} href={api.googleStartUrl(next)}>
            Entrar com Google
          </a>
        )}
        <p>
          {copy.other}{" "}
          <Link
            className="inline-flex min-h-11 items-center rounded-md font-bold underline outline-none focus-visible:ring-4 focus-visible:ring-ring"
            to={`${copy.otherPath}?next=${encodeURIComponent(next)}`}
          >
            {copy.otherLink}
          </Link>
        </p>
        {mode === "signup" && !setupCodeShown && (
          <TextButton className="self-start px-0 text-muted-foreground" onClick={() => setSetupCodeShown(true)}>
            Sou o administrador do site
          </TextButton>
        )}
      </main>
      <BarraAcaoFixa>
        <BotaoPrincipal type="submit" form={FORM_ID} carregando={action.busy}>
          {copy.submit}
        </BotaoPrincipal>
      </BarraAcaoFixa>
    </TelaCelular>
  );
}
