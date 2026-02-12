import { useEffect } from "react";

export function useFitToViewport(
  headerRef: React.RefObject<HTMLElement>,
  footerRef: React.RefObject<HTMLElement>
) {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-h", `${viewportHeight}px`);
      const headerH = headerRef.current?.getBoundingClientRect().height ?? 0;
      const footerH = footerRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--app-header-h", `${headerH}px`);
      root.style.setProperty("--app-footer-h", `${footerH}px`);
      const available = Math.max(0, viewportHeight - headerH - footerH);
      root.style.setProperty("--app-available-h", `${available}px`);
      if (available < 620) root.classList.add("is-compact");
      else root.classList.remove("is-compact");
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [headerRef, footerRef]);
}
