/**
 * File System Storage Provider
 *
 * Local caching implementation using the file system for Node.js
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { StorageProvider } from "@agent-web-portal/casfa-client";

/**
 * File system based storage provider for caching CAS nodes
 *
 * Directory structure:
 *   {cacheDir}/sha256/{first2chars}/{rest}.bin
 */
export class FileSystemStorageProvider implements StorageProvider {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    // Ensure cache directory exists
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  /**
   * Get file path for a key
   */
  private getPath(key: string): string {
    // key format: "sha256:abc123..."
    const hash = key.replace("sha256:", "");
    const dir = path.join(this.cacheDir, "sha256", hash.slice(0, 2));
    return path.join(dir, `${hash.slice(2)}.bin`);
  }

  /**
   * Store data by key
   */
  async put(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.getPath(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data);
  }

  /**
   * Retrieve data by key
   */
  async get(key: string): Promise<Uint8Array | null> {
    const filePath = this.getPath(key);
    try {
      const data = await fs.promises.readFile(filePath);
      return new Uint8Array(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const filePath = this.getPath(key);
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    const sha256Dir = path.join(this.cacheDir, "sha256");
    try {
      await fs.promises.rm(sha256Dir, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }

  /**
   * Get cache directory
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Get total cached size in bytes
   */
  async getTotalSize(): Promise<number> {
    let total = 0;

    const walkDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile()) {
            const stat = await fs.promises.stat(fullPath);
            total += stat.size;
          }
        }
      } catch {
        // Ignore errors
      }
    };

    await walkDir(this.cacheDir);
    return total;
  }
}
