import zlib from 'zlib';

/**
 * Extract files from a ZIP buffer into a Map of { [normalizedFilename]: Buffer }.
 * Supports Store (0) and Deflate (8) compression methods.
 *
 * @param {Buffer} buffer - The raw ZIP file buffer
 * @returns {Map<string, Buffer>} Map of filename -> uncompressed file Buffer
 */
export function extractZip(buffer) {
  const fileMap = new Map();
  let offset = 0;

  while (offset < buffer.length - 30) {
    // Check for Local File Header signature 0x04034b50
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      // Advance by 1 byte if not aligned
      offset++;
      continue;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    let uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLen;
    if (fileNameEnd > buffer.length) break;

    const rawFileName = buffer.toString('utf-8', fileNameStart, fileNameEnd);
    const dataStart = fileNameEnd + extraLen;

    // Handle data descriptors or unknown sizes if bit 3 is set (0x08)
    const flags = buffer.readUInt16LE(offset + 6);
    const hasDataDescriptor = (flags & 0x08) !== 0;

    let compressedDataEnd = dataStart + compressedSize;

    if (hasDataDescriptor && compressedSize === 0) {
      // Find next signature to locate end of data
      let searchOffset = dataStart;
      while (searchOffset < buffer.length - 4) {
        const sig = buffer.readUInt32LE(searchOffset);
        if (sig === 0x08074b50 || sig === 0x04034b50 || sig === 0x02014b50) {
          compressedDataEnd = searchOffset;
          break;
        }
        searchOffset++;
      }
      compressedSize = compressedDataEnd - dataStart;
    }

    if (compressedDataEnd > buffer.length) break;

    // Ignore directory entries (ending with /)
    if (!rawFileName.endsWith('/')) {
      // Clean and normalize filename (strip leading folders if present)
      const cleanFileName = rawFileName.split('/').pop().split('\\').pop().trim();
      const compressedBuffer = buffer.subarray(dataStart, compressedDataEnd);

      let uncompressedBuffer;
      try {
        if (compressionMethod === 0) {
          // Store (no compression)
          uncompressedBuffer = compressedBuffer;
        } else if (compressionMethod === 8) {
          // Deflate
          uncompressedBuffer = zlib.inflateRawSync(compressedBuffer);
        } else {
          // Try standard inflate as fallback
          uncompressedBuffer = zlib.inflateSync(compressedBuffer);
        }

        if (cleanFileName && uncompressedBuffer) {
          fileMap.set(cleanFileName.toLowerCase(), uncompressedBuffer);
          fileMap.set(rawFileName.toLowerCase(), uncompressedBuffer);
        }
      } catch (err) {
        console.warn(`[ZIP Extractor] Warning decompressing ${rawFileName}:`, err.message);
      }
    }

    // Move to next record header
    offset = dataStart + compressedSize;
    if (hasDataDescriptor && buffer.readUInt32LE(offset) === 0x08074b50) {
      offset += 16;
    }
  }

  return fileMap;
}
