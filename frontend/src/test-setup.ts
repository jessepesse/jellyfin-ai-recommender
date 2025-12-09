import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock localStorage and sessionStorage for jsdom
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
        get length() {
            return Object.keys(store).length;
        },
        key: vi.fn((index: number) => Object.keys(store)[index] || null),
    };
})();

Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
});

Object.defineProperty(globalThis, 'sessionStorage', {
    value: localStorageMock,
});
