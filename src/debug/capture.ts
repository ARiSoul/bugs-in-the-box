/**
 * Saves the canvas as a PNG through the dev server (`vite.config.ts` writes it to `captures/<name>.png`).
 * Dev only: call it right after a frame is drawn, in the same task (a WebGPU canvas only keeps its
 * image until the task ends).
 */
export function captureCanvas(canvas: HTMLCanvasElement, name: string, jpeg = false): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('empty canvas'));
        return;
      }
      fetch(`/__capture?name=${encodeURIComponent(jpeg ? `${name}.jpg` : name)}`, { method: 'POST', body: blob })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`capture failed: ${r.status}`))))
        .then(resolve, reject);
    }, jpeg ? 'image/jpeg' : 'image/png', 0.92);
  });
}
