import * as React from "react";
import { cn } from "../lib/utils";
import { PilhaAvatares } from "./Avatar";
import type { Pessoa } from "./pessoa";

export interface CartaoViagemProps extends React.HTMLAttributes<HTMLElement> {
  titulo: string;
  local?: string;
  datas?: string;
  capa?: string;
  pessoas?: Pessoa[];
  totalFotos: number;
}

/** Summary card for a trip: cover photo, name, dates and who's in. */
export const CartaoViagem = React.forwardRef<HTMLElement, CartaoViagemProps>(
  ({ titulo, local, datas, capa, pessoas, totalFotos, className, children, ...props }, ref) => (
    <article
      ref={ref}
      className={cn("overflow-hidden rounded-xl border-grosso border-tinta bg-card text-card-foreground shadow-pop", className)}
      {...props}
    >
      {capa && <img src={capa} alt={`Capa da viagem ${titulo}`} className="aspect-[16/9] w-full object-cover border-b-grosso border-tinta" />}
      <div className="flex items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-semibold">{titulo}</h3>
          {(local || datas) && <p className="text-sm text-muted-foreground">📍 {[local, datas].filter(Boolean).join(" · ")}</p>}
          <p className="mt-1 text-sm font-bold">{totalFotos === 1 ? "1 foto" : `${totalFotos} fotos`}</p>
        </div>
        {pessoas && <PilhaAvatares pessoas={pessoas} max={3} />}
      </div>
      {children}
    </article>
  ),
);
CartaoViagem.displayName = "CartaoViagem";
