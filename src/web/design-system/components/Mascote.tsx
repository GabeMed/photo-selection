import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import curioso from "../assets/illustrations/mascote-curioso.svg?raw";
import comemorando from "../assets/illustrations/mascote-comemorando.svg?raw";
import esperando from "../assets/illustrations/mascote-esperando.svg?raw";
import triste from "../assets/illustrations/mascote-triste.svg?raw";

export const posesMascote = ["curioso", "comemorando", "esperando", "triste"] as const;
export type PoseMascote = typeof posesMascote[number];
const desenhos = { curioso, comemorando, esperando, triste };
const mascoteVariants = cva("sticker-recorte inline-flex shrink-0 items-center justify-center [&_svg]:size-full", {
  variants: { size: { xs: "size-6", sm: "size-16", md: "size-28", lg: "size-40" }, variant: { esquerda: "sticker-esquerda", direita: "sticker-direita", suave: "" } },
  defaultVariants: { size: "md", variant: "suave" },
});
export interface MascoteProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof mascoteVariants> { pose?: PoseMascote; }
/** Die-cut question-mark character (the "?" is the body); use outside photos, never in fullscreen. */
export const Mascote = React.forwardRef<HTMLSpanElement, MascoteProps>(({ pose = "curioso", size, variant, className, children, ...props }, ref) => (
  <span ref={ref} role="img" aria-label={`Mascote ${pose}`} className={cn(mascoteVariants({ size, variant }), className)} {...props}>
    <span className="size-full" aria-hidden dangerouslySetInnerHTML={{ __html: desenhos[pose] }} />{children}
  </span>
));
Mascote.displayName = "Mascote";
