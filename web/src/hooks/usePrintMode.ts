import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

/**
 * True while the browser is preparing a print/PDF render. Lets a page that only
 * mounts part of itself on screen (the Company page's tabs) put the whole
 * document in the DOM for the print, then go back to the active section after.
 *
 * `beforeprint` is the browser's one synchronous chance to change the document
 * before it paginates, so the state update has to be flushed there — same
 * constraint DeferUntilVisible works under. The mount-time `matches` check is a
 * plain setState: it happens during an effect, where flushSync is not allowed,
 * and there is no pagination deadline to beat on a page that mounted mid-print.
 */
export function usePrintMode(): boolean {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const enter = () => flushSync(() => setPrinting(true));
    const exit = () => setPrinting(false);
    const printQuery = window.matchMedia?.("print");
    const onPrintChange = (event: MediaQueryListEvent) => (event.matches ? enter() : exit());

    window.addEventListener("beforeprint", enter);
    window.addEventListener("afterprint", exit);
    printQuery?.addEventListener?.("change", onPrintChange);
    if (printQuery?.matches) setPrinting(true);

    return () => {
      window.removeEventListener("beforeprint", enter);
      window.removeEventListener("afterprint", exit);
      printQuery?.removeEventListener?.("change", onPrintChange);
    };
  }, []);

  return printing;
}
