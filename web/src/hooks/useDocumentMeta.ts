import { useEffect } from "react";

/**
 * Sets document.title and the meta description for the lifetime of the calling page, restoring
 * index.html's defaults on unmount. This SPA has no server-side rendering, so this only helps
 * clients that execute JS (modern Googlebot does) — robots.txt/sitemap.xml still gate what's worth crawling.
 */
export function useDocumentMeta(title: string, description: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    const descriptionTag = document.querySelector('meta[name="description"]');
    const previousDescription = descriptionTag?.getAttribute("content") ?? "";

    document.title = title;
    descriptionTag?.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      descriptionTag?.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}
