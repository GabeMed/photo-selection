import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import * as api from "../api";
import type { AdminGroup, AdminSettings, AdminUser } from "../api";
import { Card, ConfirmButton, CopyButton, ErrorNotice, ErrorText, Field, inviteUrl, Loading, Notice, PageHeader, SecondaryButton, UsageBar } from "../components/ui";
import { Avatar } from "../design-system";
import { bytesToGb, formatBytes, gbToBytes, plural } from "../format";
import { useAction, useLoad } from "../hooks";
import { toPessoa } from "../people";
import { useSession } from "../session";

const numberField = (form: FormData, name: string) => Number(form.get(name));

const LINK = "inline-flex min-h-11 items-center rounded-md underline outline-none focus-visible:ring-4 focus-visible:ring-ring";

function GbInput({ name, label, defaultBytes, required }: { name: string; label: string; defaultBytes?: number; required?: boolean }) {
  return (
    <Field
      label={label}
      name={name}
      type="number"
      inputMode="decimal"
      min="0.01"
      step="0.01"
      required={required}
      defaultValue={defaultBytes === undefined ? undefined : Number(bytesToGb(defaultBytes).toFixed(2))}
    />
  );
}

function CreateGroupForm({ onCreated }: { onCreated: () => void }) {
  const action = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const quota = String(form.get("quotaGb"));
    void action.run(async () => {
      await api.createGroup(String(form.get("name")), quota === "" ? undefined : gbToBytes(Number(quota)));
      formElement.reset();
      onCreated();
    });
  };
  return (
    <form onSubmit={submit}>
      <Card>
        <h2 className="text-xl font-semibold">Criar grupo</h2>
        <Field label="Nome do grupo" name="name" required maxLength={80} />
        <GbInput name="quotaGb" label="Limite em GB (em branco usa a cota padrão)" />
        <ErrorText message={action.error} />
        <SecondaryButton type="submit" variant="destaque" className="self-start" carregando={action.busy}>
          Criar grupo
        </SecondaryButton>
      </Card>
    </form>
  );
}

function GroupCard({ group, onChanged }: { group: AdminGroup; onChanged: () => void }) {
  const action = useAction();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quotaBytes = gbToBytes(numberField(new FormData(event.currentTarget), "quotaGb"));
    void action.run(async () => {
      await api.updateGroupQuota(group.id, quotaBytes);
      onChanged();
    });
  };
  return (
    <li>
      <Card>
        <h3 className="text-lg font-semibold">
          <Link to={`/g/${group.id}`} className={LINK}>
            {group.name}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {plural(group.memberCount, "pessoa", "pessoas")} · {plural(group.photoCount, "foto", "fotos")} · {group.counts.processing} em
          análise · {group.counts.failed} sem miniatura
        </p>
        <UsageBar usedBytes={group.usedBytes} quotaBytes={group.quotaBytes} />
        <form className="flex items-end gap-2" onSubmit={submit}>
          <GbInput name="quotaGb" label="Limite em GB" defaultBytes={group.quotaBytes} required />
          <SecondaryButton type="submit" className="h-12" carregando={action.busy}>
            Salvar limite
          </SecondaryButton>
        </form>
        <ErrorText message={action.error} />
        <p className="break-all text-sm text-muted-foreground">{inviteUrl(group.inviteToken)}</p>
        <div>
          <CopyButton text={inviteUrl(group.inviteToken)} label="Copiar link do convite" />
        </div>
      </Card>
    </li>
  );
}

