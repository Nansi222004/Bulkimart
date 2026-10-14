// Shared ES module for the service APIs and React; unrelated limits stay intact.
export const SERVICE_TEXT_CHARS = 10000;
export const SERVICE_ANSWER_BYTES = 256 * 1024;
export const SERVICE_MULTIPART_FIELD_BYTES = SERVICE_ANSWER_BYTES + 1024;
export const SERVICE_FILE_BYTES = 5 * 1024 * 1024;
export const SERVICE_FILE_COUNT = 10;
export const SERVICE_REQUEST_BYTES = SERVICE_FILE_COUNT * SERVICE_FILE_BYTES + SERVICE_ANSWER_BYTES + 64 * 1024;
export const serializedAnswerBytes = answers => new TextEncoder().encode(JSON.stringify(answers)).byteLength;
