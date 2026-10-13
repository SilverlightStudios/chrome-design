// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { capturePage } from '../src/capture/capture';
import { maskText } from '../src/capture/serialize';
import { coveredShare } from '../src/content/redact';

describe('hiding private content', () => {
  it('dots out every visible character but keeps the spacing', () => {
    expect(maskText('Jane Doe · jane@x.io')).toBe('•••• ••• • •••••••••');
  });

  it('measures how much of a box is under the blur', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    expect(coveredShare({ x: 50, y: 0, width: 100, height: 100 }, [box])).toBe(0.5);
    expect(coveredShare({ x: 200, y: 0, width: 10, height: 10 }, [box])).toBe(0);
  });

  it('writes hidden text as dots and hidden pictures as grey boxes in the page copy', async () => {
    document.body.innerHTML =
      '<p id="who">Jane Doe</p><p id="ok">Public</p><img id="pic" alt="Jane" src="data:image/png;base64,AAAA"><input id="mail" value="jane@x.io">';
    const who = document.getElementById('who')!.firstChild!;
    const { capture } = await capturePage({
      skip: () => false,
      anchors: [],
      fetchers: [],
      includeSource: false,
      hidden: {
        text: new Set([who]),
        elements: new Set([document.getElementById('pic')!, document.getElementById('mail')!]),
      },
    });
    const html = capture.snapshotHtml;
    expect(html).toContain('<p id="who">•••• •••</p>');
    expect(html).toContain('<p id="ok">Public</p>');
    expect(html).not.toContain('Jane');
    expect(html).toContain('data-cd-hidden');
    expect(html).not.toContain('jane@x.io');
  });
});