function SettingsForm({ settings, onSaved }: { settings: AdminSettings; onSaved: () => void }) {
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    void action.run(async () => {
      await api.updateSettings({
        maxGroups: numberField(form, "maxGroups"),
        defaultGroupQuotaBytes: gbToBytes(numberField(form, "defaultGroupQuotaGb")),
        userMonthlyQuotaBytes: gbToBytes(numberField(form, "userMonthlyQuotaGb")),
        matchThreshold: numberField(form, "matchThreshold"),
      });
      setSaved(true);
      onSaved();
    });
  };
  return (
    <form onSubmit={submit}>
      <Card>
        <h2 className="text-xl font-semibold">Configurações</h2>
        <Field label="Máximo de grupos" name="maxGroups" type="number" inputMode="numeric" min="1" step="1" required defaultValue={settings.maxGroups} />
        <GbInput name="defaultGroupQuotaGb" label="Cota padrão de um grupo novo, em GB" defaultBytes={settings.defaultGroupQuotaBytes} required />
        <GbInput name="userMonthlyQuotaGb" label="Cota mensal de envio por pessoa, em GB" defaultBytes={settings.userMonthlyQuotaBytes} required />
        <Field
          label="Limiar de semelhança (maior exige mais certeza pra dizer que é a pessoa)"
          name="matchThreshold"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="1"
          step="0.01"
          required
          defaultValue={settings.matchThreshold}
        />
        <ErrorText message={action.error} />
        {saved && <Notice tone="success">Configurações salvas.</Notice>}
        <SecondaryButton type="submit" className="self-start" carregando={action.busy}>
          Salvar configurações
        </SecondaryButton>
      </Card>
    </form>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const action = useAction();
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const reset = () => action.run(async () => setTemporaryPassword(await api.resetPassword(user.id)));
  return (
    <li>
      <Card>
        <div className="flex items-center gap-3">
          <Avatar pessoa={toPessoa(user)} aria-hidden />
          <div className="min-w-0">
            <strong>{user.name}</strong>
            <p className="wrap-anywhere text-sm text-muted-foreground">
              {user.email} · {formatBytes(user.monthUsedBytes)} enviados neste mês
            </p>
          </div>
        </div>
        {temporaryPassword && (
          <Notice tone="success">
            Senha temporária: <code className="select-all break-all font-bold">{temporaryPassword}</code>. Ela aparece só agora: passa pra
            pessoa.
          </Notice>
        )}
        <ErrorText message={action.error} />
        <div>
          <ConfirmButton label="Redefinir senha" confirmLabel="Redefinir e encerrar as sessões" disabled={action.busy} onConfirm={() => void reset()} />
        </div>
      </Card>
    </li>
  );
}

export function AdminPage() {
  const { user } = useSession();
  const overview = useLoad(api.getAdminOverview, []);
  if (!user.isAdmin) return <Navigate to="/" replace />;
  // A failed reload keeps the page: unmounting it would lose a temporary password shown only once.
  if (!overview.data) return overview.error ? <ErrorNotice error={overview.error} /> : <Loading />;
  const { settings, totalUsedBytes, groups, users, faceService } = overview.data;

  return (
    <>
      <PageHeader title="Administração" backTo="/" />
      {overview.error && <ErrorNotice error={overview.error} />}
      <Notice tone={faceService.healthy ? "success" : "info"}>
        Serviço de rosto:{" "}
        {faceService.healthy
          ? "respondendo."
          : "sem resposta agora. As fotos ficam em análise e já dá pra baixar; a separação por rosto começa quando ele responder."}
      </Notice>

      <section className="flex flex-col gap-4" aria-labelledby="admin-groups">
        <h2 id="admin-groups" className="text-xl font-semibold">
          Grupos ({groups.length} de {settings.maxGroups}) · {formatBytes(totalUsedBytes)} no total
        </h2>
        <ul className="flex flex-col gap-4">
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} onChanged={overview.reload} />
          ))}
        </ul>
        <CreateGroupForm onCreated={overview.reload} />
      </section>

      <SettingsForm settings={settings} onSaved={overview.reload} />

      <section className="flex flex-col gap-4" aria-labelledby="admin-users">
        <h2 id="admin-users" className="text-xl font-semibold">
          Pessoas ({users.length})
        </h2>
        <ul className="flex flex-col gap-4">
          {users.map((listed) => (
            <UserRow key={listed.id} user={listed} />
          ))}
        </ul>
      </section>
    </>
  );
}
