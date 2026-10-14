import { useEffect, useState } from "react";

import { resolveTheme, subscribeToThemeChanges } from "../lib/theme";

export const useEditorTheme = () => {
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const update = () => setColorScheme(resolveTheme());
    update();
    return subscribeToThemeChanges(update);
  }, []);

  return colorScheme;
};
