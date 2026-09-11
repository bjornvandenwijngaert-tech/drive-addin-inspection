'use strict';

var assert = require('assert');
var fs = require('fs');
var vm = require('vm');
var storage = require('./response-storage.js');

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

function multipartResponse(id, status) {
  var response = {
    type: 'ChecklistResponse',
    id: id,
    submittedAt: '2026-09-11T12:00:00.000Z',
    driverName: 'Driver',
    deviceName: 'Vehicle',
    photoStorageVersion: 2,
    items: Array.from({ length: 20 }, function(_, index) {
      return { id: 'item-' + index, label: 'Item ' + index, type: 'text', value: 'x'.repeat(1000) };
    })
  };
  var plan = storage.buildPlan(response);
  assert.strictEqual(plan.mode, 'multipart');
  var root = JSON.parse(JSON.stringify(status === 'complete' ? plan.completeRoot : plan.root));
  root.partAddInDataIds = plan.parts.map(function(_, index) { return id + '-part-' + index; });
  return {
    root: { id: id + '-root', details: root },
    parts: plan.parts.map(function(part, index) {
      return { id: id + '-part-' + index, details: part };
    })
  };
}

var complete = multipartResponse('complete-response', 'complete');
var pending = multipartResponse('pending-response', 'uploading');
var legacy = {
  id: 'legacy-root',
  details: {
    type: 'ChecklistResponse',
    id: 'legacy-response',
    submittedAt: '2026-09-10T12:00:00.000Z',
    items: [{ id: 'legacy-item', label: 'Legacy item', type: 'pass_fail', value: 'pass' }]
  }
};

var context = {
  ChecklistResponseStorage: storage,
  RESPONSES: [],
  ISSUE_RECORDS: [],
  _gdConfig: null,
  console: console,
  buildFilterOptions: function() {},
  applyFilters: function() {},
  checkRetention: function() {},
  loadStorageInfo: function() {}
};
vm.createContext(context);
var source = fs.readFileSync('dashboard.html', 'utf8');
vm.runInContext(extractFunction(source, 'applyAddInData'), context);
context.applyAddInData([legacy, complete.root].concat(complete.parts, [pending.root]).concat(pending.parts));

assert.strictEqual(context.RESPONSES.length, 2, 'legacy and committed multipart responses should load');
var assembled = context.RESPONSES.find(function(response) { return response.id === 'complete-response'; });
assert(assembled);
assert.strictEqual(assembled.items.length, 20);
assert.strictEqual(assembled._partAddInDataIds.length, complete.parts.length);
assert(context.RESPONSES.some(function(response) { return response.id === 'legacy-response'; }));
assert(!context.RESPONSES.some(function(response) { return response.id === 'pending-response'; }));

console.log(JSON.stringify({
  visibleResponses: context.RESPONSES.map(function(response) { return response.id; }),
  hiddenPendingResponse: true,
  assembledItems: assembled.items.length
}));
