import { createContext, useContext } from "react";

/** Opens another note from a note link in the editor; null where the host cannot navigate. */
export const NoteLinkNavigationContext = createContext<((noteId: string) => void) | null>(null);

export const useNoteLinkNavigation = () => useContext(NoteLinkNavigationContext);
