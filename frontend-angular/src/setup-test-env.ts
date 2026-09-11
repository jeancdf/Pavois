import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// Initialize Angular TestBed environment
try {
  TestBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
  );
} catch {
  // Prevent re-initialization error if called multiple times
}

// Polyfill Window / Document / LocalStorage for Vitest Node & JSDOM test runner
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

function initLocalStorageMock() {
  if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
    const storageMap = new Map<string, string>();
    const mockStorage: Storage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => { storageMap.set(key, String(value)); },
      removeItem: (key: string) => { storageMap.delete(key); },
      clear: () => { storageMap.clear(); },
      key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
      get length() { return storageMap.size; }
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true
    });
    if ((globalThis as any).window) {
      try {
        (globalThis as any).window.localStorage = mockStorage;
      } catch (e) {}
    }
  }
}

initLocalStorageMock();

export { initLocalStorageMock };

