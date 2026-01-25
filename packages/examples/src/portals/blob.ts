/**
 * Blob Portal
 *
 * Demonstrates blob handling with file upload/download functionality.
 */

import { blob, createAgentWebPortal } from "@agent-web-portal/core";
import { z } from "zod";

// =============================================================================
// Blob Handler Call Tracking (for testing)
// =============================================================================

export interface BlobHandlerCall {
  toolName: string;
  inputBlobs: Record<string, string>;
  outputBlobs: Record<string, string>;
}

const blobHandlerCalls: BlobHandlerCall[] = [];

export function recordBlobHandlerCall(call: BlobHandlerCall): void {
  blobHandlerCalls.push(call);
}

export function getBlobHandlerCalls(): BlobHandlerCall[] {
  return blobHandlerCalls;
}

export function clearBlobHandlerCalls(): void {
  blobHandlerCalls.length = 0;
}

// =============================================================================
// Schemas
// =============================================================================

const ProcessDocumentInputSchema = z.object({
  document: blob({ mimeType: "application/pdf", description: "PDF document to process" }),
  quality: z.number().min(1).max(100).default(80).describe("Output quality (1-100)"),
});

const ProcessDocumentOutputSchema = z.object({
  thumbnail: blob({ mimeType: "image/png", description: "Generated thumbnail" }),
  pageCount: z.number().describe("Number of pages in the document"),
  processedAt: z.string().describe("Processing timestamp"),
});

// =============================================================================
// Portal Definition
// =============================================================================

export const blobPortal = createAgentWebPortal({
  name: "blob-portal",
  version: "1.0.0",
  description: "Portal with blob-enabled tools for testing",
})
  .registerTool("process_document", {
    inputSchema: ProcessDocumentInputSchema,
    outputSchema: ProcessDocumentOutputSchema,
    description: "Process a PDF document and generate a thumbnail",
    handler: async ({ quality }, context) => {
      // Record the blob URLs for testing
      recordBlobHandlerCall({
        toolName: "process_document",
        inputBlobs: context?.blobs.input ?? {},
        outputBlobs: context?.blobs.output ?? {},
      });

      // Simulate document processing
      return {
        pageCount: 10,
        processedAt: new Date().toISOString(),
        // thumbnail placeholder - will be overwritten by framework with permanent URI
        thumbnail: "",
      };
    },
  })
  .registerTool("simple_tool", {
    inputSchema: z.object({
      message: z.string().describe("A simple message"),
    }),
    outputSchema: z.object({
      echo: z.string().describe("The echoed message"),
    }),
    description: "A simple tool without blobs",
    handler: async ({ message }) => ({
      echo: `Echo: ${message}`,
    }),
  })
  .build();
