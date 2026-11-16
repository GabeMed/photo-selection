import * as React from "react";
import { cva } from "class-variance-authority";
import { Check, RotateCw } from "lucide-react";
import { cn } from "../lib/utils";

export type EstadoEnvio = "enviando" | "pronto" | "erro";

const barra = cva("h-full rounded-pill transition-all duration-300", {
  variants: {
    estado: { enviando: "bg-primary", pronto: "bg-sucesso", erro: "bg-destructive" },
  },
});

export interface BarraProgressoEnvioProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Without it, the row shows only the name and the bar. */
  miniatura?: string;
  nome: string;
  /** 0–100 */
  progresso: number;
  estado: EstadoEnvio;
  /** Without it, a failed row shows no retry button. */
  onTentarDeNovo?: () => void;
}

/** Per-photo upload progress row. */
export const BarraProgressoEnvio = React.forwardRef<HTMLDivElement, BarraProgressoEnvioProps>(
  ({ miniatura, nome, progresso, estado, onTentarDeNovo, className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-3 rounded-lg border-grosso border-tinta bg-card p-2 shadow-pop-sm", className)} {...props}>
      {miniatura && <img src={miniatura} alt="" className="size-12 shrink-0 rounded-md border-grosso border-tinta object-cover" />}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 text-sm">
          <span className="truncate font-semibold">{nome}</span>
          <span className="shrink-0 font-bold">
            {estado === "pronto" ? "foi! ✨" : estado === "erro" ? "deu ruim 😵" : `${Math.round(progresso)}%`}
          </span>
        </div>
        <div
          className="mt-1.5 h-3 overflow-hidden rounded-pill border-grosso border-tinta bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progresso)}
          aria-label={`Enviando ${nome}`}
        >
          <div className={barra({ estado })} style={{ width: `${estado === "pronto" ? 100 : progresso}%` }} />
        </div>
      </div>
      {estado === "pronto" && <Check className="size-5 shrink-0 text-sucesso" aria-hidden />}
      {estado === "erro" && onTentarDeNovo && (
        <button type="button" onClick={onTentarDeNovo} aria-label="Tentar de novo" className="grid size-11 place-items-center rounded-pill outline-none focus-visible:ring-4 focus-visible:ring-ring">
          <RotateCw className="size-5" />
        </button>
      )}
    </div>
  ),
);
BarraProgressoEnvio.displayName = "BarraProgressoEnvio";
