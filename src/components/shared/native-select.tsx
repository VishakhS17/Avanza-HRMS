import type { ComponentProps } from "react";
import { cn } from "cn";

const controlClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClassName, className)} {...props} />;
}
