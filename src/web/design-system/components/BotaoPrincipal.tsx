import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { normalizarProgresso } from "./reacoes";
import { cn } from "../lib/utils";

export const botaoPrincipalVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-display font-semibold border-grosso border-tinta rounded-pill transition-all select-none outline-none focus-visible:ring-4 focus-visible:ring-ring active:translate-x-0.5 active:translate-y-0.5 active:shadow-pop-sm",
  {
    variants: {
      variant: {
        destaque: "bg-primary text-primary-foreground shadow-pop",
        tinta: "bg-tinta text-papel shadow-pop",
        suave: "bg-card text-card-foreground shadow-pop-sm",
      },
      size: {
        md: "h-11 px-5 text-base",
        lg: "h-14 px-7 text-lg w-full",
      },
    },
    defaultVariants: { variant: "destaque", size: "lg" },
  },
);

export interface BotaoPrincipalProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof botaoPrincipalVariants> {
  /** Optional determinate upload progress, from 0 to 100. */
  progresso?: number;
  /** Shows progress and prevents repeated submissions. */
  carregando?: boolean;
}

/** The single main action of a screen. Wrap in `BarraAcaoFixa` to pin it to the bottom. */
export const BotaoPrincipal = React.forwardRef<HTMLButtonElement, BotaoPrincipalProps>(
  ({ className, variant, size, carregando, progresso, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        botaoPrincipalVariants({ variant, size }),
        (disabled || carregando) && "pointer-events-none",
        disabled && !carregando && "bg-muted text-tinta shadow-none",
        className,
      )}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...props}
    >
      {carregando && <Loader2 className="size-5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
      {carregando && progresso !== undefined && <span className="shrink-0 font-body text-sm tabular-nums" role="progressbar" aria-label="Progresso do envio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalizarProgresso(progresso)}>{normalizarProgresso(progresso)}%</span>}
    </button>
  ),
);
BotaoPrincipal.displayName = "BotaoPrincipal";

export interface BarraAcaoFixaProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Pins its children to the bottom of the viewport inside the 480px column. */
export const BarraAcaoFixa = React.forwardRef<HTMLDivElement, BarraAcaoFixaProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 mx-auto max-w-coluna px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 bg-gradient-to-t from-background via-background to-transparent",
        className,
      )}
      {...props}
    />
  ),
);
BarraAcaoFixa.displayName = "BarraAcaoFixa";
