/**
 * Blob Handler Call Tracker
 *
 * Tracks blob URLs received by handlers for testing purposes.
 * Separated from server.ts to allow importing without starting the server.
 */

export interface BlobHandlerCall {
  toolName: string;
  inputBlobs: Record<string, string>;
  outputBlobs: Record<string, string>;
}

/**
 * Track blob URLs received by handlers (for testing)
 */
export const blobHandlerCalls: BlobHandlerCall[] = [];

/**
 * Clear all tracked calls
 */
export function clearBlobHandlerCalls(): void {
  blobHandlerCalls.length = 0;
}

/**
 * Record a blob handler call
 */
export function recordBlobHandlerCall(call: BlobHandlerCall): void {
  blobHandlerCalls.push(call);
}
