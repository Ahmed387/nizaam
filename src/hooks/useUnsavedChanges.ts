import { useEffect, useRef, useCallback } from "react";
import { confirmAlert } from "@/components/ConfirmDialog";

/**
 * Warns the user before leaving the page when there are unsaved changes.
 * Handles:
 *  - Tab close / refresh / closing the browser (native `beforeunload`)
 *  - Internal SPA navigation via <a> clicks (capture-phase listener)
 *
 * Usage:
 *   const { markClean } = useUnsavedChanges(items.length > 0, "لديك بيانات غير محفوظة...");
 *   // Before programmatic navigate after a successful save:
 *   markClean();
 *   navigate("/somewhere");
 */
export function useUnsavedChanges(isDirty: boolean, message: string) {
  const dirtyRef = useRef(isDirty);
  const cleanedRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = isDirty && !cleanedRef.current;
  }, [isDirty]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = message;
      return message;
    };

    const clickHandler = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (anchor.target === "_blank") return;
      if (href.startsWith("#")) return;

      // Same path → no real navigation, allow.
      const url = new URL(anchor.href, window.location.origin);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      e.preventDefault();
      e.stopPropagation();
      void confirmAlert({
        title: "لسه فيه بيانات مش متسجلة",
        description: message,
        confirmLabel: "أيوه، اخرج وسيبها",
        cancelLabel: "لأ، كمّل شغلي",
        tone: "warning",
      }).then((ok) => {
        if (!ok) return;
        cleanedRef.current = true;
        dirtyRef.current = false;
        anchor.click();
      });
    };


    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", clickHandler, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", clickHandler, true);
    };
  }, [message]);

  const markClean = useCallback(() => {
    cleanedRef.current = true;
    dirtyRef.current = false;
  }, []);

  return { markClean };
}
