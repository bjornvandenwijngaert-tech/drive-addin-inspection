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

var source = fs.readFileSync('dashboard.html', 'utf8');
var context = {
  getResponsePhotoSummary: function() {
    return { capturedCount: 0, retrievableCount: 0, pendingCount: 0, failedCount: 0, missingCount: 0, driveArchivedCount: 0, driveArchivePendingCount: 0 };
  },
  getItemPhotoEntries: function() { return []; },
  isDriveArchiveRequired: function() { return false; },
  formatSignoffDate: function() { return ''; }
};
vm.createContext(context);
vm.runInContext(extractFunction(source, 'htmlSafe'), context);
vm.runInContext(extractFunction(source, 'expandedRow'), context);

var longText = 'I was returning home by the fields. '.repeat(20) + '<unsafe>';
var html = context.expandedRow({
  id: 'response-1',
  items: [
    { id: 'notes', label: 'General notes / observations', type: 'text', value: longText },
    { id: 'text-yes', label: 'Free text answer', type: 'text', value: 'yes' },
    { id: 'choice', label: 'Locking Wheel Nut', type: 'yes_no', value: 'yes' },
    { id: 'number', label: 'Starting mileage', type: 'number', value: '123456' }
  ]
});

assert(html.includes('data-item-text-response'));
assert(html.includes('overflow-wrap:anywhere'));
assert(html.includes('word-break:break-word'));
assert(html.includes('&lt;unsafe&gt;'), 'free text must be escaped');
assert(!html.includes('<unsafe>'));
assert(html.includes('>yes</p>'), 'text value resembling a status must remain a text response');
assert.strictEqual((html.match(/data-item-compact-value/g) || []).length, 2, 'only choice and numeric values use the compact column');
assert(html.includes('grid-cols-1 lg:grid-cols-3'), 'expanded report must collapse to one column on narrow screens');
assert(html.includes('max-width:35%'), 'compact values must have a bounded column');

var longTextIndex = html.indexOf('&lt;unsafe&gt;');
var compactAfterText = html.indexOf('data-item-compact-value', longTextIndex);
assert(compactAfterText > longTextIndex, 'long text must finish before the next compact response column');

console.log(JSON.stringify({
  wrappedTextLength: longText.length,
  compactValueColumns: (html.match(/data-item-compact-value/g) || []).length,
  responsiveGrid: true
}));
