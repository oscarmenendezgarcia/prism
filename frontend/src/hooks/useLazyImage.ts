/**
 * Lazy image loading hook via IntersectionObserver.
 * T-009: defers setting an image src until the element enters the viewport.
 *
 * Returns a ref to attach to the container element (or the img itself), plus
 * loading state flags. The actual `src` to pass to <img> is returned as
 * `activeSrc` — it is null until the element is visible.
 */

import { useState, useEffect, useRef } from 'react';

export interface UseLazyImageResult {
  /** Attach this ref to the element whose visibility triggers the load. */
  ref: React.RefObject<HTMLDivElement | null>;
  /**
   * The image src to pass to <img>. Null until the element enters the viewport.
   * The calling component should pass its placeholder/shimmer while this is null.
   */
  activeSrc: string | null;
  /** True once the image has emitted an onLoad event. */
  isLoaded: boolean;
  /** True if the image emitted an onError event. */
  hasError: boolean;
  /** Call to signal the image loaded successfully. */
  onLoad: () => void;
  /** Call to signal the image failed to load. */
  onError: () => void;
}

/**
 * @param src         Full image URL to lazy-load.
 * @param rootMargin  IntersectionObserver margin; expand to pre-load earlier.
 *                    Defaults to "200px" so images start loading before they
 *                    are fully scrolled into view.
 */
export function useLazyImage(src: string, rootMargin = '200px'): UseLazyImageResult {
  const ref = useRef<HTMLDivElement | null>(null);
  const [activeSrc, setActiveSrc] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Reset state when src changes (e.g. card data refresh).
    setActiveSrc(null);
    setIsLoaded(false);
    setHasError(false);

    const element = ref.current;
    if (!element || !src) return;

    // If IntersectionObserver is not available (SSR/test env fallback), load immediately.
    if (typeof IntersectionObserver === 'undefined') {
      setActiveSrc(src);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActiveSrc(src);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [src, rootMargin]);

  return {
    ref,
    activeSrc,
    isLoaded,
    hasError,
    onLoad: () => setIsLoaded(true),
    onError: () => setHasError(true),
  };
}
