import * as React from "react";
import { cn } from "../lib/utils";

export interface TelaCelularProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Mobile column: full width on phones, centered max 480px on desktop. The bottom padding keeps room for a
 * `BarraAcaoFixa`; a page that reserves the exact room itself marks its spacer with `data-reserva-barra`.
 */
export const TelaCelular = React.forwardRef<HTMLDivElement, TelaCelularProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mx-auto min-h-dvh w-full max-w-coluna px-4 pb-32 has-[[data-reserva-barra]]:pb-0", className)} {...props} />
  ),
);
TelaCelular.displayName = "TelaCelular";
