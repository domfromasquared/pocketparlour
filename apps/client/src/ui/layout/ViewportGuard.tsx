import React, { useEffect } from "react";

export function ViewportGuard() {
  useEffect(() => {
    const markOverflow = () => {
      document.querySelectorAll("[data-overflow]").forEach((el) => el.removeAttribute("data-overflow"));
      const all = Array.from(document.body.querySelectorAll("*") as NodeListOf<HTMLElement>);
      for (const el of all) {
        if (!el.offsetParent) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) {
          el.setAttribute("data-overflow", "true");
        }
      }
    };
    const id = setInterval(markOverflow, 1000);
    markOverflow();
    window.addEventListener("resize", markOverflow, { passive: true });
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", markOverflow);
    };
  }, []);

  return (
    <div className="viewport-guard">
      <div className="viewport-guard__frame" />
      <div className="viewport-guard__safe" />
    </div>
  );
}
