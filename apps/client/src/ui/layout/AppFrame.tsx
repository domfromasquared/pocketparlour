import React, { useRef } from "react";
import { useFitToViewport } from "./useFitToViewport";
import { ViewportGuard } from "./ViewportGuard";

/*
Layout contract (MANDATORY for every page):
 - AppFrame is the single layout root: header, main scroll view, optional footer/nav.
 - Scrolling occurs only in `app-frame__main` (overflow-y:auto). No body or page-specific scrolls.
 - Forbidden: per-page absolute layout that escapes the column flow, hero sections using fixed heights w/out min-height:0, or modal/toolbars that rely on body scrolling.
 - To add new pages: wrap the content in AppFrame, keep children within `app-frame__main`, and respect the min-width/spacing scale defined in global CSS; never add bespoke positioning outside AppFrame.
 - Header/footer heights are measured at runtime so the main content always subtracts their height (via --app-available-h); do not hardcode extra offsets in page markup.
*/

type AppFrameProps = {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export function AppFrame({ header, footer, children }: AppFrameProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useFitToViewport(headerRef, footerRef);

  return (
    <div className="app-frame">
      {header && (
        <div className="app-frame__header" ref={headerRef}>
          {header}
        </div>
      )}
      <div className="app-frame__main">{children}</div>
      {footer && (
        <div className="app-frame__footer" ref={footerRef}>
          {footer}
        </div>
      )}
      {import.meta.env.DEV && <ViewportGuard />}
    </div>
  );
}
