/**
 * File Tools — Read BizTalk artifacts from disk
 *
 * Enables file-based workflows where Claude reads artifact files
 * from the local filesystem rather than requiring the user to
 * paste XML content manually.
 *
 * Transport: local filesystem only — satisfies data privacy requirement.
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { existsSync } from 'fs';

// Supported BizTalk artifact extensions
const SUPPORTED_EXTENSIONS = new Set(['.odx', '.btm', '.btp', '.xml', '.xsd', '.json']);

export interface ReadArtifactResult {
  content: string;
  filePath: string;
  encoding: string;
  sizeBytes: number;
}

export interface ArtifactInventory {
  orchestrations: string[];  // .odx files
  maps: string[];            // .btm files
  pipelines: string[];       // .btp files
  bindings: string[];        // .xml files with 'binding' in name
  schemas: string[];         // .xsd files
  other: string[];           // other .xml or .json files
}

/**
 * Read a BizTalk artifact file from disk.
 * Returns the raw file content as a UTF-8 string.
 */
export async function readArtifact(filePath: string): Promise<ReadArtifactResult> {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file extension "${ext}". Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`
    );
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf-8');
  const stats = await stat(filePath);

  return {
    content,
    filePath,
    encoding: 'utf-8',
    sizeBytes: stats.size,
  };
}

/**
 * Scan a directory for BizTalk artifact files.
 * Returns categorized lists of file paths.
 */
export async function listArtifacts(
  directoryPath: string,
  recursive: boolean = false
): Promise<ArtifactInventory> {
  if (!existsSync(directoryPath)) {
    throw new Error(`Directory not found: ${directoryPath}`);
  }

  const inventory: ArtifactInventory = {
    orchestrations: [],
    maps: [],
    pipelines: [],
    bindings: [],
    schemas: [],
    other: [],
  };

  await scanDirectory(directoryPath, recursive, inventory);

  // Sort all arrays for deterministic output
  for (const key of Object.keys(inventory) as (keyof ArtifactInventory)[]) {
    inventory[key].sort();
  }

  return inventory;
}

async function scanDirectory(
  dir: string,
  recursive: boolean,
  inventory: ArtifactInventory
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory() && recursive) {
      await scanDirectory(fullPath, recursive, inventory);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(entry.name).toLowerCase();
    const name = basename(entry.name).toLowerCase();

    switch (ext) {
      case '.odx':
        inventory.orchestrations.push(fullPath);
        break;
      case '.btm':
        inventory.maps.push(fullPath);
        break;
      case '.btp':
        inventory.pipelines.push(fullPath);
        break;
      case '.xsd':
        inventory.schemas.push(fullPath);
        break;
      case '.xml':
        if (name.includes('binding') || name.includes('bindinginfo')) {
          inventory.bindings.push(fullPath);
        } else {
          inventory.other.push(fullPath);
        }
        break;
      case '.json':
        inventory.other.push(fullPath);
        break;
    }
  }
}
