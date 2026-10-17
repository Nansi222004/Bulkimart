export const hasWholesaleAccess = seller => seller?.status === 'approved'
  && seller?.wholesaleChannel?.status === 'approved'
  && seller?.salesChannels?.includes('wholesale') && seller?.userId?.isActive !== false;

export const eligibleWholesaleProduct = product => !!product && ['ecommerce', 'grocery'].includes(product.type)
  && product.fulfillmentType !== 'digital' && !product.isDeleted && product.status === 'approved'
  && product.isActive === true && !!product.category && product.category?.isActive !== false;

export const eligibleWholesaleVariant = (product, variant) => eligibleWholesaleProduct(product)
  && !!variant?._id && Number.isSafeInteger(variant.stock) && variant.stock > 0;
