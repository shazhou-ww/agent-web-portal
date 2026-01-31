/**
 * CasMarkdown Component
 *
 * A Markdown renderer that automatically resolves cas:// URLs in images
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components, UrlTransform } from "react-markdown";
import { CasImage } from "./CasImage";
import { isCasUri } from "../contexts/CasContext";

export interface CasMarkdownProps {
  /** The markdown content to render */
  children: string;
  /** Additional components to override */
  components?: Components;
  /** Class name for the container */
  className?: string;
}

/** @deprecated Use CasMarkdownProps instead */
export type BlobMarkdownProps = CasMarkdownProps;

/**
 * Custom URL transform that allows cas:// URLs
 * By default, react-markdown sanitizes URLs and removes non-http(s) protocols
 */
const allowCasUrlTransform: UrlTransform = (url: string) => {
  // Allow cas:// URLs through without modification
  if (url.startsWith("cas://")) {
    return url;
  }
  // Allow http(s) URLs
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/")) {
    return url;
  }
  // Allow data URLs
  if (url.startsWith("data:")) {
    return url;
  }
  // Default: allow the URL as-is (could also return empty string to block)
  return url;
};

/**
 * CasMarkdown - Renders markdown with automatic CAS URL resolution for images
 *
 * Usage:
 * ```tsx
 * <CasMarkdown>
 *   Here is an image: ![Generated](cas://sha256:abc123...)
 * </CasMarkdown>
 * ```
 */
export function CasMarkdown({
  children,
  components,
  className,
}: CasMarkdownProps) {
  // Create custom components that handle CAS URLs
  const casComponents: Components = {
    // Override img to use CasImage for cas:// URLs
    img: ({ src, alt, node, ...props }) => {
      // Handle case where src might be an object
      let resolvedSrc = src;
      if (typeof src === "object" && src !== null) {
        const srcObj = src as { uri?: string; url?: string; "cas-node"?: string };
        resolvedSrc = srcObj["cas-node"] || srcObj.uri || srcObj.url || "";
        // If it's a cas-node without prefix, add it
        if (resolvedSrc && !resolvedSrc.startsWith("cas://") && resolvedSrc.startsWith("sha256:")) {
          resolvedSrc = `cas://${resolvedSrc}`;
        }
      }
      
      if (resolvedSrc && typeof resolvedSrc === "string" && isCasUri(resolvedSrc)) {
        return <CasImage src={resolvedSrc} alt={alt} />;
      }
      // Regular image
      return (
        <img
          src={typeof resolvedSrc === "string" ? resolvedSrc : ""}
          alt={alt}
          style={{ maxWidth: "100%", borderRadius: 8 }}
          {...props}
        />
      );
    },
    // Merge with user-provided components
    ...components,
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={casComponents}
      urlTransform={allowCasUrlTransform}
      className={className}
    >
      {children}
    </ReactMarkdown>
  );
}

/** @deprecated Use CasMarkdown instead */
export const BlobMarkdown = CasMarkdown;

/**
 * Helper to extract CAS URIs from markdown content
 */
export function extractCasUris(content: string): string[] {
  const uris: string[] = [];
  
  // Match markdown image syntax: ![alt](cas://...)
  const casImageRegex = /!\[([^\]]*)\]\((cas:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = casImageRegex.exec(content)) !== null) {
    if (match[2]) {
      uris.push(match[2]);
    }
  }

  return uris;
}

/** @deprecated Use extractCasUris instead */
export const extractBlobUris = extractCasUris;
