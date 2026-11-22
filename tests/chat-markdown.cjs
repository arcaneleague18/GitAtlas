const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

test('chat Markdown preserves formatting while HTML and unsafe links remain inert', async () => {
  const result = await esbuild.build({
    stdin: { contents: `import React from './webview/node_modules/react'; import { renderToStaticMarkup } from './webview/node_modules/react-dom/server.node'; import { ChatMarkdown } from './webview/src/components/ChatMarkdown'; export const render = text => renderToStaticMarkup(React.createElement(ChatMarkdown, {text}));`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  });
  const mod = new Module(path.resolve('markdown-test.cjs'));
  mod.paths = module.paths;
  mod._compile(result.outputFiles[0].text, path.resolve('markdown-test.cjs'));
  const html = mod.exports.render('# Heading\n**bold** and `code`\n- item\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[unsafe](javascript:alert)\n[safe](https://example.com)\n```html\n<button>text</button>\n```');
  assert.match(html, /<h2 class="ai-heading">Heading<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul class="ai-list"><li>item<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&lt;button&gt;text&lt;\/button&gt;/);
});
