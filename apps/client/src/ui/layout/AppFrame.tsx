import React, { useRef } from "react";
import { useFitToViewport } from "./useFitToViewport";
import { ViewportGuard } from "./ViewportGuard";

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
