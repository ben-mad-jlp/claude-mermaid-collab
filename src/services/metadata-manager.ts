import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Metadata, ItemMetadata } from '../types';
import { config } from '../config';

export class MetadataManager {
  private metadata: Metadata = { folders: [], items: {} };
  private dirty = false;

  async initialize(): Promise<void> {
    if (existsSync(config.METADATA_FILE)) {
      try {
        const content = await readFile(config.METADATA_FILE, 'utf-8');
        this.metadata = JSON.parse(content);
      } catch (error) {
        console.error('Failed to load metadata, using defaults:', error);
        this.metadata = { folders: [], items: {} };
      }
    }
  }

  private async save(): Promise<void> {
    await writeFile(config.METADATA_FILE, JSON.stringify(this.metadata, null, 2), 'utf-8');
    this.dirty = false;
  }

  getMetadata(): Metadata {
    return this.metadata;
  }

  getItemMetadata(id: string): ItemMetadata {
    return this.metadata.items[id] || { folder: null, locked: false };
  }

  async setItemFolder(id: string, folder: string | null): Promise<void> {
    if (folder !== null && !this.metadata.folders.includes(folder)) {
      throw new Error(`Folder "${folder}" does not exist`);
    }

    if (!this.metadata.items[id]) {
      this.metadata.items[id] = { folder: null, locked: false };
    }
    this.metadata.items[id].folder = folder;
    await this.save();
  }

  async setItemLocked(id: string, locked: boolean): Promise<void> {
    if (!this.metadata.items[id]) {
      this.metadata.items[id] = { folder: null, locked: false };
    }
    this.metadata.items[id].locked = locked;
    await this.save();
  }

  async updateItem(id: string, updates: Partial<ItemMetadata>): Promise<void> {
    if (!this.metadata.items[id]) {
      this.metadata.items[id] = { folder: null, locked: false };
    }

    if (updates.folder !== undefined) {
      if (updates.folder !== null && !this.metadata.folders.includes(updates.folder)) {
        throw new Error(`Folder "${updates.folder}" does not exist`);
      }
      this.metadata.items[id].folder = updates.folder;
    }

    if (updates.locked !== undefined) {
      this.metadata.items[id].locked = updates.locked;
    }

    await this.save();
  }

  isLocked(id: string): boolean {
    return this.metadata.items[id]?.locked || false;
  }

  async createFolder(name: string): Promise<void> {
    if (this.metadata.folders.includes(name)) {
      throw new Error(`Folder "${name}" already exists`);
    }
    this.metadata.folders.push(name);
    await this.save();
  }

  async renameFolder(oldName: string, newName: string): Promise<void> {
    const index = this.metadata.folders.indexOf(oldName);
    if (index === -1) {
      throw new Error(`Folder "${oldName}" not found`);
    }
    if (this.metadata.folders.includes(newName)) {
      throw new Error(`Folder "${newName}" already exists`);
    }

    this.metadata.folders[index] = newName;

    // Update all items in the old folder
    for (const [id, item] of Object.entries(this.metadata.items)) {
      if (item.folder === oldName) {
        item.folder = newName;
      }
    }

    await this.save();
  }

  async deleteFolder(name: string, moveItemsToRoot = true): Promise<void> {
    const index = this.metadata.folders.indexOf(name);
    if (index === -1) {
      throw new Error(`Folder "${name}" not found`);
    }

    // Check for items in folder
    const itemsInFolder = Object.entries(this.metadata.items)
      .filter(([, item]) => item.folder === name);

    if (itemsInFolder.length > 0 && !moveItemsToRoot) {
      throw new Error(`Folder "${name}" is not empty`);
    }

    // Move items to root
    for (const [id] of itemsInFolder) {
      this.metadata.items[id].folder = null;
    }

    this.metadata.folders.splice(index, 1);
    await this.save();
  }

  getFolders(): string[] {
    return [...this.metadata.folders];
  }

  getItemsInFolder(folder: string | null): string[] {
    return Object.entries(this.metadata.items)
      .filter(([, item]) => item.folder === folder)
      .map(([id]) => id);
  }

  async removeItem(id: string): Promise<void> {
    if (this.metadata.items[id]) {
      delete this.metadata.items[id];
      await this.save();
    }
  }
}
