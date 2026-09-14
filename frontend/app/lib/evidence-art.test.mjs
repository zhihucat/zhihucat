import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { artworkFor, artworkForEvidence } from './evidence-art.ts';

import { campaignCases } from '../../../backend/src/campaign-cases.ts';

test('rental cards retain the wall, furniture, key, chat and document collection artwork', () => {
  const demo = campaignCases[0];
  for (const [id, art] of Object.entries({
    'ev-movein-photo': 'wall', 'ev-inventory': 'furniture', 'ev-checkout': 'checkout',
    'ev-chat': 'chat', 'ev-transfer': 'chat', 'ev-contract': 'desk', 'ev-repair': 'desk',
  })) assert.equal(artworkForEvidence(demo, id), art);
});

test('all ten cases use the exact collection-spot artwork and existing asset files', () => {
  for (const demo of campaignCases) {
    for (const evidence of demo.evidence) {
      const spot = demo.scenes.flatMap((scene) => scene.hotspots).find((item) => item.evidenceId === evidence.id);
      const art = artworkForEvidence(demo, evidence.id);
      if (spot) assert.equal(art, artworkFor(spot.id));
      assert.ok(existsSync(new URL(`../../public/assets/evidence/${art}-anime.webp`, import.meta.url)));
    }
  }
});

test('document-only evidence follows its source; missing sources use a safe typed fallback', () => {
  const demo = {
    scenes: [], evidence: [{ id: 'ev-record', sourceDocumentId: 'doc-record' }, { id: 'ev-video', type: 'image' }],
    documents: [{ id: 'doc-record', type: 'chat', hotspots: [{ evidenceId: 'ev-record' }] }],
  };
  assert.equal(artworkForEvidence(demo, 'ev-record'), 'chat');
  assert.equal(artworkForEvidence(demo, 'ev-video'), 'wall');
  assert.equal(artworkForEvidence(demo, 'unknown'), 'desk');
});
