import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewTarget } from '../lib/review-target.ts';
import { workspaceRecords, distinctRecords } from '../lib/dashboard-view.ts';

test('review retains a record tab and evidence anchor', () => {
  assert.equal(reviewTarget('/projects/p1?tab=capital#integrity', 'https://os.regenera.bio'), '/projects/p1?tab=capital#integrity');
});
test('review never embeds external destinations, APIs or authentication', () => {
  for (const href of ['https://other.example/projects/1', '//other.example/companies/1', '/api/projects', '/signin', '/auth/signout', 'javascript:alert(1)']) {
    assert.equal(reviewTarget(href, 'https://os.regenera.bio'), null, href);
  }
});
test('map and Command controls retain normal navigation', () => {
  assert.equal(reviewTarget('/today?map=new', 'https://os.regenera.bio'), null);
  assert.equal(reviewTarget('/map?project=p1', 'https://os.regenera.bio'), null);
});
test('consolidation preserves independent items sharing a register URL', () => {
  const a = {label:'Agreement A',href:'/contracts',sub:'Review signature'};
  const b = {label:'Agreement B',href:'/contracts',sub:'Review signature'};
  assert.deepEqual(distinctRecords([a,a,b]), [a,b]);
});
test('attention records do not reappear as recent records', () => {
  const a = {label:'Project A',href:'/projects/a',sub:'Blocker'};
  const b = {label:'Project B',href:'/projects/b'};
  assert.deepEqual(workspaceRecords([a,a],[{...a,sub:'Recently updated'},b]), {priorities:[a],records:[b]});
});
