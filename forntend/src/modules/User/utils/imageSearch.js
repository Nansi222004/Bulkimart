import { apiUrl } from '../../../utils/api';
export const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp';
export function validateSearchImage(file, maxBytes = 5 * 1024 * 1024) {
  if (!file || !/\.(jpe?g|png|webp)$/i.test(file.name) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, JPEG, PNG or WEBP image.');
  const ext = file.name.split('.').at(-1).toLowerCase();
  if (file.type !== { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext]) throw new Error('The image filename and file type do not match.');
  if (!file.size || file.size > maxBytes) throw new Error(`Choose an image smaller than ${(maxBytes / 1024 / 1024).toFixed(1)} MiB.`);
}
export async function searchProductsByImage(file, { type, page = 1, signal }) {
  const form = new FormData(); form.append('image', file);
  const token = localStorage.getItem('userToken');
  const response = await fetch(apiUrl(`/api/products/search-by-image?type=${encodeURIComponent(type)}&page=${page}&limit=20`), { method: 'POST', body: form, signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await response.json().catch(() => ({}));
  if (response.status === 503) throw new Error('Image search is not available right now. Please search by name or try again later.');
  if (!response.ok) throw new Error(body.message || 'Image search failed. Please try again.');
  return body;
}
