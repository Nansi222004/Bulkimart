import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';

// Only URLs returned by this request's uploader are passed here. Constrain
// deletion to the seller's upload folder, never arbitrary client-supplied URLs.
export async function removeFailedProductUploads(urls, folder) {
  for (const url of urls) {
    try {
      const pathname = new URL(url, 'http://local.invalid').pathname;
      const localPrefix = `/uploads/${folder}/`;
      if (pathname.startsWith(localPrefix)) {
        const name = pathname.slice(localPrefix.length);
        if (name && name === path.basename(name)) await unlink(path.resolve(import.meta.dirname, '../uploads', folder, name));
      } else if (new URL(url).hostname === 'res.cloudinary.com') {
        const marker = `/nhcone/${folder}/`, offset = pathname.indexOf(marker);
        if (offset >= 0) {
          const id = pathname.slice(offset + 1).replace(/\.[a-z0-9]+$/i, '');
          await cloudinary.uploader.destroy(id, { resource_type: 'image' });
        }
      }
    } catch { console.warn('[PRODUCT] Failed-upload asset cleanup needs retry.'); }
  }
}
