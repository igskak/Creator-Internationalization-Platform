// The in-page fit-text script (plan 08 §8.6, "fit-text.client.js"). For each `[data-fit]` element it
// starts at `data-fit-max` px and lowers the size by 2 px while the text overflows its fixed box
// and the size is above `data-fit-min`. Text that still overflows at the minimum gets
// `data-overflow="true"`. It waits for the fonts and sets `data-fit-done` on <html> when it has
// finished; the renderer waits for that attribute. Deterministic: fonts and viewport are fixed.
//
// Kept as a plain ES5 string so that it runs in any page and can be tested with a stub DOM.

export const FIT_TEXT_SCRIPT = `(function () {
  var STEP = 2;
  function overflows(el) {
    return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  }
  function fit() {
    var nodes = document.querySelectorAll("[data-fit]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var max = Number(el.getAttribute("data-fit-max"));
      var min = Number(el.getAttribute("data-fit-min"));
      var size = max;
      el.style.fontSize = size + "px";
      while (size > min && overflows(el)) {
        size = Math.max(min, size - STEP);
        el.style.fontSize = size + "px";
      }
      if (overflows(el)) el.setAttribute("data-overflow", "true");
      el.setAttribute("data-font-px", String(size));
    }
    document.documentElement.setAttribute("data-fit-done", "true");
  }
  window.__rcFit = fit;
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(fit, fit);
})();`;
