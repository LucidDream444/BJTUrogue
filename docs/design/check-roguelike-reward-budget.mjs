/** Proposal v2 audit. Arithmetic and source checks only; no combat simulation. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/^\uFEFF/, '');
const readConfig = (p) => JSON.parse(read(`client/public/config/${p}`));
const text = read('docs/肉鸽奖励重做方案.md');
const cards = [...text.matchAll(/^\| (T\d{2}) \| (.*?) \| (.*?) \| (.*?) \|$/gm)]
  .map(([, id, name, cardText, applicability]) => ({ id, name, cardText, applicability, firstRelease: applicability.includes('首版') }));
assert.equal(cards.length, 30, 'Expected 30 independent talents');
assert.equal(new Set(cards.map((c) => c.id)).size, 30, 'Duplicate talent ID');
assert.deepEqual(cards.map((c) => c.id).sort(), Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`));
const firstRelease = cards.filter((c) => c.firstRelease);
assert.equal(firstRelease.length, 18, 'Expected 18 first-release talents');
const baseline = readConfig('balance.json');
const combat = readConfig('combat.json');
const baseDps = baseline.baseline.bullet.damage * 1000 / baseline.baseline.bullet.fireIntervalMs;
const round = (n) => Number(n.toFixed(6));
const criticalCases = [
  { label: 'base_crit', chance: 0.1, critMultiplier: 1.5 },
  { label: 'T05_only', chance: 0.3, critMultiplier: 1.75 },
  { label: 'T11_only_direct_damage_excludes_lightning', chance: 0.2, critMultiplier: 1.5 },
  { label: 'T05_plus_T11_direct_damage_excludes_lightning', chance: 0.4, critMultiplier: 1.75 },
].map((s) => ({ ...s, directDps: round(baseDps * (1 + s.chance * (s.critMultiplier - 1))) }));
const referenceDps = criticalCases[0].directDps;
const splitExpectation = 1 + 0.5 * 0.5;
const scatterPistol = 1 + 2 * 0.45;
const fullShieldFactor = 1.25;
const critFactor = 1 + 0.4 * 0.75;
const mixedBuildDps = baseDps * fullShieldFactor * critFactor * splitExpectation;
const offensiveBuildDps = baseDps * (scatterPistol + splitExpectation - 1) * fullShieldFactor * critFactor * 1.4;
assert.equal(round(mixedBuildDps), 81.25);
assert.equal(round(offensiveBuildDps), 195.65);
const phases = [
  { phase: 'prologue', choices: 1 },
  { phase: 'layer_1', choices: 2 },
  { phase: 'layer_2', choices: 3 },
  { phase: 'layer_3', choices: 2 },
];
assert.equal(phases.reduce((n, p) => n + p.choices, 0), 8);
const buildIds = {
  mixed: ['T01', 'T04', 'T05', 'T11', 'T13', 'T19', 'T21', 'T25'],
  offensive: ['T01', 'T05', 'T06', 'T10', 'T11', 'T21', 'T25', 'T30'],
};
for (const [name, ids] of Object.entries(buildIds)) {
  assert.equal(ids.length, 8, name);
  assert.equal(new Set(ids).size, 8, name);
  assert.ok(ids.every((id) => firstRelease.some((c) => c.id === id)), `${name}: talent not in first release`);
}
let currentTableWidth = null;
for (const [index, line] of text.split(/\r?\n/).entries()) {
  if (!line.startsWith('|')) { currentTableWidth = null; continue; }
  const width = line.split('|').length;
  if (currentTableWidth !== null) assert.equal(width, currentTableWidth, `Table width mismatch at line ${index + 1}`);
  currentTableWidth = width;
}
const report = {
  schemaVersion: 2,
  date: '2026-11-20',
  designStatus: 'independent_talents_v2_proposal_only',
  supersedes: 'four_family_core_component_awakening_v1',
  auditedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Catalog consistency and analytical arithmetic only. No combat simulation, RNG draw implementation, engine integration or player validation.',
  currentGameBaseline: { weaponCount: combat.weapons.length, rewardCount: readConfig('rewards.json').rewards.length, combatLayers: combat.arena.maxStages, maxEnergy: combat.player.maxStamina, shield: combat.player.maxShield, directPistolDpsBeforeProposedCrit: baseDps },
  proposal: { talentCount: cards.length, firstReleaseCount: firstRelease.length, firstReleaseIds: firstRelease.map((c) => c.id), mainlineChoices: 8, phases, maxDuplicatePerTalent: 1, baseCrit: 0.1, baseCritDamageMultiplier: 1.5 },
  criticalCases,
  buildModels: {
    assumptions: 'Pistol at base cadence; every projectile and split bullet hits; full shield retained; no energy shortage; independent critical rolls; offensive case has full T10 ramp; excludes lightning, skills, movement, projectile-pool contention and T30 temporary haste. Upper-condition arithmetic, not expected observed gameplay DPS.',
    mixed: { ids: buildIds.mixed, projectileDps: round(mixedBuildDps), ratioToProposedBaseCritDps: round(mixedBuildDps / referenceDps) },
    offensive: { ids: buildIds.offensive, projectileDps: round(offensiveBuildDps), ratioToProposedBaseCritDps: round(offensiveBuildDps / referenceDps) },
    scatter: { pistolAllHitFactor: scatterPistol, sixPelletAllHitFactor: round((6 + 2 * 0.45) / 6), note: 'Additional small bullets do not replicate native explosions or split traits.' },
  },
  cards,
  assertions: 'passed',
};
if (process.argv.includes('--write')) {
  const out = resolve(here, 'roguelike-reward-budget.audit.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${out}`);
}
console.log(JSON.stringify({ designStatus: report.designStatus, proposal: report.proposal, criticalCases, buildModels: report.buildModels, assertions: report.assertions }, null, 2));
