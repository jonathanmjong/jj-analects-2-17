import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

/**
 * Renders `children` only once the placeholder gets within `rootMargin` of the
 * viewport, then keeps them mounted forever. Exists for the Company page, which
 * mounts a dozen analysis panels — each with its own multi-year statement math
 * and, for several, a chart library — all of which used to run before first
 * paint even though most sit thousands of pixels down the page.
 *
 * Two escape hatches keep this from changing what a user can actually see:
 * printing mounts everything synchronously first (a printed page must contain
 * the whole document, not the part that was scrolled into view), and a browser
 * without IntersectionObserver mounts everything immediately.
 *
 * Once visible, the wrapper element is gone entirely — children sit directly in
 * the parent's flow/grid, so this never changes layout after it has done its job.
 */
export function DeferUntilVisible({
  children,
  minHeight = 320,
  rootMargin = "600px 0px",
  forceVisible = false,
}: {
  children: ReactNode;
  /** Reserved space for the not-yet-mounted content, so scrolling past it doesn't jump. */
  minHeight?: number;
  rootMargin?: string;
  /**
   * Mount immediately, no observer. For content that only mounts *because* a print
   * already started (the Company page's inactive tabs): the beforeprint event has
   * already fired by then, so this instance's own listener would register too late
   * to get its children into the printed document.
   */
  forceVisible?: boolean;
}) {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible || forceVisible) return;
    // flushSync only on the print path: beforeprint gives us one synchronous
    // chance to get the rest of the document into the DOM before the browser
    // paginates it. Scrolling has no such deadline and must not force a
    // synchronous render.
    const mountNow = () => flushSync(() => setVisible(true));

    const element = placeholderRef.current;
    const observer = element
      ? new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
          },
          { rootMargin },
        )
      : null;
    if (element && observer) observer.observe(element);

    const printQuery = window.matchMedia?.("print");
    const onPrintChange = (event: MediaQueryListEvent) => {
      if (event.matches) mountNow();
    };
    window.addEventListener("beforeprint", mountNow);
    printQuery?.addEventListener?.("change", onPrintChange);
    if (printQuery?.matches) mountNow();

    return () => {
      observer?.disconnect();
      window.removeEventListener("beforeprint", mountNow);
      printQuery?.removeEventListener?.("change", onPrintChange);
    };
  }, [visible, forceVisible, rootMargin]);

  if (visible || forceVisible) return <>{children}</>;
  return <div ref={placeholderRef} style={{ minHeight }} aria-hidden />;
}
