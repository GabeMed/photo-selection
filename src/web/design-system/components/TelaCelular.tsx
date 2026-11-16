import * as React from "react";
import { cn } from "../lib/utils";

export interface TelaCelularProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Mobile column: full width on phones, centered max 480px on desktop. */
export const TelaCelular = React.forwardRef<HTMLDivElement, TelaCelularProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mx-auto min-h-dvh w-full max-w-coluna px-4 pb-32", className)} {...props} />
  ),
);
TelaCelular.displayName = "TelaCelular";
