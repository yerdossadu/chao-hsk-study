// Run: node --test tests/speech_matching.test.cjs
// Exercise the actual flashcard recognition handler with browser/DOM stubs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');
const start = html.indexOf('cardRecognition.onresult =');
const end = html.indexOf('cardRecognition.onerror', start);
assert.ok(start >= 0 && end > start);

for (const [target, heard, accepted] of [
    ['你好', '你', false], ['你好', '好', false], ['你好', '你好朋友', false],
    ['你好', '', false], ['你好', ' ！？ ', false], ['', '你好', false], ['', '', false],
    ['你好', '你好', true], ['你好', ' 你 好！ ', true], ['谢谢', '谢谢。', true]
]) {
    test(`${JSON.stringify(heard)} against ${JSON.stringify(target)}: ${accepted}`, () => {
        const marked = [], classes = [];
        const context = {
            cardRecognition: {}, getActiveVocab: () => [{ word: target }],
            AppState: { currentCardIdx: 0 },
            document: { getElementById: () => ({ classList: { add: c => classes.push(c), remove() {} } }) },
            fcStatusText: { style: {} }, markWordAsMastered: word => marked.push(word),
            setTimeout() {},
        };
        vm.runInNewContext(html.slice(start, end), context);
        context.cardRecognition.onresult({ results: [[{ transcript: heard }]] });
        assert.deepEqual(marked, accepted ? [target] : []);
        assert.ok(classes.includes(accepted ? 'success-state' : 'error-state'));
    });
}
