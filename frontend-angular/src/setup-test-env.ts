import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import '@analogjs/vitest-angular/setup-serializers';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

// Resets TestBed after each test so a second configureTestingModule
// in the same file (and parallel files on CI) does not throw.
setupTestBed();

function installStorageMock(name: 'localStorage' | 'sessionStorage'): void {
  const existing = globalThis[name];
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
  Object.defineProperty(globalThis, name, {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
}

installStorageMock('localStorage');
installStorageMock('sessionStorage');
