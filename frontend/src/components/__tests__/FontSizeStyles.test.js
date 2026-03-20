import fs from 'fs';
import path from 'path';

describe('font size styles', () => {
  const read = (relativePath) =>
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

  it('defines global html font-size selectors for all size options', () => {
    const indexCss = read('../../index.css');

    expect(indexCss).toContain('html[data-font-size="small"]');
    expect(indexCss).toContain('html[data-font-size="medium"]');
    expect(indexCss).toContain('html[data-font-size="large"]');
  });

  it('uses rem-based sizes for main-page controls so they scale with html font-size', () => {
    const appCss = read('../../App.css');
    const searchBarCss = read('../SearchBar.css');
    const bottomControlsCss = read('../BottomControls.css');

    expect(appCss).toContain('.route-btn');
    expect(appCss).toContain('font-size: clamp(0.6875rem, 2.2vw, 0.875rem);');
    expect(searchBarCss).toContain('.search-input');
    expect(searchBarCss).toContain('font-size: 1rem;');
    expect(bottomControlsCss).toContain('.control-btn span');
    expect(bottomControlsCss).toContain('font-size: 0.75rem;');
  });
});
