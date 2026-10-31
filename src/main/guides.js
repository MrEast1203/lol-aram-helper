// User-defined build guides, e.g. "裝甲衝擊 → 先出布甲".
// A guide applies when (no champions listed OR current champion listed) AND
// (one of its trigger augments was picked, or it has no triggers but lists champions).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GuideStore {
  constructor(file) {
    this.file = file;
    try {
      this.guides = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      this.guides = [];
    }
  }

  list() {
    return this.guides;
  }

  save(guide) {
    const g = {
      id: guide.id || 'g_' + crypto.randomBytes(5).toString('hex'),
      name: String(guide.name || '未命名攻略').slice(0, 60),
      enabled: guide.enabled !== false,
      augmentIds: (guide.augmentIds || []).map(Number),
      championIds: (guide.championIds || []).map(Number),
      items: (guide.items || []).map(Number),
      note: String(guide.note || '').slice(0, 500),
      updatedAt: Date.now(),
    };
    const i = this.guides.findIndex((x) => x.id === g.id);
    if (i >= 0) this.guides[i] = g;
    else this.guides.push(g);
    this.persist();
    return g;
  }

  remove(id) {
    this.guides = this.guides.filter((g) => g.id !== id);
    this.persist();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.guides, null, 2));
  }
}

function guideAppliesToChampion(g, championId) {
  return !g.championIds.length || g.championIds.includes(championId);
}

function matchingGuides(guides, championId, pickedAugmentIds) {
  return guides.filter(
    (g) =>
      g.enabled &&
      guideAppliesToChampion(g, championId) &&
      (g.augmentIds.length ? g.augmentIds.some((id) => pickedAugmentIds.includes(id)) : g.championIds.length > 0)
  );
}

module.exports = { GuideStore, matchingGuides, guideAppliesToChampion };
