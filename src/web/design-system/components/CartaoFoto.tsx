import * as React from "react";
import { cn } from "../lib/utils";
import { corFundo, type Pessoa } from "./pessoa";
import { desenhosReacao } from "./Reacao";
import type { AdesivoReacao } from "./reacoes";

export interface CartaoFotoProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Missing while the photo has no thumbnail yet; `children` fill the tile instead. */
  src?: string;
  largura: number;
  altura: number;
  autor: Pessoa;
  descricao?: string;
  /** Interactive sticker strip rendered below the photo, never over it. */
  reacoes?: React.ReactNode;
  /** Reactions already given; shown small in the photo's bottom corner. */
  reacoesDadas?: readonly AdesivoReacao[];
}

/** A photo in the grid, at its original aspect ratio, tagged with the sender's color. */
export const CartaoFoto = React.forwardRef<HTMLButtonElement, CartaoFotoProps>(
  ({ src, largura, altura, autor, descricao, reacoes, reacoesDadas = [], className, children, ...props }, ref) => (
    <div className="flex flex-col gap-2">
      <button
        ref={ref}
        type="button"
        className={cn("group relative block w-full overflow-hidden rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-ring", className)}
        style={{ aspectRatio: `${largura} / ${altura}` }}
        aria-label={`Foto de ${autor.nome}${descricao ? `: ${descricao}` : ""}`}
        {...props}
      >
        {src ? <img src={src} alt={descricao ?? `Foto de ${autor.nome}`} loading="lazy" className="size-full object-cover" /> : children}
        <span className={cn("absolute bottom-2 left-2 rounded-pill border-grosso border-tinta px-2 py-0.5 font-display text-xs font-semibold text-tinta shadow-pop-sm", corFundo[autor.cor])}>
          {autor.nome}
        </span>
        {reacoesDadas.length > 0 && (
          <span aria-hidden className="absolute bottom-2 right-2 flex -space-x-1">
            {reacoesDadas.map((a, i) => (
              <span key={a} className={cn("size-6 rounded-pill bg-card p-0.5 ring-2 ring-tinta [&_svg]:size-full", i % 2 ? "rotate-6" : "-rotate-6")} dangerouslySetInnerHTML={{ __html: desenhosReacao[a] }} />
            ))}
          </span>
        )}
      </button>
      {reacoes && <div role="group" aria-label="Reagir" className="flex gap-1 overflow-x-auto px-1 py-2">{reacoes}</div>}
    </div>
  ),
);
CartaoFoto.displayName = "CartaoFoto";
