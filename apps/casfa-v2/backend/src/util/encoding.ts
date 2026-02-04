/**
 * Encoding utilities
 *
 * Common encoding/decoding functions used across the application.
 */

// Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Reverse lookup table for decoding
const CROCKFORD_DECODE: Record<string, number> = {};
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!] = i;
}
// Also accept lowercase
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!.toLowerCase()] = i;
}

/**
 * Encode bytes to Crockford Base32
 *
 * Crockford Base32 uses a 32-character alphabet that excludes
 * I, L, O, U to avoid visual ambiguity.
 *
 * @param bytes - Bytes to encode
 * @returns Crockford Base32 encoded string (uppercase)
 */
export const toCrockfordBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >> bits) & 0x1f];
    }
  }

  // Handle remaining bits
  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
};

/**
 * Decode Crockford Base32 to bytes
 *
 * @param encoded - Crockford Base32 encoded string
 * @returns Decoded bytes
 * @throws Error if invalid character found
 */
export const fromCrockfordBase32 = (encoded: string): Uint8Array => {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of encoded) {
    const decoded = CROCKFORD_DECODE[char];
    if (decoded === undefined) {
      throw new Error(`Invalid Crockford Base32 character: ${char}`);
    }

    value = (value << 5) | decoded;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
};

/**
 * Check if a string is valid Crockford Base32
 *
 * @param str - String to validate
 * @returns true if valid Crockford Base32
 */
export const isValidCrockfordBase32 = (str: string): boolean => {
  return /^[0-9A-HJ-NP-TV-Za-hj-np-tv-z]+$/.test(str);
};
