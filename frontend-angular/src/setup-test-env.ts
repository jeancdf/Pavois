import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

// Resets TestBed after each test so a second configureTestingModule
// in the same file (and parallel files on CI) does not throw.
setupTestBed();

function initLocalStorageMock(): void {
  const existing = globalThis.localStorage;
  if (existing && typeof existing.getItem === 'function') {
    return;
  }
  const storageMap = new Map<string, string>();
  const mockStorage: Storage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
}

initLocalStorageMock();
