import { describe, it, expect } from 'vitest';
// @ts-ignore — plain ESM script
import { absolutize, linked } from '../scripts/release-notes.mjs';

describe('release notes screenshots', () => {
  const md = 'x ![Лагерь](docs/releases/0.4.3/camp.jpg) y ![a](https://example.com/a.png) [link](docs/README.md)';
  it('rewrites only relative screenshot links to raw URLs at the tag', () => {
    expect(absolutize(md, 'o/r', 'v0.4.3')).toBe('x ![Лагерь](https://raw.githubusercontent.com/o/r/v0.4.3/docs/releases/0.4.3/camp.jpg) y ![a](https://example.com/a.png) [link](docs/README.md)');
  });
  it('lists linked screenshots', () => { expect(linked(md)).toEqual(['docs/releases/0.4.3/camp.jpg']); });
});
