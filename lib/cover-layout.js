// Shared responsive cover framing. Original image stays intact in Storage.
(function(root) {
  'use strict';
  function normalize(value) {
    const n = (key, fallback, min, max) => {
      const raw = value?.[key];
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : fallback;
    };
    return { zoom: n('zoom', 1, 1, 3), x: n('x', 50, 0, 100), y: n('y', 50, 0, 100) };
  }
  function apply(image, value) {
    if (!image) return;
    const p = normalize(value);
    image.style.objectPosition = `${p.x}% ${p.y}%`;
    image.style.transformOrigin = `${p.x}% ${p.y}%`;
    image.style.transform = `scale(${p.zoom})`;
  }
  root.CoverLayout = Object.freeze({normalize, apply});
})(typeof window === 'undefined' ? globalThis : window);
