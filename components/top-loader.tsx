"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * YouTube-style indeterminate bar that overlays the header's bottom border
 * while a same-origin navigation is in flight. Starts on click of any
 * internal link, ends when the pathname actually changes.
 */
export function TopLoader() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setLoading(false);
    }
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Note: don't bail on e.defaultPrevented — next/link's own click
      // handler already calls preventDefault() before this (document-level)
      // listener runs, since that's precisely the client-side nav we want.
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return; // same page / hash-only

      setLoading(true);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!loading) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
      <div className="h-full w-1/3 animate-top-loader rounded-full bg-primary" />
    </div>
  );
}
