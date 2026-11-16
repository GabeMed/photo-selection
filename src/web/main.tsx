import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { botaoPrincipalVariants, EstadoFotos } from "./design-system";
import { AdminPage } from "./pages/AdminPage";
import { AuthPage } from "./pages/AuthPage";
import { GroupPage } from "./pages/GroupPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SessionLayout } from "./session";

const NotFoundPage = () => (
  <>
    <EstadoFotos variant="erro" titulo="Ih, essa página sumiu…">
      Não achei nada nesse endereço.
    </EstadoFotos>
    <Link to="/" className={botaoPrincipalVariants({ variant: "suave" })}>
      Voltar pro início
    </Link>
  </>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/entrar" element={<AuthPage key="login" mode="login" />} />
        <Route path="/cadastrar" element={<AuthPage key="signup" mode="signup" />} />
        <Route element={<SessionLayout />}>
          <Route index element={<HomePage />} />
          <Route path="g/:id" element={<GroupPage />} />
          <Route path="j/:token" element={<InvitePage />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
