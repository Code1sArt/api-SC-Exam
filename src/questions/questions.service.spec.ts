import { decodeImportedNewlines } from './questions.service';

describe('decodeImportedNewlines', () => {
  it('converts escaped newline sequences used in imported JSON', () => {
    expect(decodeImportedNewlines('บรรทัดแรก\\nบรรทัดสอง')).toBe(
      'บรรทัดแรก\nบรรทัดสอง',
    );
    expect(decodeImportedNewlines('บรรทัดแรก\\r\\nบรรทัดสอง')).toBe(
      'บรรทัดแรก\nบรรทัดสอง',
    );
  });

  it('preserves newline characters already decoded by JSON.parse', () => {
    expect(decodeImportedNewlines('บรรทัดแรก\nบรรทัดสอง')).toBe(
      'บรรทัดแรก\nบรรทัดสอง',
    );
  });
});
