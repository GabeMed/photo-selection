import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { type AdesivoReacao, rotulosReacao } from "./reacoes";
import fogo from "../assets/icons/adesivo-fogo.svg?raw";
import amor from "../assets/icons/adesivo-amor.svg?raw";
import risada from "../assets/icons/adesivo-risada.svg?raw";
import uau from "../assets/icons/adesivo-uau.svg?raw";
import olhos from "../assets/icons/adesivo-olhos.svg?raw";
import camera from "../assets/icons/adesivo-camera.svg?raw";
import brilho from "../assets/icons/adesivo-brilho.svg?raw";
import joinha from "../assets/icons/adesivo-joinha.svg?raw";
export const desenhosReacao = { fogo, amor, risada, uau, olhos, camera, brilho, joinha };
const reacaoVariants = cva("sticker inline-flex shrink-0 items-center justify-center rounded-pill bg-card p-1 outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed [&_svg]:size-full", {
  variants: { size: { sm: "size-11", md: "size-14" }, variant: { esquerda: "sticker-esquerda", direita: "sticker-direita", suave: "" } },
  defaultVariants: { size: "md", variant: "esquerda" },
});
export interface ReacaoProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onToggle">, VariantProps<typeof reacaoVariants> {
  adesivo: AdesivoReacao;
  rotulo?: string;
  ativo?: boolean;
  onAlternar?: (ativo: boolean) => void;
}
/** Eight original sticker toggles, without emoji or reaction counts. */
export const Reacao = React.forwardRef<HTMLButtonElement, ReacaoProps>(({ adesivo, rotulo, ativo = false, onAlternar, size, variant, className, onClick, children, ...props }, ref) => (
  <button ref={ref} type="button" aria-pressed={ativo} aria-label={rotulo ?? rotulosReacao[adesivo]} onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) onAlternar?.(!ativo); }} className={cn(reacaoVariants({ size, variant }), ativo && "bg-accent ring-2 ring-tinta", className)} {...props}>
    <span className="size-full" aria-hidden dangerouslySetInnerHTML={{ __html: desenhosReacao[adesivo] }} />{children}
  </button>
));
Reacao.displayName = "Reacao";
