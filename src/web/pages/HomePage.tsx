import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import type { GroupSummary, Photo } from "../api";
import { PhotoGrid } from "../components/PhotoGrid";
import { PhotoViewer } from "../components/PhotoViewer";
import { SelectionBar } from "../components/SelectionBar";
import { ErrorNotice, Loading, PageHeader, SecondaryButton, UsageBar } from "../components/ui";
import { BarraAcaoFixa, botaoPrincipalVariants, CartaoViagem, EstadoFotos } from "../design-system";
import { plural } from "../format";
import { useLoad, useSelection, type Selection } from "../hooks";
import { useSession } from "../session";

interface GroupSectionProps {
  group: GroupSummary;
  /** The photos of this group in which the person appears, most recent first; `undefined` until they are read. */
  photos: Photo[] | undefined;
  /** Set when reading the photos failed; the page shows the error itself. */
  failed: boolean;
  selection: Selection;
  onOpen: (photo: Photo) => void;
}

function GroupPhotos({ photos, failed, selection, onOpen }: Omit<GroupSectionProps, "group">) {
  if (!photos) return failed ? <p className="text-sm text-muted-foreground">Não deu pra carregar suas fotos agora.</p> : <Loading />;
  if (photos.length === 0) {
    return (
      <EstadoFotos titulo="Cadê as suas fotos? 👀" size="sm">
        Elas aparecem aqui sozinhas quando a galera subir fotos com você.
      </EstadoFotos>
    );
  }
  return <PhotoGrid photos={photos} selectedIds={selection.ids} onToggle={selection.toggle} onOpen={onOpen} />;
}

function GroupSection({ group, photos, failed, selection, onOpen }: GroupSectionProps) {
  return (
    <section className="flex flex-col gap-3" aria-label={group.name}>
      {/* An article gives a link no name of its own. */}
      <Link to={`/g/${group.id}`} aria-label={`Abrir ${group.name}, ${plural(group.photoCount, "foto", "fotos")}`} className="rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring">
        {/* The API has no cover for a group: the most recent photo with the person stands in when there is one. */}
        <CartaoViagem titulo={group.name} totalFotos={group.photoCount} capa={photos?.find((photo) => photo.thumbUrl)?.thumbUrl ?? undefined}>
          <div className="flex flex-col gap-2 px-4 pb-4">
            <p className="text-sm text-muted-foreground">
              {plural(group.memberCount, "pessoa", "pessoas")} · {group.myPhotoCount} com você
            </p>
            <UsageBar usedBytes={group.usedBytes} quotaBytes={group.quotaBytes} />
          </div>
        </CartaoViagem>
      </Link>
      <h2 className="text-lg font-semibold">Suas fotos{photos && ` (${photos.length})`}</h2>
      <GroupPhotos photos={photos} failed={failed} selection={selection} onOpen={onOpen} />
    </section>
  );
}

export function HomePage() {
  const { user } = useSession();
  const mine = useLoad(api.listMyPhotos, []);
  const groups = useLoad(api.listGroups, []);
  const selection = useSelection();
  const [opened, setOpened] = useState<Photo | null>(null);

  const photosByGroup = mine.data && new Map(mine.data.map((group) => [group.id, group.photos]));
  const allPhotos = (mine.data ?? []).flatMap((group) => group.photos);
  const groupNames = Object.fromEntries((mine.data ?? []).map((group) => [group.id, group.name]));
  const selected = allPhotos.filter((photo) => selection.ids.has(photo.id));

  // A tag or a deletion also changes the counts on the group cards.
  const reload = () => {
    mine.reload();
    groups.reload();
  };
  // The answer may arrive after a swipe to another photo, which stays on screen.
  const changed = (photo: Photo) => {
    setOpened((current) => (current?.id === photo.id ? photo : current));
    reload();
  };
  // The photo may leave "Suas fotos" with the change, so the viewer has nothing current to show.
  const closeAndReload = () => {
    setOpened(null);
    reload();
  };

  return (
    <>
      <PageHeader title={`Oi, ${user.name}!`} subtitle={groups.data && `${plural(groups.data.length, "grupo", "grupos")} por aqui ✈️`} />

      {user.selfies.length === 0 && (
        <EstadoFotos titulo="Cadê a sua selfie? 👀" size="sm">
          É por ela que a gente acha as fotos em que você aparece.
        </EstadoFotos>
      )}

      {mine.error && <ErrorNotice error={mine.error} />}
      {groups.error && <ErrorNotice error={groups.error} />}
      {!groups.data && !groups.error && <Loading />}
      {groups.data?.length === 0 && (
        <EstadoFotos titulo="Cadê a galera? 👀">Você ainda não tá em nenhum grupo. Pede o link do convite pra quem organizou a viagem.</EstadoFotos>
      )}
      {groups.data?.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          photos={photosByGroup && (photosByGroup.get(group.id) ?? [])}
          failed={mine.error !== undefined}
          selection={selection}
          onOpen={setOpened}
        />
      ))}
      {allPhotos.length > 0 && (
        <SecondaryButton className="self-start" onClick={() => selection.selectAll(allPhotos)}>
          Selecionar todas
        </SecondaryButton>
      )}

      <SelectionBar selected={selected} groupNames={groupNames} onClear={selection.clear} />
      {user.selfies.length === 0 && selected.length === 0 && (
        <BarraAcaoFixa>
          <Link to="/perfil" className={botaoPrincipalVariants()}>
            Mandar minha selfie
          </Link>
        </BarraAcaoFixa>
      )}
      {opened && (
        <PhotoViewer
          photos={allPhotos}
          opened={allPhotos.find((photo) => photo.id === opened.id) ?? opened}
          onMove={setOpened}
          onClose={() => setOpened(null)}
          onChanged={changed}
          onDeleted={closeAndReload}
          onReprocessed={closeAndReload}
        />
      )}
    </>
  );
}
