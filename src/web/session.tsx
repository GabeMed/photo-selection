import { LogOut, Settings } from "lucide-react";
import { createContext, useContext } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import * as api from "./api";
import type { User } from "./api";
import { ErrorNotice, ErrorText, Loading } from "./components/ui";
import { Avatar, Logo, TelaCelular } from "./design-system";
import { useAction, useLoad } from "./hooks";
import { toPessoa } from "./people";

interface Session {
  user: User;
  setUser: (user: User) => void;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession used outside SessionLayout");
  return session;
}

/** The signed-in person as the design system draws them, with their first selfie as the face. */
export const userAsPessoa = (user: User) => toPessoa(user, user.selfies[0]?.url);

async function leave(): Promise<void> {
  await api.logout();
  window.location.assign("/entrar");
}

const NAV_ITEM = "grid size-11 place-items-center rounded-pill outline-none focus-visible:ring-4 focus-visible:ring-ring";

/** Every page behind the session: without one, the API client sends the visitor to the login page. */
export function SessionLayout() {
  const me = useLoad(api.getMe, []);
  const leaving = useAction();
  if (me.error) {
    return (
      <TelaCelular>
        <ErrorNotice error={me.error} />
      </TelaCelular>
    );
  }
  if (!me.data) {
    return (
      <TelaCelular>
        <Loading />
      </TelaCelular>
    );
  }
  const user = me.data;
  return (
    <SessionContext value={{ user, setUser: me.setData }}>
      <TelaCelular>
        <header className="flex items-center justify-between gap-3 py-3">
          <Link to="/" aria-label="Cadê as Fotos? Início" className="rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-1" aria-label="Principal">
            {user.isAdmin && (
              <NavLink to="/admin" aria-label="Administração" className={NAV_ITEM}>
                <Settings className="size-6" />
              </NavLink>
            )}
            <NavLink to="/perfil" aria-label="Perfil" className={NAV_ITEM}>
              <Avatar pessoa={userAsPessoa(user)} size="sm" />
            </NavLink>
            <button type="button" aria-label="Sair" className={NAV_ITEM} disabled={leaving.busy} onClick={() => void leaving.run(leave)}>
              <LogOut className="size-6" />
            </button>
          </nav>
        </header>
        <main className="flex flex-col gap-6">
          <ErrorText message={leaving.error} />
          <Outlet />
        </main>
      </TelaCelular>
    </SessionContext>
  );
}
