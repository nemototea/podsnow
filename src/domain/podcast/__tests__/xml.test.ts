import { decodeEntities, parseXml, XmlParseError } from '../xml';

describe('parseXml', () => {
  it('reads elements, attributes, text and CDATA', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<!-- comment -->
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>A &amp; B</title>
    <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    <itunes:image href="https://example.com/a.jpg?x=1&amp;y=2"/>
    <empty></empty>
  </channel>
</rss>`,
    );
    expect(root.name).toBe('rss');
    expect(root.attrs).toEqual({
      version: '2.0',
      'xmlns:itunes': 'http://www.itunes.com/dtds/podcast-1.0.dtd',
    });
    const channel = root.children[0]!;
    expect(channel.children.map((c) => c.name)).toEqual([
      'title',
      'description',
      'itunes:image',
      'empty',
    ]);
    expect(channel.children[0]!.text).toBe('A & B');
    expect(channel.children[1]!.text).toBe('<p>Hello <b>world</b></p>');
    expect(channel.children[2]!.attrs.href).toBe('https://example.com/a.jpg?x=1&y=2');
    expect(channel.children[3]!.text).toBe('');
  });

  it('accepts single-quoted attributes, a BOM and Japanese names and text', () => {
    const root = parseXml(`﻿<a k='v'><名前>こんにちは</名前></a>`);
    expect(root.attrs.k).toBe('v');
    expect(root.children[0]).toMatchObject({ name: '名前', text: 'こんにちは' });
  });

  it('skips DOCTYPE without expanding declared entities', () => {
    const root = parseXml(
      `<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY lol "lol">]><rss>&xxe;&lol;&amp;</rss>`,
    );
    // 宣言された実体は展開しない（外部実体・実体の爆発を起こさない）
    expect(root.text).toBe('&xxe;&lol;&');
  });

  it('throws on malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a>')).toThrow(/unclosed/);
    expect(() => parseXml('')).toThrow(/no root/);
    expect(() => parseXml('<a></a><b></b>')).toThrow(/more than one root/);
    expect(() => parseXml('<a x=1></a>')).toThrow(/not quoted/);
    expect(() => parseXml('<a><!-- never closed</a>')).toThrow(/comment/);
    expect(() => parseXml('hello')).toThrow(/outside the root/);
    expect(() => parseXml('<html><body>not a feed')).toThrow(XmlParseError);
  });
});

describe('decodeEntities', () => {
  it('decodes predefined entities and character references only', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&apos;')).toBe(`<>&"'`);
    expect(decodeEntities('&#12354;&#x3042;&#x1F399;')).toBe('ああ🎙');
    expect(decodeEntities('&nbsp;&unknown;')).toBe('&nbsp;&unknown;');
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('&#0;&#xD800;&#x110000;');
    expect(decodeEntities('no entities')).toBe('no entities');
  });
});
