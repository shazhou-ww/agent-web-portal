/**
 * CasImage Component
 *
 * Renders images from cas:// URIs by fetching them from CAS
 */

import { useState, useEffect } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { BrokenImage } from "@mui/icons-material";
import { useCas, parseCasUri } from "../contexts/CasContext";

export interface CasImageProps {
  /** The CAS URI (e.g., cas://sha256:abc123...) */
  src: string;
  /** Alt text for the image */
  alt?: string;
  /** Optional CSS styles */
  style?: React.CSSProperties;
  /** Optional class name */
  className?: string;
}

/**
 * CasImage component that fetches and displays images from CAS
 */
export function CasImage({ src, alt, style, className }: CasImageProps) {
  const { fetchCasContent, isAuthenticated, casEndpoint } = useCas();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadImage() {
      // Parse the CAS URI
      const key = parseCasUri(src);
      if (!key) {
        setError("Invalid CAS URI");
        setLoading(false);
        return;
      }

      // Check if we can fetch
      if (!casEndpoint) {
        setError("CAS not configured");
        setLoading(false);
        return;
      }

      if (!isAuthenticated) {
        setError("CAS not authenticated");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        console.log("[CasImage] Fetching:", src);
        const result = await fetchCasContent(key);

        if (cancelled) return;

        if (!result) {
          setError("Failed to load image");
          setLoading(false);
          return;
        }

        // Create a blob URL from the data
        const blob = new Blob([new Uint8Array(result.data)], { type: result.contentType });
        objectUrl = URL.createObjectURL(blob);

        console.log("[CasImage] Created blob URL:", objectUrl, "contentType:", result.contentType);

        if (!cancelled) {
          setBlobUrl(objectUrl);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[CasImage] Failed to load image:", err);
          setError(err instanceof Error ? err.message : "Failed to load image");
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      cancelled = true;
      // Revoke the blob URL when component unmounts or src changes
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src, fetchCasContent, isAuthenticated, casEndpoint]);

  // Clean up blob URL when it changes
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  if (loading) {
    return (
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 100,
          minHeight: 100,
          bgcolor: "grey.100",
          borderRadius: 1,
        }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error || !blobUrl) {
    return (
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 100,
          minHeight: 100,
          bgcolor: "grey.100",
          borderRadius: 1,
          p: 1,
        }}
      >
        <BrokenImage color="disabled" />
        <Typography component="span" variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          {error || "Image not available"}
        </Typography>
      </Box>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt || "CAS image"}
      style={{
        maxWidth: "100%",
        borderRadius: 8,
        ...style,
      }}
      className={className}
    />
  );
}
