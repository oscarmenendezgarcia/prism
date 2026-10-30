import { describe, it, expect } from 'vitest';
import { plainText } from '../../src/utils/plainText';

describe('plainText', () => {
  it.each([
    ['**hola** y *adiós*', 'hola y adiós'],
    ['__hola__ y _adiós_', 'hola y adiós'],
    ['~~old~~ new', 'old new'],
    ['**bold\nwrapped**', 'bold wrapped'],
    ['# Title\n\nBody', 'Title · Body'],
    ['Title\n===\n\nBody', 'Title · Body'],
    ['- one\n- two\n* three\n+ four', 'one · two · three · four'],
    ['1. one\n2) two', 'one · two'],
    ['- [ ] todo\n- [x] done', 'todo · done'],
    ['1. [ ] first\n2. [x] second', 'first · second'],
    ['> quoted', 'quoted'],
    ['para\n\n> quote', 'para · quote'],
    ['> # H\n\nbody', 'H · body'],
    ['one line\nwrapped', 'one line wrapped'],
    ['first\n\n\nsecond', 'first · second'],
    ['first\r\n\r\nsecond', 'first · second'],
    ['[the docs](https://x.dev/a) here', 'the docs here'],
    ['[link](https://en.wikipedia.org/wiki/Foo_(bar)) tail', 'link tail'],
    ['[ref][1] text\n\n[1]: https://x.dev', 'ref text'],
    ['<https://x.dev/a>', 'https://x.dev/a'],
    ['![a chart](c.png) below', 'a chart below'],
    ['run `npm test` now', 'run npm test now'],
    ['above\n\n---\n\nbelow', 'above · below'],
    ['| Field | Type |\n|---|---|\n| id | int |', 'Field Type · id int'],
    ['foo\\_bar and \\*\\*x\\*\\*', 'foo_bar and **x**'],
    ['Tom &amp; Jerry', 'Tom & Jerry'],
  ])('reads %j as %j', (markdown, text) => {
    expect(plainText(markdown)).toBe(text);
  });

  it.each([
    ['Fix `__init__.py` and `__main__`', 'Fix __init__.py and __main__'],
    ['Use `*args` and `**kwargs`', 'Use *args and **kwargs'],
    ['Update `src/**/*.ts` and `test/**/*.ts`', 'Update src/**/*.ts and test/**/*.ts'],
    ['```js\nconst a = 1;\n```', 'const a = 1;'],
    ['```bash\n# install\nnpm i\n```', '# install npm i'],
    ['```diff\n- removed\n+ added\n```', '- removed + added'],
  ])('keeps the symbols inside code: %j', (markdown, text) => {
    expect(plainText(markdown)).toBe(text);
  });

  it.each([
    'snake_case_name stays',
    '2 * 3 * 4 = 24',
    'costs 5_000 and 6_000',
    '#42 is not a heading',
    '-1 is not a list',
    'v1.2 ships',
  ])('leaves %j alone', (text) => {
    expect(plainText(text)).toBe(text);
  });

  it.each(['', '   \n ', '---', '[1]: https://x.dev'])('has nothing to show for %j', (markdown) => {
    expect(plainText(markdown)).toBe('');
  });

  it('only reads the start of a very long description', () => {
    expect(plainText('word '.repeat(50000)).length).toBeLessThanOrEqual(500);
  });

  it('reads a board full of descriptions without slowing it down', () => {
    const description = '## Problem\n\nThe **login** fails with `POST /login`.\n\n- Only on mobile\n- [link](https://x.dev)\n\n'.repeat(10);
    const start = performance.now();
    for (let i = 0; i < 500; i++) plainText(description + i);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
