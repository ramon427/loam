import { useWindowControlsTheme } from "./WindowChrome";

/** The top row of the locked window, which has no sidebar: the app's name on the drag area. */
export function TitleBar() {
  useWindowControlsTheme();
  return (
    <header className="loam-chrome-row loam-titlebar">
      <span className="loam-app-name">Loam</span>
    </header>
  );
}
