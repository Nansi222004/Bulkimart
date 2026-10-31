import { getStorageConfig } from '../config/storage.js';
import { resolveResponseText } from '../services/mediaUrl.service.js';

/**
 * Resolves media references in every JSON API response (see mediaUrl.service.js).
 * Responses without a private reference — or, when the legacy map is on,
 * without a Cloudinary URL — are sent exactly as express's res.json would.
 * If resolution fails the original body is sent: private references stay
 * opaque and legacy URLs unchanged, so a failure never exposes anything new.
 */
export const mediaResponse = (req, res, next) => {
  res.json = (body) => {
    const text = JSON.stringify(body);
    if (!res.get('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8');
    const legacy = getStorageConfig().legacyReadMap && text?.includes('res.cloudinary.com');
    if (text === undefined || (!text.includes('"media:') && !legacy)) return res.send(text);
    resolveResponseText(text, req)
      .then((resolved) => res.send(resolved))
      .catch((error) => {
        console.warn(`[MEDIA] reference resolution failed (${error.message}); sent unresolved.`);
        res.send(text);
      });
    return res;
  };
  next();
};
