import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const carimboVariants = cva("inline-block shrink-0 font-display", {
  variants: {
    size: { sm: "size-28", md: "size-40" },
    cor: { primaria: "text-primary", turquesa: "text-pessoa-turquesa", laranja: "text-pessoa-laranja", amarelo: "text-pessoa-amarelo", verde: "text-pessoa-verde", azul: "text-pessoa-azul", roxo: "text-pessoa-roxo" },
  },
  defaultVariants: { size: "md", cor: "primaria" },
});

export interface CarimboViagemProps extends React.SVGAttributes<SVGSVGElement>, VariantProps<typeof carimboVariants> { nome: string; data: string; }

/** Stable slight tilt (-6°..6°) derived from the trip name. */
export function rotacaoCarimbo(nome: string) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 13) - 6;
}

const serrilha = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2, r = i % 2 ? 96 : 100;
  return `${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`;
}).join(" ");

/** Passport-style ink stamp: serrated edge, dashed inner ring, curved text, one ink color per trip. */
export const CarimboViagem = React.forwardRef<SVGSVGElement, CarimboViagemProps>(({ nome, data, size, cor, className, style, ...props }, ref) => {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg ref={ref} viewBox="0 0 200 200" role="img" aria-label={`Carimbo ${nome}, ${data}`} className={cn(carimboVariants({ size, cor }), className)} style={{ rotate: `${rotacaoCarimbo(nome)}deg`, ...style }} {...props}>
      <defs>
        <filter id={`${id}f`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 3.1" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
        <path id={`${id}t`} d="M100 100 m-66 0 a66 66 0 1 1 132 0" />
        <path id={`${id}b`} d="M100 100 m-74 0 a74 74 0 0 0 148 0" />
      </defs>
      <g filter={`url(#${id}f)`} fill="none" stroke="currentColor">
        <polygon points={serrilha} strokeWidth="5" strokeLinejoin="round" />
        <circle cx="100" cy="100" r="50" strokeWidth="3" strokeDasharray="6 5" />
        <g fill="currentColor" stroke="none" fontWeight="700">
          <text fontSize="19" letterSpacing="2" textAnchor="middle"><textPath href={`#${id}t`} startOffset="50%">{nome.toUpperCase()}</textPath></text>
          <text fontSize="15" letterSpacing="3" textAnchor="middle"><textPath href={`#${id}b`} startOffset="50%">{data.toUpperCase()}</textPath></text>
          <text x="100" y="94" fontSize="16" textAnchor="middle">CADÊ?</text>
          <text x="100" y="118" fontSize="13" textAnchor="middle">ACHEI!</text>
        </g>
      </g>
    </svg>
  );
});
CarimboViagem.displayName = "CarimboViagem";
