import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import {
  defaultInnerFireConfig,
  normalizeInnerFireConfig,
} from '@/lib/fire/config';
import {
  exportFireConfig,
  importFireConfigFromInput,
} from './fire-settings-io';

class MockFileReader {
  onload: ((event: { target?: { result?: string } }) => void) | null = null;

  static nextResult = '';

  readAsText() {
    this.onload?.({
      target: {
        result: MockFileReader.nextResult,
      },
    });
  }
}

describe('exportFireConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a downloadable JSON file for the current config', () => {
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(tagName => {
        if (tagName === 'a') {
          return anchor;
        }

        return originalCreateElement(tagName);
      });
    const createObjectURLMock = vi.fn((_blob: Blob) => 'blob:ascuita-test');
    const revokeObjectURLMock = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLMock,
    });

    exportFireConfig(defaultInnerFireConfig);

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(createObjectURLMock).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('ascuita-fire-config.json');
    expect(anchor.href).toBe('blob:ascuita-test');
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:ascuita-test');

    const blob = createObjectURLMock.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  });
});

describe('importFireConfigFromInput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads, normalizes and returns the imported config', () => {
    vi.stubGlobal('FileReader', MockFileReader);
    MockFileReader.nextResult = JSON.stringify({
      transform: { x: 1.5 },
      bloom: { strength: 2.2 },
    });

    const onConfigLoaded = vi.fn();
    const event = {
      target: {
        files: [new File(['{}'], 'fire-config.json', { type: 'application/json' })],
        value: 'C:\\fakepath\\fire-config.json',
      },
    } as unknown as ChangeEvent<HTMLInputElement>;

    importFireConfigFromInput(event, onConfigLoaded);

    expect(onConfigLoaded).toHaveBeenCalledOnce();
    expect(onConfigLoaded).toHaveBeenCalledWith(
      normalizeInnerFireConfig({
        transform: { x: 1.5 },
        bloom: { strength: 2.2 },
      })
    );
    expect(event.target.value).toBe('');
  });

  it('does nothing when no file is selected', () => {
    const onConfigLoaded = vi.fn();
    const event = {
      target: {
        files: [],
        value: '',
      },
    } as unknown as ChangeEvent<HTMLInputElement>;

    importFireConfigFromInput(event, onConfigLoaded);

    expect(onConfigLoaded).not.toHaveBeenCalled();
  });

  it('logs an error and skips the callback when the file is invalid JSON', () => {
    vi.stubGlobal('FileReader', MockFileReader);
    MockFileReader.nextResult = '{not-valid-json';

    const onConfigLoaded = vi.fn();
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const event = {
      target: {
        files: [new File(['{}'], 'fire-config.json', { type: 'application/json' })],
        value: 'C:\\fakepath\\fire-config.json',
      },
    } as unknown as ChangeEvent<HTMLInputElement>;

    importFireConfigFromInput(event, onConfigLoaded);

    expect(onConfigLoaded).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(event.target.value).toBe('');
  });
});
