import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/20 bg-warning/10 text-warning",
        info: "border-secondary/20 bg-secondary/10 text-secondary",
        danger: "border-primary/20 bg-primary/10 text-primary",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      status: "neutral",
    },
  },
);

type StatusBadgeProps = ComponentProps<"span"> &
  VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({
  className,
  status,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    />
  );
}
