import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-smooth focus:outline-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent text-text-inverse hover:bg-accent-hover",
        secondary:
          "border-border-subtle bg-bg-secondary text-text-muted",
        destructive:
          "border-transparent bg-red-500 text-white hover:bg-red-600",
        outline: "text-text-primary border-border-subtle",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
