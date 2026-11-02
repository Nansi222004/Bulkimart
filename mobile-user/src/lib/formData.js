import { File } from 'expo-file-system';

/**
 * Appends a file to a FormData instance in a way compatible with modern Expo SDK 52+ / 58+
 * (which requires File or Blob with native .bytes() implementation) as well as legacy
 * React Native environments.
 */
export async function appendFormFile(form, fieldName, fileOrAsset) {
  if (!form || !fileOrAsset) return;
  const uri = typeof fileOrAsset === 'string' ? fileOrAsset : fileOrAsset.uri;
  const name = fileOrAsset.name || fileOrAsset.fileName || `upload_${Date.now()}.jpg`;
  const type = fileOrAsset.type || fileOrAsset.mimeType || 'image/jpeg';

  // 1. Modern Expo File class (implements Blob & native .bytes())
  try {
    if (File && uri) {
      form.append(fieldName, new File(uri));
      return;
    }
  } catch {}

  // 2. Fetch Blob fallback
  try {
    if (uri) {
      const res = await fetch(uri);
      const blob = await res.blob();
      if (blob) {
        form.append(fieldName, blob, name);
        return;
      }
    }
  } catch {}

  // 3. Legacy React Native object fallback
  form.append(fieldName, { uri, name, type });
}
