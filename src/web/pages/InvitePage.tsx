import { Link, useNavigate, useParams } from "react-router-dom";
import * as api from "../api";
import { ApiError } from "../api";
import { ErrorNotice, ErrorText, Loading, SecondaryButton } from "../components/ui";
import { BarraAcaoFixa, BotaoPrincipal, botaoPrincipalVariants, CartaoConvite, EstadoFotos, Mascote } from "../design-system";
import { useAction, useLoad } from "../hooks";

export function InvitePage() {
  const token = useParams().token!;
  const navigate = useNavigate();
  const invite = useLoad(() => api.getInvite(token), [token]);
  const action = useAction();

  if (invite.error instanceof ApiError && invite.error.code === "not_found") {
    return (
      <EstadoFotos variant="erro" titulo="Ih, esse convite sumiu…">
        Ele não existe ou deixou de valer. Pede o link de novo pra quem te chamou.
      </EstadoFotos>
    );
  }
  if (invite.error) {
    return (
      <>
        <ErrorNotice error={invite.error} />
        <SecondaryButton className="self-start" onClick={invite.reload}>
          Tentar de novo
        </SecondaryButton>
      </>
    );
  }
  if (!invite.data) return <Loading />;
  const { group, alreadyMember } = invite.data;
  const join = () =>
    action.run(async () => {
      await api.joinInvite(token);
      navigate(`/g/${group.id}`);
    });

  return (
    <>
      <div className="flex items-center justify-center gap-4">
        <Mascote pose="curioso" size="sm" />
        <p className="font-display text-base font-semibold">Ó o convite ✈️</p>
      </div>
      <CartaoConvite titulo={group.name} totalPessoas={group.memberCount}>
        <p className="font-semibold">{alreadyMember ? "Você já tá dentro!" : "Entra e sobe as fotos que você tirou."}</p>
      </CartaoConvite>
      <ErrorText message={action.error} />
      <BarraAcaoFixa>
        {alreadyMember ? (
          <Link className={botaoPrincipalVariants()} to={`/g/${group.id}`}>
            Abrir o grupo
          </Link>
        ) : (
          <BotaoPrincipal type="button" carregando={action.busy} onClick={() => void join()}>
            Entrar no grupo
          </BotaoPrincipal>
        )}
      </BarraAcaoFixa>
    </>
  );
}
