// 純函式的單元測試：node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTokens, compareExact, firstDiffLine } from '../src/lib/compare.js';
import { normalizePath, validateName, uniqueName, langOf, decodeText } from '../src/lib/paths.js';
import { pairTestFiles } from '../src/lib/testFiles.js';
import { buildZip, readZip } from '../src/lib/zip.js';
import { parseId, languageForPath, extForLanguage } from '../src/lib/codenoter.js';

test('compareTokens 忽略空白差異', () => {
  assert.equal(compareTokens('1 2\n3  \n\n', '1 2 3').ok, true);
  assert.equal(compareTokens('1 2', '1 3').ok, false);
  assert.match(compareTokens('1', '1 2').detail, /太短/);
});

test('compareExact 只把 CRLF 視為 LF', () => {
  assert.equal(compareExact('a\r\nb\n', 'a\nb\n').ok, true);
  assert.equal(compareExact('a \n', 'a\n').ok, false);
  assert.equal(firstDiffLine('a\nb\nc\n', 'a\nx\nc\n', 'tokens'), 2);
  assert.equal(firstDiffLine('a  \n\n', 'a\n', 'tokens'), 0);
});

test('路徑與檔名', () => {
  assert.equal(normalizePath('./a//b/../c.cpp'), 'a/c.cpp');
  assert.equal(normalizePath('../x'), null);
  assert.equal(normalizePath('a/b:c'), null);
  assert.ok(validateName('a?b'));
  assert.equal(validateName('main.cpp'), null);
  assert.equal(uniqueName('', 'main.cpp', new Set(['main.cpp', 'main (1).cpp'])), 'main (2).cpp');
  assert.equal(langOf('x/Y.CPP'), 'cpp');
  assert.equal(langOf('a.hpp'), 'h');
  assert.equal(langOf('a.txt'), null);
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x00])), null);
  assert.equal(decodeText(new TextEncoder().encode('﻿中文')), '中文');
});

test('批次測資依檔名配對', () => {
  const pairs = pairTestFiles([
    { path: '2.in', content: 'b' }, { path: '2.out', content: 'B' },
    { path: '10.in', content: 'j' },
    { path: '1.in', content: 'a' }, { path: '1.ans', content: 'A' },
    { path: 'input3.txt', content: 'c' }, { path: 'output3.txt', content: 'C' },
  ]);
  assert.deepEqual(pairs.map((p) => [p.name, p.input, p.expected]), [
    ['1', 'a', 'A'], ['2', 'b', 'B'], ['3', 'c', 'C'], ['10', 'j', ''],
  ]);
});

test('專案 zip 來回轉換（含測資與空資料夾）', async () => {
  const entries = [
    { id: 'd1', path: 'src', kind: 'dir' },
    { id: 'd2', path: 'empty', kind: 'dir' },
    { id: 'f1', path: 'src/main.cpp', kind: 'file', content: 'int main(){}' },
    { id: 'f2', path: 'img.bin', kind: 'file', binary: new Uint8Array([0, 1, 2, 255]).buffer },
  ];
  const tests = { f1: { fileId: 'f1', cases: [{ name: '樣例', input: '1 2\n', expected: '3\n', enabled: true }, { name: 'b', input: 'x', expected: '', enabled: false }], timeLimit: 3, compare: 'exact' } };
  const blob = await buildZip(entries, { tests, projectName: 'P' });
  const data = await readZip(blob);
  assert.deepEqual(data.files.map((f) => f.path).sort(), ['img.bin', 'src/main.cpp']);
  assert.ok(data.dirs.includes('empty'));
  assert.equal(data.files.find((f) => f.path === 'src/main.cpp').content, 'int main(){}');
  assert.deepEqual([...new Uint8Array(data.files.find((f) => f.path === 'img.bin').binary)], [0, 1, 2, 255]);
  assert.equal(data.meta.project.name, 'P');
  const t = data.meta.tests['src/main.cpp'];
  assert.equal(t.timeLimit, 3);
  assert.equal(t.compare, 'exact');
  assert.deepEqual(t.cases.map((c) => [c.name, c.input, c.expected, c.enabled]), [['樣例', '1 2\n', '3\n', true], ['b', 'x', '', false]]);
});

test('下載資料夾時只包含該資料夾，且去掉共同頂層資料夾', async () => {
  const entries = [
    { id: 'a', path: 'lib/x.h', kind: 'file', content: 'x' },
    { id: 'b', path: 'main.cpp', kind: 'file', content: 'm' },
  ];
  const data = await readZip(await buildZip(entries, { prefix: 'lib' }));
  assert.deepEqual(data.files.map((f) => f.path), ['x.h']);
});

test('Code Noter 連結解析與語言對應', () => {
  assert.equal(parseId('https://coder.apcs.top/code/AbC123'), 'AbC123');
  assert.equal(parseId(' AbC-1 '), 'AbC-1');
  assert.equal(parseId('not a url!'), null);
  assert.equal(languageForPath('a/b.cc'), 'cpp');
  assert.equal(languageForPath('x.py'), 'python');
  assert.equal(languageForPath('x.unknown'), 'plaintext');
  assert.equal(extForLanguage('python'), '.py');
});
