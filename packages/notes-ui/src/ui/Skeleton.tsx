import type * as React from "react";

import { cn } from "./cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-md bg-(--app-muted)/15", className)} {...props} />;
}

export { Skeleton };
