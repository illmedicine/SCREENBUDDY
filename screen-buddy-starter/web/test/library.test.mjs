import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cleanUrl, cleanVideoUrl, videoPlatform, cleanLink, creatorKey, newCharacter, newCharacterId, redosLeft, mergeCollection,
  pickFeatured, StatsTally, checkVideoFile, videoFileName, VIDEO_FILE_MAX, formatDuration, isAdminEmail, ownKey, isOwnKey,
  NAME_MAX, VIDEO_MAX, LINK_MAX, CREATOR_MAX, MAX_RUNS, STAT_MAX_SECONDS, STAT_MAX_SELECTIONS, ADMIN_EMAILS,
} from '../js/library.js';
import { CATALOG } from '../js/billing.js';

test('video links: https only, scheme added, files refused', () => {
  assert.equal(cleanVideoUrl('www.tiktok.com/@kiah/video/1'), 'https://www.tiktok.com/@kiah/video/1');
  assert.equal(cleanVideoUrl('http://youtu.be/abcdefg'), 'https://youtu.be/abcdefg');
  assert.equal(cleanVideoUrl('javascript:alert(1)'), '');
  assert.equal(cleanVideoUrl('ftp://example.com/v.mp4'), '');
  assert.equal(cleanVideoUrl('https://example.com/buddy.zip'), '');
  assert.equal(cleanVideoUrl('https://user:pw@example.com/v'), '');
  assert.equal(cleanVideoUrl('https://localhost/v'), '');
  assert.equal(cleanVideoUrl(`https://example.com/${'a'.repeat(VIDEO_MAX)}`), '');
  assert.equal(cleanVideoUrl(''), '');
});

test('platforms are named from the host', () => {
  assert.equal(videoPlatform('https://www.youtube.com/shorts/x'), 'YouTube');
  assert.equal(videoPlatform('https://youtu.be/x'), 'YouTube');
  assert.equal(videoPlatform('https://vm.tiktok.com/x'), 'TikTok');
  assert.equal(videoPlatform('https://www.instagram.com/reel/x'), 'Instagram');
  assert.equal(videoPlatform('https://x.com/a/status/1'), 'X');
  assert.equal(videoPlatform('https://notyoutube.com/x'), 'Web');
  assert.equal(videoPlatform('nope'), '');
});

test('creator links: empty is fine, junk is null', () => {
  assert.equal(cleanLink(''), '');
  assert.equal(cleanLink('  '), '');
  assert.equal(cleanLink('instagram.com/kiah'), 'https://instagram.com/kiah');
  assert.equal(cleanLink('javascript:alert(1)'), null);
  assert.equal(cleanLink(`https://a.com/${'x'.repeat(LINK_MAX)}`), null);
  assert.equal(cleanUrl('https://a.com/has space'), 'https://a.com/has%20space');
});

test('creatorKey is stable and safe as a document id', () => {
  assert.equal(creatorKey('https://www.tiktok.com/@Kiah'), 'tiktok-com-kiah');
  assert.equal(creatorKey('https://tiktok.com/@kiah/'), 'tiktok-com-kiah');
  assert.match(creatorKey(`https://a.com/${'x'.repeat(400)}`), /^[a-z0-9-]{1,120}$/);
  assert.equal(creatorKey('bad'), '');
});

test('newCharacter builds exactly the fields the rules accept', () => {
  const r = newCharacter({ videoUrl: 'tiktok.com/@kiah/video/1', name: '  Puppy   Love ', creatorName: 'Kiah', creatorLink: '' });
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    name: 'Puppy Love', videoUrl: 'https://tiktok.com/@kiah/video/1', platform: 'TikTok', creatorName: 'Kiah', creatorLink: '',
    status: 'queued', runs: 1, disabled: false,
  });
  assert.equal(newCharacter({ videoUrl: 'x', name: 'a' }).ok, false);
  assert.equal(newCharacter({ videoUrl: 'https://youtu.be/abcdefg', name: '' }).ok, false);
  assert.equal(newCharacter({ videoUrl: 'https://youtu.be/abcdefg', name: 'a', creatorLink: 'not a link' }).ok, false);
  assert.equal(newCharacter({ videoUrl: 'https://youtu.be/abcdefg', name: 'x'.repeat(99) }).value.name.length, NAME_MAX);
  assert.equal(newCharacter({ videoUrl: 'https://youtu.be/abcdefg', name: 'a', creatorName: 'y'.repeat(99) }).value.creatorName.length, CREATOR_MAX);
});

test('uploaded videos: video files up to 100 MB, stored as video.<ext>', () => {
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 5e6 }), '');
  assert.notEqual(checkVideoFile({ type: 'image/png', size: 5e6 }), '');
  assert.notEqual(checkVideoFile({ type: 'video/mp4', size: 0 }), '');
  assert.notEqual(checkVideoFile({ type: 'video/mp4', size: VIDEO_FILE_MAX + 1 }), '');
  assert.notEqual(checkVideoFile(null), '');
  assert.equal(videoFileName({ type: 'video/quicktime', name: 'IMG_1.MOV' }), 'video.mov');
  assert.equal(videoFileName({ type: '', name: 'clip.WEBM' }), 'video.webm');
  assert.equal(videoFileName({ type: '', name: 'clip' }), 'video.mp4');
  for (const n of ['video.mov', 'video.webm', 'video.mp4', 'video.3gp']) assert.match(n, /^video[.][a-z0-9]{2,5}$/);
  const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/uploads%2Fu%2Fc%2Fvideo.mp4?alt=media&token=t';
  const r = newCharacter({ videoUrl: url, name: 'Me', uploaded: true });
  assert.equal(r.value.platform, 'Upload');
  assert.equal(r.value.videoUrl, url);
  assert.equal(newCharacter({ videoUrl: 'https://evil.com/x', name: 'Me', uploaded: true }).ok, false);
});

