import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as api from "../api";
import type { GroupDetail, Photo, PhotoFilter } from "../api";
import { PhotoGrid } from "../components/PhotoGrid";
import { PhotoViewer } from "../components/PhotoViewer";
import { SelectionBar } from "../components/SelectionBar";
import { ShortcutUpload } from "../components/ShortcutUpload";
import { Chip, CopyButton, ErrorNotice, inviteUrl, Loading, PageHeader, SecondaryButton, UsageBar } from "../components/ui";
import { Uploader } from "../components/Uploader";
import { Avatar, EstadoFotos, PilhaAvatares, type Pessoa } from "../design-system";
import { isAppleTouchDevice } from "../download";
import { plural } from "../format";
import { useLoad, useSelection } from "../hooks";
import { groupPersonOf, type PersonOf } from "../people";
import { useSession } from "../session";
import { useGroupPhotos } from "../useGroupPhotos";

const POLL_INTERVAL_MS = 15_000;

const isAwaitingAnalysis = (photo: Photo) => photo.status === "recebida" || photo.status === "processando";

interface FilterBarProps {
  group: GroupDetail;
  personOf: PersonOf;
  filter: PhotoFilter;
  onChange: (filter: PhotoFilter) => void;
}

function FilterBar({ group, personOf, filter, onChange }: FilterBarProps) {
  const { user } = useSession();
  const options: { value: PhotoFilter; label: string; person?: Pessoa }[] = [
    { value: "all", label: "Todas" },
    { value: "mine", label: "Minhas" },
    ...group.members
      .filter((member) => member.id !== user.id)
      .map((member) => ({ value: `user:${member.id}` as const, label: member.name, person: personOf(member) })),
  ];
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Filtrar fotos">
      {options.map((option) => (
        <Chip key={option.value} pressed={filter === option.value} className={option.person && "pl-1"} onClick={() => onChange(option.value)}>
          {option.person && <Avatar pessoa={option.person} size="sm" aria-hidden />}
          {option.label}
        </Chip>
      ))}
    </div>
  );
}

function GroupView({ groupId }: { groupId: string }) {
  const group = useLoad(() => api.getGroup(groupId), [groupId]);
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const list = useGroupPhotos(groupId, filter);
  const selection = useSelection();
  // The photo itself, not its id: it stays on screen after a tag and a refresh take it out of the list.
  const [openedPhoto, setOpened] = useState<Photo | null>(null);

  // While photos wait for analysis, thumbnails show up on their own. An uploaded photo is in the list
  // as pending right away, so this starts with the first photo of a batch instead of after the last.
  // A failed read is tried again the same way, which also takes its error off the page.
  const pending =
    (group.data?.counts.processing ?? 0) > 0 || list.photos.some(isAwaitingAnalysis) || (group.data !== undefined && group.error !== undefined);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      group.reload();
      list.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, group.reload, list.refresh]);

  // A failed reload keeps the page: unmounting it would take the uploader away in the middle of a batch.
  if (!group.data) return group.error ? <ErrorNotice error={group.error} /> : <Loading />;
  const { name, members, counts, usedBytes, quotaBytes, inviteToken } = group.data;
  const personOf = groupPersonOf(members);
  const opened = openedPhoto && (list.photos.find((photo) => photo.id === openedPhoto.id) ?? openedPhoto);

  const changeFilter = (next: PhotoFilter) => {
    selection.clear();
    setFilter(next);
  };
  // A photo just sent belongs in "Todas"; whether it belongs in a person's list is only known after analysis.
  const uploaded = (photo: Photo | null) => {
    group.reload();
    if (!photo) return list.refresh();
    if (filter === "all") list.merge([photo]);
  };
  const reprocessed = () => {
    group.reload();
    list.refresh();
  };
  // The answer may arrive after a swipe to another photo, which stays on screen.
  const changed = (photo: Photo) => {
    setOpened((current) => (current?.id === photo.id ? photo : current));
    list.merge([photo]);
  };
  const deleted = (photoId: string) => {
    setOpened(null);
    list.remove(photoId);
    group.reload();
  };

  const selected = list.photos.filter((photo) => selection.ids.has(photo.id));

  return (
    <>
      <div className="flex flex-col gap-3">
        <PageHeader title={name} backTo="/" subtitle={`${plural(counts.total, "foto", "fotos")} · ${plural(members.length, "pessoa", "pessoas")}`}>
          <PilhaAvatares pessoas={members.map(personOf)} max={3} />
        </PageHeader>
        {group.error && <ErrorNotice error={group.error} />}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <UsageBar usedBytes={usedBytes} quotaBytes={quotaBytes} />
          </div>
          <CopyButton text={inviteUrl(inviteToken)} label="Copiar convite" />
        </div>
      </div>

      <Uploader groupId={groupId} showAction={selected.length === 0} onUploaded={uploaded} onSettled={group.reload} />
      {isAppleTouchDevice() && <ShortcutUpload groupId={groupId} />}

      <section className="flex flex-col gap-3" aria-label="Fotos do grupo">
        <FilterBar group={group.data} personOf={personOf} filter={filter} onChange={changeFilter} />
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground" role="status">
            {counts.processing > 0 && `${counts.processing} em análise`}
            {counts.processing > 0 && counts.failed > 0 && " · "}
            {counts.failed > 0 && `${counts.failed} sem miniatura`}
          </span>
          {list.photos.length > 0 && <SecondaryButton onClick={() => selection.selectAll(list.photos)}>Selecionar todas</SecondaryButton>}
        </div>
        {list.error && <ErrorNotice error={list.error} />}
        <PhotoGrid photos={list.photos} personOf={personOf} selectedIds={selection.ids} onToggle={selection.toggle} onOpen={setOpened} />
        {list.photos.length === 0 && !list.loading && !list.error && (
          <EstadoFotos titulo="Cadê as fotos? 👀">{filter === "all" ? "Bora começar esse álbum?" : "Nada por aqui ainda."}</EstadoFotos>
        )}
        {list.photos.length === 0 && list.loading && <Loading />}
        {list.hasMore && (
          <SecondaryButton className="self-center" disabled={list.loading} onClick={list.loadMore}>
            Carregar mais
          </SecondaryButton>
        )}
      </section>

      <SelectionBar selected={selected} groupNames={{ [groupId]: name }} onClear={selection.clear} />
      {opened && (
        <PhotoViewer
          photos={list.photos}
          personOf={personOf}
          opened={opened}
          onMove={setOpened}
          onClose={() => setOpened(null)}
          onChanged={changed}
          onDeleted={deleted}
          onReprocessed={reprocessed}
        />
      )}
    </>
  );
}

export function GroupPage() {
  const { id } = useParams();
  // Keyed by group so moving between groups starts from a clean page.
  return <GroupView key={id} groupId={id!} />;
}
