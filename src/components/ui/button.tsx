import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-smooth focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // 主按鈕：accent 色（随主题变色）
        default:
          "bg-accent text-text-inverse hover:bg-accent-hover shadow-sm",
        // 危险按鈕
        destructive:
          "bg-red-500 text-white hover:bg-red-600",
        // 轮廓按鈕
        outline:
          "border border-border-subtle bg-bg-card hover:bg-bg-secondary hover:border-border-focus text-text-primary",
        // 次按鈕
        secondary:
          "text-text-muted hover:bg-bg-secondary hover:text-text-primary",
        // 幽灵按鈕
        ghost:
          "text-text-muted hover:text-text-primary hover:bg-bg-secondary",
        // MCP 专属按鈕
        mcp: "bg-emerald-500 text-white hover:bg-emerald-600",
        // 链接按鈕
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-4 py-2",
        sm: "h-7 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-8 w-8 p-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
