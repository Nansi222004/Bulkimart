export const BULK_SHEET_LIMIT = 10 * 1024 * 1024;
export const BULK_ZIP_LIMIT = 50 * 1024 * 1024;
export function bulkFileError(file, kind) {
  if (!file) return kind === 'sheet' ? 'Choose a completed .xlsx or .csv product sheet.' : '';
  if (!(kind === 'sheet' ? /\.(xlsx|csv)$/i : /\.zip$/i).test(file.name)) return kind === 'sheet' ? 'Product sheet must be an .xlsx or .csv file. Old .xls files are not supported.' : 'Product images must be uploaded as a .zip archive.';
  if (!file.size) return 'The selected file is empty. Choose a file containing data.';
  if (file.size > (kind === 'sheet' ? BULK_SHEET_LIMIT : BULK_ZIP_LIMIT)) return kind === 'sheet' ? 'Product sheet must be 10 MB or smaller.' : 'Image ZIP must be 50 MB or smaller.';
  return '';
}
