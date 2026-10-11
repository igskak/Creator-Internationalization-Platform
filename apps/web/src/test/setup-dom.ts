// Small gaps of jsdom that the base-ui components and the editors touch.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  afterEach(() => {
    try {
      localStorage.clear();
    } catch {
      // No storage in this environment.
    }
  });
}
