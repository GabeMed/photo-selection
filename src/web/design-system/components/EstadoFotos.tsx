import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { Mascote, type PoseMascote } from "./Mascote";
const estadoVariants = cva("flex items-center gap-5 py-6", {
  variants: { variant: { vazio: "", pronto: "", esperando: "", erro: "" }, size: { sm: "", md: "flex-col text-center" } },
  defaultVariants: { variant: "vazio", size: "md" },
});
const poses: Record<"vazio" | "pronto" | "esperando" | "erro", PoseMascote> = { vazio: "curioso", pronto: "comemorando", esperando: "esperando", erro: "triste" };
export interface EstadoFotosProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof estadoVariants> { titulo: string; }
/** Empty, waiting, success and error messages composed with the mascot. */
export const EstadoFotos = React.forwardRef<HTMLDivElement, EstadoFotosProps>(({ titulo, variant = "vazio", size, className, children, ...props }, ref) => (
  <div ref={ref} role={variant === "erro" ? "alert" : "status"} className={cn(estadoVariants({ variant, size }), className)} {...props}>
    <Mascote pose={poses[variant ?? "vazio"]} size={size === "sm" ? "sm" : "md"} />
    <div className="min-w-0"><p className="font-display text-xl font-bold">{titulo}</p>{children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}</div>
  </div>
));
EstadoFotos.displayName = "EstadoFotos";
