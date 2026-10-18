// The in-page photo placement script (docs/design/carousel-v3-requirements.md P1, P2, Q1, Q3).
// A cut-out picture on white used to be moved by a fixed offset per template on top of a prompt
// that already put the subject low and right, so the subject ended up half outside the slide or
// under the text. Now each `img[data-place]` is measured: the subject's box is found on the white
// (pixels clearly darker or more coloured than the page; the faint contact shadow and stray specks
// are left out), and the picture is scaled and moved so that box sits where the placement says,
// as large as it can be without coming closer than GAP px to any line of text. The text is sized
// by fit-text first, and this runs after it (fit-text calls `window.__rcPlace`).
//
// Each picture gets `data-subject` ("x,y,w,h" on the slide), `data-subject-visible` (the share of
// the subject box inside the slide) and, when even the smallest size touches the text,
// `data-photo-overlap` (the slots it touches; a QA blocker). Before it runs, or if it fails, the
// template's own CSS offset stays as the fallback. Plain ES5 so it runs in any page.

export const PLACE_PHOTO_SCRIPT = `(function () {
  var W = 1080, H = 1350, GAP = 28, BLEED = 0.07, MIN_SCALE = 0.3, MAX_SCALE = 1.5;
  // Largest subject box per placement, as a share of the slide.
  var LIMITS = {
    "corner": { w: 0.62, h: 0.7 },
    "top-right": { w: 0.6, h: 0.72 },
    "right-column": { w: 0.5, h: 0.86 },
    "bottom-band": { w: 0.92, h: 0.5 },
    "cover": { w: 0.66, h: 0.76 }
  };

  function subjectBox(img) {
    var cw = 160;
    var ch = Math.max(1, Math.round(img.naturalHeight * cw / img.naturalWidth));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, cw, ch);
    var d = g.getImageData(0, 0, cw, ch).data;
    var cols = [], rows = [], total = 0, x, y;
    for (x = 0; x < cw; x++) cols.push(0);
    for (y = 0; y < ch; y++) rows.push(0);
    for (y = 0; y < ch; y++) {
      for (x = 0; x < cw; x++) {
        var i = (y * cw + x) * 4;
        var r = d[i], gg = d[i + 1], b = d[i + 2];
        var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (255 - (r + gg + b) / 3 > 26 || mx - mn > 24) {
          cols[x]++;
          rows[y]++;
          total++;
        }
      }
    }
    if (total < cw * ch * 0.002) return null;
    function range(arr) {
      var cut = total * 0.01, lo = 0, hi = arr.length - 1, acc = 0;
      while (lo < hi && acc + arr[lo] <= cut) { acc += arr[lo]; lo++; }
      acc = 0;
      while (hi > lo && acc + arr[hi] <= cut) { acc += arr[hi]; hi--; }
      return [lo, hi + 1];
    }
    var xr = range(cols), yr = range(rows), k = img.naturalWidth / cw;
    // The page colour of the picture: its outer ring, where the subject rarely is. The lower
    // quarter of the light, neutral ring pixels decides (light food is coloured and left out),
    // so a vignette or a grey corner is lifted too.
    var ring = [];
    for (y = 0; y < ch; y++) {
      for (x = 0; x < cw; x++) {
        if (x > 5 && x < cw - 6 && y > 5 && y < ch - 6) continue;
        var j = (y * cw + x) * 4;
        var v = (d[j] + d[j + 1] + d[j + 2]) / 3;
        var spread = Math.max(d[j], d[j + 1], d[j + 2]) - Math.min(d[j], d[j + 1], d[j + 2]);
        if (v > 200 && spread <= 14) ring.push(v);
      }
    }
    ring.sort(function (p, q) { return p - q; });
    var paper = ring.length > 0 ? ring[Math.floor(ring.length * 0.25)] : 255;
    return {
      x: xr[0] * k, y: yr[0] * k, w: (xr[1] - xr[0]) * k, h: (yr[1] - yr[0]) * k,
      paper: Math.min(paper, 250)
    };
  }

  // An off-white picture shows as a grey block once it no longer covers the slide: lift its
  // highlights so its page becomes pure white, leaving everything below 80 % as it was.
  var lifts = 0;
  function liftToWhite(img, paper) {
    var p = Math.max(0.85, paper / 255), knee = 0.8, values = [];
    for (var n = 0; n <= 20; n++) {
      var t = n / 20;
      values.push((t <= knee ? t : Math.min(1, knee + (t - knee) * (1 - knee) / (p - knee))).toFixed(4));
    }
    var id = "rc-lift-" + (lifts++);
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("style", "position:absolute");
    var filter = document.createElementNS(ns, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    var transfer = document.createElementNS(ns, "feComponentTransfer");
    var channels = ["feFuncR", "feFuncG", "feFuncB"];
    for (var c = 0; c < 3; c++) {
      var f = document.createElementNS(ns, channels[c]);
      f.setAttribute("type", "table");
      f.setAttribute("tableValues", values.join(" "));
      transfer.appendChild(f);
    }
    filter.appendChild(transfer);
    svg.appendChild(filter);
    document.body.appendChild(svg);
    img.style.filter = "url(#" + id + ")";
  }

  /** Every line of text on the slide, as tight boxes. */
  function textBoxes() {
    var out = [];
    var slots = document.querySelectorAll("[data-slot]");
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      var name = el.getAttribute("data-slot") || "";
      var range = document.createRange();
      range.selectNodeContents(el);
      var rects = range.getClientRects();
      var any = false;
      for (var j = 0; j < rects.length; j++) {
        var r = rects[j];
        if (r.width < 1 || r.height < 1) continue;
        out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, slot: name });
        any = true;
      }
      if (!any) {
        var bb = el.getBoundingClientRect();
        if (bb.width > 0 && bb.height > 0) out.push({ l: bb.left, t: bb.top, r: bb.right, b: bb.bottom, slot: name });
      }
    }
    return out;
  }

  /** Where the subject box goes at scale s for a placement. */
  function boxAt(place, box, s) {
    var w = box.w * s, h = box.h * s;
    var left = W - (1 - BLEED) * w;
    var top;
    if (place === "top-right") top = -BLEED * h;
    else if (place === "right-column") top = Math.min(H - 110 - h, Math.max(96, (H - h) / 2));
    else if (place === "bottom-band") { top = H - (1 - BLEED) * h; left = Math.max(-BLEED * w, (W - w) / 2 + 40); }
    else top = H - (1 - BLEED) * h;
    return { l: left, t: top, r: left + w, b: top + h };
  }

  function hits(box, texts) {
    var names = [];
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      if (box.l < t.r + GAP && box.r > t.l - GAP && box.t < t.b + GAP && box.b > t.t - GAP) {
        if (names.indexOf(t.slot) < 0) names.push(t.slot);
      }
    }
    return names;
  }

  function placeOne(img, texts) {
    var box = subjectBox(img);
    if (!box || box.w < 1 || box.h < 1) return;
    var place = img.getAttribute("data-place") || "corner";
    var lim = LIMITS[place] || LIMITS.corner;
    var top = Math.min(MAX_SCALE, lim.w * W / box.w, lim.h * H / box.h);
    var low = Math.min(MIN_SCALE, top);
    var s;
    if (hits(boxAt(place, box, top), texts).length === 0) s = top;
    else if (hits(boxAt(place, box, low), texts).length > 0) s = low;
    else {
      var a = low, z = top;
      for (var n = 0; n < 24; n++) {
        var m = (a + z) / 2;
        if (hits(boxAt(place, box, m), texts).length === 0) a = m;
        else z = m;
      }
      s = a;
    }
    var at = boxAt(place, box, s);
    liftToWhite(img, box.paper);
    img.style.transform = "none";
    img.style.width = img.naturalWidth * s + "px";
    img.style.height = img.naturalHeight * s + "px";
    img.style.left = at.l - box.x * s + "px";
    img.style.top = at.t - box.y * s + "px";
    var vis = (Math.max(0, Math.min(W, at.r) - Math.max(0, at.l)) * Math.max(0, Math.min(H, at.b) - Math.max(0, at.t))) /
      ((at.r - at.l) * (at.b - at.t));
    img.setAttribute("data-subject", [at.l, at.t, at.r - at.l, at.b - at.t].map(Math.round).join(","));
    img.setAttribute("data-subject-visible", vis.toFixed(3));
    img.setAttribute("data-scale", s.toFixed(3));
    var overlap = hits(at, texts);
    if (overlap.length > 0) img.setAttribute("data-photo-overlap", overlap.join(","));
  }

  window.__rcPlace = function () {
    var imgs = document.querySelectorAll("img[data-place]");
    var waits = [];
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      waits.push(img.decode ? img.decode().then(null, function () {}) : Promise.resolve());
    }
    return Promise.all(waits).then(function () {
      var texts = textBoxes();
      for (var i = 0; i < imgs.length; i++) {
        try {
          if (imgs[i].naturalWidth > 0) placeOne(imgs[i], texts);
        } catch (e) {
          imgs[i].setAttribute("data-place-error", String(e && e.message || e));
        }
      }
    });
  };
})();`;
