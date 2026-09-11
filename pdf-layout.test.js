'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');

function extractFunction(source, name) {
  var start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Could not find ' + name);
  var open = source.indexOf('{', start);
  var depth = 0;
  for (var i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('Could not parse ' + name);
}

function mockDocument() {
  var calls = [];
  var page = 1;
  return {
    calls: calls,
    splitTextToSize: function(text, width) {
      var maxChars = Math.max(8, Math.floor(width / 2));
      var words = String(text).split(/\s+/);
      var lines = [];
      var line = '';
      words.forEach(function(word) {
        while (word.length > maxChars) {
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, maxChars));
          word = word.slice(maxChars);
        }
        var candidate = line ? line + ' ' + word : word;
        if (candidate.length > maxChars && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      });
      if (line || !lines.length) lines.push(line);
      return lines;
    },
    addPage: function() { page++; calls.push({ type: 'page', page: page }); },
    text: function(text, x, y, options) {
      calls.push({ type: 'text', text: String(text), x: x, y: y, page: page, options: options || {} });
    },
    rect: function() {},
    line: function(x1, y1, x2, y2) { calls.push({ type: 'line', y: y1, page: page }); },
    setDrawColor: function() {},
    setFillColor: function() {},
    setFontSize: function() {},
    setFont: function() {},
    setTextColor: function() {}
  };
}

var source = fs.readFileSync('dashboard.html', 'utf8');
var context = { Array: Array, String: String, Math: Math };
vm.createContext(context);
['_pdfItemLines', '_pdfEnsureItemSpace', '_pdfDrawItemLines', '_pdfDrawItemDivider', '_pdfDrawChecklistItemText'].forEach(function(name) {
  vm.runInContext(extractFunction(source, name), context);
});

var doc = mockDocument();
var state = { y: 14, margin: 14, W: 210, contentW: 182, bottom: 280 };
var longValue = 'Today I recorded a detailed general observation that must wrap below the item label without overlapping either column.';
context._pdfDrawChecklistItemText(doc, {
  id: 'notes',
  label: 'General notes / Observations',
  type: 'text',
  value: longValue
}, state);

var textCalls = doc.calls.filter(function(call) { return call.type === 'text'; });
var labelCall = textCalls.find(function(call) { return call.text.indexOf('General notes') === 0; });
var responseHeading = textCalls.find(function(call) { return call.text === 'RESPONSE'; });
var responseLines = textCalls.filter(function(call) {
  return call.page === responseHeading.page && call.y > responseHeading.y && call.x === 21;
});
assert(labelCall);
assert(responseHeading);
assert(responseHeading.y > labelCall.y, 'response block must start below the label');
assert(responseLines.length > 1, 'long response must wrap across lines');
assert(responseLines.some(function(call) { return /Today I recorded/.test(call.text); }), 'response case must be preserved');
assert(!responseLines.some(function(call) { return call.options.align === 'right'; }), 'long response must not use the status column');

var yesTextDoc = mockDocument();
var yesTextState = { y: 14, margin: 14, W: 210, contentW: 182, bottom: 280 };
context._pdfDrawChecklistItemText(yesTextDoc, { label: 'General notes', type: 'text', value: 'yes' }, yesTextState);
assert(yesTextDoc.calls.some(function(call) { return call.type === 'text' && call.text === 'yes'; }));
assert(!yesTextDoc.calls.some(function(call) {
  return call.type === 'text' && call.text === 'YES' && call.options.align === 'right';
}), 'text that resembles a status must remain free text');

var pictureDoc = mockDocument();
var pictureState = { y: 14, margin: 14, W: 210, contentW: 182, bottom: 280 };
context._pdfDrawChecklistItemText(pictureDoc, { label: 'Damage photograph', type: 'picture_required', value: 'yes' }, pictureState);
assert(pictureDoc.calls.some(function(call) {
  return call.type === 'text' && call.text === 'PHOTO' && call.options.align === 'right';
}), 'picture items must use a fixed type label rather than interpreting their value');

var passDoc = mockDocument();
var passState = { y: 14, margin: 14, W: 210, contentW: 182, bottom: 280 };
context._pdfDrawChecklistItemText(passDoc, {
  label: 'A long pass or fail checklist label that needs its own wrapped label area',
  type: 'pass_fail',
  value: 'pass'
}, passState);
assert(passDoc.calls.some(function(call) {
  return call.type === 'text' && call.text === 'PASS' && call.options.align === 'right';
}), 'short status must stay in the right column');

var hugeDoc = mockDocument();
var hugeState = { y: 270, margin: 14, W: 210, contentW: 182, bottom: 280 };
context._pdfDrawChecklistItemText(hugeDoc, {
  label: 'General notes',
  type: 'text',
  value: 'observation '.repeat(350)
}, hugeState);
assert(hugeDoc.calls.some(function(call) { return call.type === 'page'; }), 'large responses must continue on a new page');
assert(hugeDoc.calls.filter(function(call) { return call.type === 'text'; }).every(function(call) {
  return call.y <= 280;
}), 'rendered text must stay within the page boundary');
assert(hugeState.y <= hugeState.bottom, 'item flow must not advance beyond the page boundary');

var dividerDoc = mockDocument();
var dividerState = { y: 279, margin: 14, W: 210, contentW: 182, bottom: 280 };
context._pdfDrawItemDivider(dividerDoc, dividerState);
assert.strictEqual(dividerState.y, 280);
assert(!dividerDoc.calls.some(function(call) { return call.type === 'line' && call.y > 280; }));

var rendererUses = (source.match(/_pdfDrawChecklistItemText\(doc, item, itemTextState\)/g) || []).length;
assert.strictEqual(rendererUses, 2, 'single and bulk PDF exports must share the wrapped item renderer');

console.log(JSON.stringify({
  wrappedResponseLines: responseLines.length,
  longResponsePages: hugeDoc.calls.filter(function(call) { return call.type === 'page'; }).length + 1,
  sharedExportPaths: rendererUses
}));
