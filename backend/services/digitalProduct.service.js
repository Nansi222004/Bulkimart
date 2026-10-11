import { httpError } from '../utils/response.js';

export const assertEbookUploadOwnership = (product, sellerId) => {
  if (!product || product.fulfillmentType !== 'digital'
    || String(product.sellerId) !== String(sellerId)) {
    throw httpError(404, 'E-book listing not found');
  }
};

export const assertEbookReadyForApproval = (product) => {
  const file = product?.digital?.file;
  if (!product?.digital?.author?.trim() || !product?.digital?.language?.trim()
    || product.digital.format !== 'pdf' || file?.status !== 'uploaded'
    || !file?.fileId || String(file.productId) !== String(product._id)
    || String(file.ownerSellerId) !== String(product.sellerId) || !(file.sizeBytes > 0)) {
    throw httpError(400, 'This e-book is incomplete. Verify its metadata and private PDF upload before approval.');
  }
};
