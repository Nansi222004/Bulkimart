// Four photos stay below 1 MiB together, including multipart overhead and text.
// Keep the existing 5 MB selection limit; resize only the bytes being uploaded.
export const REVIEW_PHOTO_UPLOAD_BYTES = 192 * 1024;

export async function prepareReviewPhoto(file) {
  if (file.size <= REVIEW_PHOTO_UPLOAD_BYTES) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not read a review photo. Please choose another image.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare review photos. Please try another browser.');
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    while (true) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) throw new Error('Could not prepare a review photo. Please choose another image.');
      if (blob.size <= REVIEW_PHOTO_UPLOAD_BYTES) {
        return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
      }
      if (width === 1 && height === 1) throw new Error('Could not resize a review photo. Please choose another image.');
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
