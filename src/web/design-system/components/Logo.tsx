import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const logoVariants = cva("sticker sticker-logo relative inline-flex items-baseline whitespace-nowrap rounded-xl bg-primary px-4 py-2 font-display font-bold leading-none text-primary-foreground", {
  variants: { size: { sm: "text-logo-sm", md: "text-logo-md", lg: "text-logo-lg" } },
  defaultVariants: { size: "md" },
});
export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof logoVariants> {}
/** Brand wordmark: Cadê?, with a lifted corner and oversized question mark. */
export const Logo = React.forwardRef<HTMLSpanElement, LogoProps>(({ className, size, children, ...props }, ref) => (
  <span ref={ref} aria-label="Cadê?" className={cn(logoVariants({ size }), className)} {...props}>Cadê<span className="logo-interrogacao">?</span>{children}</span>
));
Logo.displayName = "Logo";
