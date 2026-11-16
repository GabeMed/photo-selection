import * as React from "react";
import { cn } from "../lib/utils";
import { Avatar, PilhaAvatares } from "./Avatar";
import type { Pessoa } from "./pessoa";

export interface CartaoConviteProps extends React.HTMLAttributes<HTMLElement> {
  titulo: string;
  local?: string;
  datas?: string;
  capa?: string;
  quemChamou?: Pessoa;
  pessoas?: Pessoa[];
  /** How many are in, when the people themselves are not known. Defaults to `pessoas.length`. */
  totalPessoas?: number;
}

/** Invite card shown to whoever opens the trip link. */
export const CartaoConvite = React.forwardRef<HTMLElement, CartaoConviteProps>(
  ({ titulo, local, datas, capa, quemChamou, pessoas, totalPessoas = pessoas?.length ?? 0, className, children, ...props }, ref) => (
    <article
      ref={ref}
      className={cn("relative rotate-[-1.5deg] rounded-2xl border-grosso border-tinta bg-card p-3 shadow-pop-lg", className)}
      {...props}
    >
      <div className="rotate-[1.5deg] px-2 pb-3 pt-1 text-center">
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          {quemChamou ? <><Avatar pessoa={quemChamou} size="sm" /> {quemChamou.nome} te chamou pra</> : "Te chamaram pra"}
        </p>
        <h1 className="mt-1 text-3xl font-bold leading-none">{titulo}</h1>
        <div className="mt-2 flex items-center justify-center gap-2">
          {pessoas && <PilhaAvatares pessoas={pessoas} max={5} size="sm" />}
          <p className="text-sm font-semibold">{totalPessoas === 1 ? "1 já tá dentro" : `${totalPessoas} já tão dentro`}</p>
        </div>
      </div>
      {capa && <img src={capa} alt="" className="h-[45svh] max-h-[45svh] w-full rounded-xl border-grosso border-tinta object-cover" />}
      <div className="px-2 pt-2 text-center">
        {(local || datas) && <p className="text-sm text-muted-foreground">📍 {[local, datas].filter(Boolean).join(" · ")}</p>}
        {children}
      </div>
    </article>
  ),
);
CartaoConvite.displayName = "CartaoConvite";
