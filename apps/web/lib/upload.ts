'use client';

import { api } from './api';

/**
 * Downscale an image client-side (cap the longest side, keep aspect ratio) and
 * upload it to the shared /assets store. Returns a public URL to embed.
 * Keeps stored images at sensible "best pixels" so blog pages stay light.
 */
export async function resizeAndUpload(file: File, maxDim = 1600, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

  // SVGs can't be rasterised meaningfully — upload as-is.
  const isSvg = file.type === 'image/svg+xml';
  let mimeType = file.type;
  let out = dataUrl;

  if (!isSvg) {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Could not load the image.'));
      im.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      // Preserve transparency for PNGs; use JPEG for photos to keep size down.
      const hasAlpha = file.type === 'image/png';
      mimeType = hasAlpha ? 'image/png' : 'image/jpeg';
      out = canvas.toDataURL(mimeType, quality);
    }
  }

  const res = await api.post<{ id: string; url: string }>('/assets', {
    filename: file.name,
    mimeType,
    dataBase64: out,
  });
  // Same-origin path (proxied to the API by a Next rewrite), so the image loads
  // on both the admin and the marketing site without depending on APP_PUBLIC_URL.
  return `/media/assets/${res.id}`;
}
