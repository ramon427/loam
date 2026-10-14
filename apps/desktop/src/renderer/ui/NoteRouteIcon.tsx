import { NotebookTextIcon, type LucideProps } from "lucide-react";

/** The icon that stands for a note. */
export const NoteRouteIcon = NotebookTextIcon;

export function NoteRouteGlyph({ className = "size-3.5", ...props }: LucideProps) {
  return <NotebookTextIcon aria-hidden="true" className={className} {...props} />;
}
