/**
 * Unit tests for ios/utils.ts
 *
 * Tests the convertMediaToDataUris() function.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import fs from 'fs';
import { convertMediaToDataUris } from '../../src/channels/ios/utils';

describe('iOS Utils - convertMediaToDataUris', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ============ undefined / empty input ============

  describe('undefined and empty input', () => {
    it('should return undefined when media is undefined', () => {
      const result = convertMediaToDataUris(undefined);
      expect(result).toBeUndefined();
    });

    it('should return empty array when media is empty array', () => {
      const result = convertMediaToDataUris([]);
      expect(result).toEqual([]);
    });
  });

  // ============ file exists → data URI conversion ============

  describe('successful conversion', () => {
    it('should convert a single image file to data URI', () => {
      const fakeData = Buffer.from('fake-image-data');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(fakeData);

      const media = [
        { type: 'image', filePath: '/path/to/image.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result![0].filePath).toBe(
        `data:image/png;base64,${fakeData.toString('base64')}`
      );
      expect(result![0].type).toBe('image');
      expect(result![0].mimeType).toBe('image/png');
    });

    it('should convert multiple files to data URIs', () => {
      const imageData = Buffer.from('image-bytes');
      const audioData = Buffer.from('audio-bytes');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(imageData)
        .mockReturnValueOnce(audioData);

      const media = [
        { type: 'image', filePath: '/path/to/photo.jpg', mimeType: 'image/jpeg' },
        { type: 'audio', filePath: '/path/to/audio.mp3', mimeType: 'audio/mpeg' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(2);
      expect(result![0].filePath).toContain('data:image/jpeg;base64,');
      expect(result![1].filePath).toContain('data:audio/mpeg;base64,');
    });

    it('should preserve type and mimeType fields in result', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'));

      const media = [
        { type: 'video', filePath: '/video.mp4', mimeType: 'video/mp4' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result![0].type).toBe('video');
      expect(result![0].mimeType).toBe('video/mp4');
    });

    it('should produce valid base64 encoding', () => {
      const testData = Buffer.from('Hello World!');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(testData);

      const media = [
        { type: 'document', filePath: '/doc.txt', mimeType: 'text/plain' },
      ];
      const result = convertMediaToDataUris(media);

      const expectedB64 = testData.toString('base64');
      expect(result![0].filePath).toBe(`data:text/plain;base64,${expectedB64}`);
    });
  });

  // ============ file does not exist ============

  describe('missing files', () => {
    it('should return original media item when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const media = [
        { type: 'image', filePath: '/nonexistent/photo.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(1);
      expect(result![0].filePath).toBe('/nonexistent/photo.png');
    });

    it('should handle mix of existing and non-existing files', () => {
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'));

      const media = [
        { type: 'image', filePath: '/exists.png', mimeType: 'image/png' },
        { type: 'image', filePath: '/missing.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(2);
      expect(result![0].filePath).toContain('data:image/png;base64,');
      expect(result![1].filePath).toBe('/missing.png');
    });
  });

  // ============ error handling ============

  describe('error handling', () => {
    it('should return original item when readFileSync throws', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const media = [
        { type: 'image', filePath: '/protected/file.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(1);
      expect(result![0].filePath).toBe('/protected/file.png');
    });

    it('should handle errors per-item (not fail entire batch)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(Buffer.from('good-data'))
        .mockImplementationOnce(() => {
          throw new Error('Read error');
        });

      const media = [
        { type: 'image', filePath: '/good.png', mimeType: 'image/png' },
        { type: 'image', filePath: '/bad.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(2);
      expect(result![0].filePath).toContain('data:');
      expect(result![1].filePath).toBe('/bad.png');
    });

    it('should return original item when existsSync throws', () => {
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('fs error');
      });

      const media = [
        { type: 'image', filePath: '/crash.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(1);
      expect(result![0].filePath).toBe('/crash.png');
    });
  });

  // ============ edge cases ============

  describe('edge cases', () => {
    it('should handle empty file (zero bytes)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''));

      const media = [
        { type: 'image', filePath: '/empty.png', mimeType: 'image/png' },
      ];
      const result = convertMediaToDataUris(media);

      expect(result).toHaveLength(1);
      expect(result![0].filePath).toBe('data:image/png;base64,');
    });

    it('should handle various mime types', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'));

      const mimeTypes = ['image/png', 'image/jpeg', 'audio/mpeg', 'video/mp4', 'application/pdf'];

      for (const mimeType of mimeTypes) {
        const media = [{ type: 'file', filePath: '/file', mimeType }];
        const result = convertMediaToDataUris(media);
        expect(result![0].filePath).toContain(`data:${mimeType};base64,`);
      }
    });

    it('should not mutate original media array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'));

      const original = [
        { type: 'image', filePath: '/photo.png', mimeType: 'image/png' },
      ];
      const originalPath = original[0].filePath;

      convertMediaToDataUris(original);

      expect(original[0].filePath).toBe(originalPath);
    });
  });
});