test('character ids match the rules pattern', () => {
  for (let i = 0; i < 50; i++) assert.match(newCharacterId(), /^[A-Za-z0-9_-]{6,64}$/);
  assert.equal(ownKey('u1', 'c1'), 'u1__c1');
  assert.ok(isOwnKey('u1__c1'));
  assert.ok(!isOwnKey('kiah'));
});

test('re-dos: 3 after the first run, only when ready or failed and switched on', () => {
  assert.equal(MAX_RUNS, 1 + CATALOG.maxReprocesses);
  assert.equal(redosLeft({ status: 'ready', runs: 1 }), 3);
  assert.equal(redosLeft({ status: 'failed', runs: 4 }), 0);
  assert.equal(redosLeft({ status: 'queued', runs: 1 }), 0);
  assert.equal(redosLeft({ status: 'ready', runs: 1, disabled: true }), 0);
});

test('the collection applies admin settings and hides hidden buddies', () => {
  const manifests = [{ id: 'a', name: 'A', author: 'Ann' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const overlays = { a: { hidden: true }, b: { name: 'Bee', creatorName: 'Bo', creatorLink: 'https://x.com/bo' }, c: { creatorLink: 'javascript:x' } };
  const items = mergeCollection(manifests, overlays);
  assert.deepEqual(items.map(i => i.id), ['b', 'c']);
  assert.equal(items[0].name, 'Bee');
  assert.equal(items[0].creatorLink, 'https://x.com/bo');
  assert.equal(items[1].creatorLink, '');
  assert.equal(mergeCollection(manifests, overlays, { includeHidden: true })[0].creatorName, 'Ann');
  const all = mergeCollection(manifests, overlays, { includeHidden: true });
  assert.equal(pickFeatured(all, 'c').id, 'c');
  assert.equal(pickFeatured(all, 'a').id, 'b');      // hidden can't be featured
  assert.equal(pickFeatured(all, '').id, 'b');
  assert.equal(pickFeatured([], 'a'), null);
});

test('stats tally: batches, caps to what one write may add, keeps the rest', () => {
  const t = new StatsTally();
  t.select('kiah');
  t.tick('kiah', 5000);
  t.tick('kiah', 5500);
  t.tick('kiah', -1);
  t.tick('kiah', 10 * 3600_000);      // a laptop that slept: ignored
  t.tick(null, 5000);
  assert.deepEqual(t.drain(), [{ key: 'kiah', selections: 1, seconds: 10 }]);
  assert.deepEqual(t.drain(), []);       // 500 ms left over, not yet a second
  for (let i = 0; i < 12; i++) t.select('a');
  for (let i = 0; i < 10; i++) t.tick('a', 100_000);
  assert.deepEqual(t.drain(), [{ key: 'a', selections: STAT_MAX_SELECTIONS, seconds: STAT_MAX_SECONDS }]);
  assert.deepEqual(t.drain(), [{ key: 'a', selections: 2, seconds: 100 }]);
});

test('durations read well', () => {
  assert.equal(formatDuration(0), '0 s');
  assert.equal(formatDuration(59), '59 s');
  assert.equal(formatDuration(240), '4 min');
  assert.equal(formatDuration(7500), '2 h 05 min');
});

test('admin is the owner\'s verified Google address only', () => {
  assert.ok(isAdminEmail('demarkuswilsone@gmail.com'));
  assert.ok(isAdminEmail('DemarkusWilsone@gmail.com'));
  assert.ok(!isAdminEmail('demarkuswilsone@gmail.com', false));
  assert.ok(!isAdminEmail('someone@gmail.com'));
  assert.ok(!isAdminEmail(null));
});

// The rules are checked against the emulator in /firestore-tests. Here: their numbers match this file's.
test('firestore.rules uses the same limits and admin as the site', () => {
  const rules = readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
  for (const email of ADMIN_EMAILS) assert.ok(rules.includes(`'${email}'`), `admin ${email} in rules`);
  assert.match(rules, new RegExp(`v\\.size\\(\\) <= ${VIDEO_MAX} && v\\.matches\\('https://`));
  assert.match(rules, new RegExp(`v\\.size\\(\\) <= ${LINK_MAX} && \\(v == ''`));
  assert.match(rules, new RegExp(`v\\.size\\(\\) <= ${CREATOR_MAX} && v == v\\.trim`));
  assert.match(rules, new RegExp(`d\\.runs <= ${MAX_RUNS}`));
  assert.match(rules, new RegExp(`grows\\('selections', ${STAT_MAX_SELECTIONS}\\)`));
  assert.match(rules, new RegExp(`grows\\('seconds', ${STAT_MAX_SECONDS}\\)`));
  assert.match(rules, new RegExp(`n\\.freeUsed <= ${CATALOG.freeCreations}`));
  for (const p of CATALOG.products.filter(x => x.kind === 'credits')) {
    assert.ok(rules.includes(`p.productId == '${p.id}' && p.credits == ${p.credits} && n.credits == o.credits + ${p.credits}`), `payment rule for ${p.id}`);
  }
  const storageRules = readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8');
  assert.ok(storageRules.includes(`request.resource.size <= ${VIDEO_FILE_MAX / 1024 / 1024} * 1024 * 1024`), 'upload size in storage.rules');
  assert.match(rules, new RegExp(`b\\.used <= ${CATALOG.products.find(x => x.kind === 'subscription').credits}`));
});
