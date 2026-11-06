import { describe, it, expect } from 'vitest';
import { bagLay } from '../src/ui/data';

describe('site 06.11: free bag flag sg.fb', () => {
  it('sg.fb alone keeps the free bag positions', () => {
    expect(bagLay({ sg: { fb: 1, lay: { b: ['a', '', 'b'] } } } as any)).toEqual(['a', '', 'b']);
    expect(bagLay({ sg: { fb: 1 } } as any)).toEqual([]);
  });
  it('sg.sx still works, classic bag stays packed', () => {
    expect(bagLay({ sg: { sx: 1, lay: { b: ['x'] } } } as any)).toEqual(['x']);
    expect(bagLay({ sg: {} } as any)).toBeNull();
    expect(bagLay(null)).toBeNull();
  });
});
