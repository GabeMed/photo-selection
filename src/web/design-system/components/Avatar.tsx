import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { corFundo, type Pessoa } from "./pessoa";

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center rounded-pill border-grosso border-tinta font-display font-semibold text-tinta overflow-hidden",
  {
    variants: {
      size: { sm: "size-8 text-xs", md: "size-11 text-base", lg: "size-20 text-2xl" },
    },
    defaultVariants: { size: "md" },
  },
);

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  pessoa: Pessoa;
}

/** A person's face (or initial) with their personal color as the ring. */
export const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ pessoa, size, className, ...props }, ref) => (
    <span
      ref={ref}
      role="img"
      aria-label={pessoa.nome}
      className={cn("rounded-pill p-[3px]", corFundo[pessoa.cor], "inline-flex", className)}
      {...props}
    >
      <span className={cn(avatarVariants({ size }), corFundo[pessoa.cor])}>
        {pessoa.foto ? (
          <img src={pessoa.foto} alt="" className="size-full object-cover" />
        ) : (
          pessoa.nome.charAt(0).toUpperCase()
        )}
      </span>
    </span>
  ),
);
Avatar.displayName = "Avatar";

export interface PilhaAvataresProps extends React.HTMLAttributes<HTMLDivElement> {
  pessoas: Pessoa[];
  /** How many avatars to show before "+N". */
  max?: number;
  size?: "sm" | "md";
}

/** Overlapping avatars of who's on the trip. */
export const PilhaAvatares = React.forwardRef<HTMLDivElement, PilhaAvataresProps>(
  ({ pessoas, max = 4, size = "sm", className, ...props }, ref) => {
    const visiveis = pessoas.slice(0, max);
    const resto = pessoas.length - visiveis.length;
    return (
      <div ref={ref} className={cn("flex items-center", className)} {...props}>
        {visiveis.map((p, i) => (
          <Avatar key={p.id} pessoa={p} size={size} className={cn(i > 0 && "-ml-3")} />
        ))}
        {resto > 0 && (
          <span
            className={cn(
              "-ml-3 inline-flex items-center justify-center rounded-pill border-grosso border-tinta bg-card font-display font-semibold",
              size === "sm" ? "size-[2.4rem] text-xs" : "size-[3.1rem] text-sm",
            )}
          >
            +{resto}
          </span>
        )}
      </div>
    );
  },
);
PilhaAvatares.displayName = "PilhaAvatares";
