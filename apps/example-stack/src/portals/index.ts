/**
 * Portal exports
 */

export { authPortal } from "./auth.ts";
export { basicPortal } from "./basic.ts";
export {
  type BlobHandlerCall,
  blobPortal,
  clearBlobHandlerCalls,
  createOutputBlobSlot,
  getBlobHandlerCalls,
  getStoredImage,
  getTempUpload,
  listStoredImages,
  readOutputBlob,
  recordBlobHandlerCall,
  storeImage,
  storeTempUpload,
  writeOutputBlob,
} from "./blob.ts";
export { ecommercePortal } from "./ecommerce.ts";
export { imageWorkshopPortal } from "./image-workshop/index.ts";
export { jsonataPortal } from "./jsonata.ts";
