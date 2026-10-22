// Barcode scanning with the phone camera. Chrome on Android has a built-in barcode reader (BarcodeDetector);
// on iPhone the same reader is loaded from a CDN the first time (a WebAssembly build of ZXing).
// Then the barcode is looked up: first in the household's own items, then in Open Food Facts (a free, open
// product database with pictures; coverage of Singapore shelves is patchy, so the app asks for a name when it
// doesn't know one and remembers it for next time).

const POLYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@2.3.1/dist/es/pure.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

let Detector = null;
async function detector() {
  if (!Detector) {
    if ('BarcodeDetector' in globalThis) {
      try {
        const ok = await globalThis.BarcodeDetector.getSupportedFormats();
        if (ok.includes('ean_13')) Detector = globalThis.BarcodeDetector;
      } catch { /* fall through to the polyfill */ }
    }
    if (!Detector) Detector = (await import(POLYFILL)).BarcodeDetector;
  }
  return new Detector({ formats: FORMATS });
}

// Live camera scan into <video>. Resolves with the barcode text, or null if stopped.
export function scanVideo(video) {
  let stop = false, stream = null;
  const done = (async () => {
    const d = await detector();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    while (!stop) {
      try {
        const codes = await d.detect(video);
        if (codes.length) return codes[0].rawValue;
      } catch { /* frame not ready */ }
      await new Promise(r => setTimeout(r, 200));
    }
    return null;
  })().finally(() => { stream?.getTracks().forEach(t => t.stop()); video.srcObject = null; });
  return { done, cancel() { stop = true; } };
}

// Scan a still photo instead (works everywhere a file picker does).
export async function scanFile(file) {
  const d = await detector();
  const bmp = await createImageBitmap(file);
  const codes = await d.detect(bmp);
  return codes[0]?.rawValue || null;
}

// Open Food Facts lookup: { name, brand, size, image } or null.
export async function lookup(code) {
  if (!/^\d{6,14}$/.test(code)) return null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity,image_front_small_url,image_front_url`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = p.product_name_en || p.product_name || '';
    if (!name) return null;
    return { name, brand: (p.brands || '').split(',')[0].trim(), size: p.quantity || '', image: p.image_front_small_url || p.image_front_url || '' };
  } catch { return null; }
}
