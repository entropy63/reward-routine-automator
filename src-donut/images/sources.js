// The three random-image sources for the visual search: picsum (photos),
// thecatapi (cats), and a locally drawn landscape that needs no network at
// all — a dead image host can never block the step.

import { fetchWithTimeout } from "../queries/sources.js";

export function bytesToBase64(uint8) {
  let binary = "";
  // 4 KB chunks: String.fromCharCode.apply with tens of thousands of arguments
  // overflows the call stack on larger images.
  const chunkSize = 4096;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function downloadImage(url, timeoutMs = 8000) {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  if (!blob.size) throw new Error("empty response body");

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mimeType: blob.type || "image/jpeg"
  };
}

async function fetchPicsumImage() {
  return downloadImage(`https://picsum.photos/600/400.jpg?random=${Date.now()}`);
}

async function fetchCatImage() {
  const res = await fetchWithTimeout(
    "https://api.thecatapi.com/v1/images/search?size=small&mime_types=jpg,png",
    8000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const url = String((Array.isArray(data) && data[0] && data[0].url) || "");

  // The API hands back a CDN URL; make sure it's still on their domain before
  // we fetch it.
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    throw new Error("unexpected payload");
  }
  if (parsed.protocol !== "https:" || !/(^|\.)thecatapi\.com$/i.test(parsed.hostname)) {
    throw new Error(`unexpected image host: ${parsed.hostname}`);
  }

  return downloadImage(url);
}

// Last resort: draw a landscape locally. No network, no host permission,
// always works, so a dead image host can never block the visual search.
async function generateLocalImage() {
  const width = 600;
  const height = 400;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const horizon = height * (0.55 + Math.random() * 0.15);
  const skyHue = 190 + Math.random() * 40;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${skyHue}, 65%, ${35 + Math.random() * 20}%)`);
  sky.addColorStop(1, `hsl(${skyHue + 30}, 70%, 78%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon);

  // Sun
  ctx.fillStyle = `hsla(${40 + Math.random() * 20}, 95%, 70%, 0.9)`;
  ctx.beginPath();
  ctx.arc(
    width * (0.15 + Math.random() * 0.7),
    horizon * (0.2 + Math.random() * 0.5),
    18 + Math.random() * 22,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Mountain ranges, far to near
  const ranges = 3;
  for (let r = 0; r < ranges; r++) {
    const depth = (r + 1) / ranges;
    ctx.fillStyle = `hsl(${skyHue - 10 + r * 12}, ${25 + r * 12}%, ${52 - r * 14}%)`;
    ctx.beginPath();
    ctx.moveTo(0, horizon);

    const peaks = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p <= peaks; p++) {
      ctx.lineTo((width / peaks) * p, horizon - (40 + Math.random() * 90) * depth);
    }

    ctx.lineTo(width, horizon);
    ctx.closePath();
    ctx.fill();
  }

  const groundHue = 95 + Math.random() * 30;
  const ground = ctx.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, `hsl(${groundHue}, 35%, 30%)`);
  ground.addColorStop(1, `hsl(${groundHue}, 40%, 16%)`);
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, width, height - horizon);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mimeType: blob.type || "image/jpeg"
  };
}

const IMAGE_SOURCES = [
  { name: "picsum.photos (photos)", get: fetchPicsumImage },
  { name: "thecatapi.com (cats)", get: fetchCatImage },
  { name: "locally drawn landscape", get: generateLocalImage }
];

// Returns { base64, mimeType, source } or { error } naming every source that
// failed and why, so the popup can say more than "could not fetch".
export async function fetchRandomImageData() {
  const failures = [];

  for (const source of IMAGE_SOURCES) {
    try {
      const data = await source.get();
      if (data && data.base64) return { ...data, source: source.name };
      failures.push(`${source.name}: no data`);
    } catch (e) {
      const reason = (e && e.message) || String(e);
      console.warn(`Image source ${source.name} failed:`, e);
      failures.push(`${source.name}: ${reason}`);
    }
  }

  return { error: failures.join("; ") };
}
