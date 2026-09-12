export const MAX_SCREENSHOTS = 4;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024;
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function validateScreenshots(files, maxBytes = MAX_SCREENSHOT_BYTES) {
  if (files.length > MAX_SCREENSHOTS) return 'スクリーンショットは4枚まで添付できます。';
  if (files.reduce((sum, file) => sum + file.size, 0) > maxBytes) {
    return maxBytes === MAX_SOURCE_IMAGE_BYTES ? '元画像は1枚32MiB以内にしてください。'
      : 'スクリーンショットは変換後の合計8MiB以内にしてください。';
  }
  for (const file of files) {
    if (!SCREENSHOT_TYPES.includes(file.type) || !file.size || typeof file.slice !== 'function') {
      return 'PNG・JPEG・WebP形式の画像を選択してください。';
    }
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const matches = (signature, offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);
    const valid = file.type === 'image/png' ? matches([137, 80, 78, 71, 13, 10, 26, 10])
      : file.type === 'image/jpeg' ? matches([255, 216, 255])
        : matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8);
    if (!valid) return '画像の内容と形式が一致しません。PNG・JPEG・WebPの画像を選び直してください。';
  }
  return '';
}

// Re-encode the user's real screenshot; never reconstruct the app's DOM.
export async function prepareScreenshot(file, doc = document) {
  const error = await validateScreenshots([file], MAX_SOURCE_IMAGE_BYTES);
  if (error) throw new Error(error);
  const image = new doc.defaultView.Image();
  const url = URL.createObjectURL(file);
  let canvas;
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('画像を読み込めませんでした。別の画像を選択してください。'));
      image.src = url;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('画像のサイズを取得できませんでした。');
    canvas = doc.createElement('canvas');
    let scale = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
    const encode = (type, quality) => new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を変換できませんでした。')), type, quality);
    });
    const targetBytes = MAX_SCREENSHOT_BYTES / MAX_SCREENSHOTS;
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像変換に必要なメモリーを確保できませんでした。');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.94, 0.86, 0.78]) {
        let encoded = await encode('image/webp', quality);
        if (encoded.type !== 'image/webp' && encoded.size > targetBytes) {
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = 'source-over';
          encoded = await encode('image/jpeg', quality);
        }
        if (scale === 1 && file.size <= targetBytes && file.size <= encoded.size) return file;
        if (encoded.size <= targetBytes) return encoded;
      }
      if (Math.max(canvas.width, canvas.height) <= 1600) break;
      scale *= 0.8;
    }
    throw new Error('画像を送信可能な容量にできませんでした。必要な部分を切り抜いて添付してください。');
  } finally {
    URL.revokeObjectURL(url);
    image.src = '';
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function screenshotName(file, index) {
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
  return `screenshot-${index + 1}.${extension}`;
}
