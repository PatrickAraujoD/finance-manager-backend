import imageSize from 'image-size';
import { TesseractImageExtractor } from '../../../src/infrastructure/extraction/tesseract-image-extractor';

jest.mock('image-size', () => jest.fn(() => ({ width: 10, height: 10 })));

describe('TesseractImageExtractor guards', () => {
  it('only lets image-size look at buffers that carry a PNG or JPEG signature', async () => {
    const extractor = new TesseractImageExtractor();
    const notPngOrJpeg = [
      Buffer.from('GIF89a\x0a\x00\x0a\x00', 'latin1'),
      Buffer.from('II*\x00 padding padding', 'latin1'),
      Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(40),
    ];
    for (const buffer of notPngOrJpeg) {
      expect((await extractor.extract(buffer)).amount).toBeNull();
    }
    expect(imageSize).not.toHaveBeenCalled();
  });
});
