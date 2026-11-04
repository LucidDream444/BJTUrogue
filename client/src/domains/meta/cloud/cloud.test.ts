import { describe, expect, it, vi } from 'vitest'
import { createDefaultProfile } from '../profile/defaults'
import { cloneProfile } from '../profile/migrate'
import { ProfileStore } from '../profile/ProfileStore'
import { MemoryProfileStorage, type ProfileStorage } from '../profile/storage'
import type { ProfileData } from '../profile/types'
import { CloudSyncCoordinator } from './coordinator'
import {
  CloudSyncMetaStore,
  cloudSyncMetaStorageKey,
  markCloudSynced,
  parseCloudSyncMeta,
} from './metadata'
import {
  cloudProfileForUpload,
  cloudProgressSummary,
  hasMeaningfulLocalProgress,
  progressDifferences,
  syncFingerprint,
} from './projection'
import { planCloudSync } from './reconcile'
import type {
  CloudLoadResponse,
  CloudSaveEnvelope,
  CloudSyncTransport,
  CloudUploadResponse,
} from './types'

function profile(mutate: (value: ProfileData) => void = () => undefined): ProfileData {
  const value = createDefaultProfile()
  mutate(value)
  return value
}

function envelope(value: ProfileData, revision = value.revision): CloudSaveEnvelope {
  const payload = cloneProfile(value)
  payload.revision = revision
  return {
    payload,
    schemaVersion: payload.schemaVersion,
    revision,
    updatedAt: '2026-11-03T00:00:00Z',
  }
}

class FakeTransport implements CloudSyncTransport {
  loadCalls = 0
  uploadCalls: { baseRevision: number; profile: ProfileData }[] = []

  constructor(
    private readonly loads: CloudLoadResponse[],
    private readonly uploads: CloudUploadResponse[] = [],
  ) {}

  async load(): Promise<CloudLoadResponse> {
    this.loadCalls++
    return this.loads.shift() ?? { kind: 'empty' }
  }

  async upload(baseRevision: number, value: ProfileData): Promise<CloudUploadResponse> {
    this.uploadCalls.push({ baseRevision, profile: value })
    return this.uploads.shift() ?? { kind: 'saved', save: envelope(value, value.revision) }
  }
}

class ThrowingStorage implements ProfileStorage {
  read(): string | null {
    return null
  }

  write(): void {
    throw new Error('quota')
  }

  remove(): void {}
}

describe('同步投影', () => {
  it('设置和 revision 不进入指纹，数组与升级键的顺序也不制造假变化', () => {
    const a = profile((p) => {
      p.revision = 9
      p.settings.bgmVolume = 0.1
      p.unlocks.characters = ['student', 'athlete']
      p.upgrades = { 'scholar:skill': 2, 'student:skill': 1 }
    })
    const b = profile((p) => {
      p.revision = 44
      p.settings.bgmVolume = 0.9
      p.settings.displayMode = 'fullscreen'
      p.unlocks.characters = ['athlete', 'student']
      p.upgrades = { 'student:skill': 1, 'scholar:skill': 2 }
    })
    expect(syncFingerprint(a)).toBe(syncFingerprint(b))

    b.currency.coins = 1
    expect(syncFingerprint(a)).not.toBe(syncFingerprint(b))
  })

  it('上传载荷保留 C3 的完整 ProfileData 形状，但设备设置归零为默认值', () => {
    const local = profile((p) => {
      p.revision = 7
      p.settings = { bgmVolume: 0.12, sfxVolume: 0.34, displayMode: 'fullscreen' }
      p.currency.coins = 80
    })
    const upload = cloudProfileForUpload(local, 9)
    expect(upload.revision).toBe(9)
    expect(upload.currency.coins).toBe(80)
    expect(upload.settings).toEqual(createDefaultProfile().settings)
    expect(local.revision).toBe(7)
    expect(local.settings.bgmVolume).toBe(0.12)
  })

  it('只有真实局外进度才算首次绑定时的“本地有东西”', () => {
    const cosmetic = profile((p) => {
      p.revision = 3
      p.settings.bgmVolume = 0.2
      p.selected.difficulty = 'hard'
      p.onboarding.tutorialSeen = true
    })
    expect(hasMeaningfulLocalProgress(cosmetic)).toBe(false)

    cosmetic.currency.coins = 1
    expect(hasMeaningfulLocalProgress(cosmetic)).toBe(true)

    const upgraded = profile((p) => {
      p.upgrades['student:skill'] = 1
    })
    expect(hasMeaningfulLocalProgress(upgraded)).toBe(true)
  })

  it('冲突摘要只列出内容不同的字段，不做自动合并', () => {
    const local = profile((p) => {
      p.currency.coins = 10
    })
    const cloud = profile((p) => {
      p.currency.coins = 20
      p.unlocks.characters.push('athlete')
    })
    expect(progressDifferences(cloudProgressSummary(local), cloudProgressSummary(cloud))).toEqual([
      '金币',
      '角色解锁',
    ])
  })
})

describe('设备同步游标', () => {
  it('按账号独立存储，并可往返解析', () => {
    const storage = new MemoryProfileStorage()
    const store = new CloudSyncMetaStore(storage, 'alice')
    const meta = markCloudSynced('alice', 8, 'fingerprint-8', 1000)
    expect(store.save(meta)).toBe(true)
    expect(store.load()).toEqual(meta)
    expect(storage.keys()).toEqual([cloudSyncMetaStorageKey('alice')])
    expect(parseCloudSyncMeta(meta, 'bob')).toBeNull()
  })

  it('损坏或其他账号的游标返回 null，不把坏数据当 revision 0 继续写', () => {
    const storage = new MemoryProfileStorage({
      [cloudSyncMetaStorageKey('alice')]: JSON.stringify({
        schemaVersion: 1,
        accountKey: 'bob',
        baseRevision: 99,
        lastSyncedFingerprint: 'x',
        lastSyncedAtMs: 1,
      }),
    })
    const store = new CloudSyncMetaStore(storage, 'alice')
    expect(store.load()).toBeNull()
    expect(store.lastError).toContain('其他账号')
  })
})

describe('云同步决策', () => {
  it('本地写盘失败时阻断，绝不把只存在于内存的进度上传', () => {
    const plan = planCloudSync({
      accountKey: 'alice',
      local: profile(),
      meta: null,
      cloud: null,
      localSaveOk: false,
    })
    expect(plan).toMatchObject({ kind: 'blocked', code: 'local-save-failed' })
  })

  it('首次绑定且只有本地：上传完整局外进度，base_revision 从 0 开始', () => {
    const local = profile((p) => {
      p.revision = 4
      p.currency.coins = 60
    })
    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: null,
      cloud: null,
      localSaveOk: true,
    })
    expect(plan.kind).toBe('upload')
    if (plan.kind === 'upload') {
      expect(plan.baseRevision).toBe(0)
      expect(plan.profile.revision).toBe(4)
      expect(plan.profile.currency.coins).toBe(60)
    }
  })

  it('首次绑定且只有云端：本地没有真实局外进度时自动下载', () => {
    const remote = profile((p) => {
      p.revision = 7
      p.currency.coins = 240
      p.unlocks.characters.push('athlete')
    })
    const plan = planCloudSync({
      accountKey: 'alice',
      local: profile(),
      meta: null,
      cloud: envelope(remote, 7),
      localSaveOk: true,
    })
    expect(plan.kind).toBe('download')
    if (plan.kind === 'download') expect(plan.revision).toBe(7)
  })

  it('首次绑定且本地、云端都有真实进度：必须让玩家选择，不能自动覆盖', () => {
    const local = profile((p) => {
      p.revision = 2
      p.currency.coins = 10
    })
    const remote = profile((p) => {
      p.revision = 8
      p.currency.coins = 90
    })
    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: null,
      cloud: envelope(remote, 8),
      localSaveOk: true,
    })
    expect(plan.kind).toBe('conflict')
    if (plan.kind === 'conflict') {
      expect(plan.baseRevision).toBe(8)
      expect(plan.differences).toContain('金币')
    }
  })

  it('只有本地内容变化：上传到已知云端 revision', () => {
    const base = profile((p) => {
      p.revision = 5
      p.currency.coins = 10
    })
    const local = cloneProfile(base)
    local.revision = 6
    local.currency.coins = 30
    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: markCloudSynced('alice', 5, syncFingerprint(base), 100),
      cloud: envelope(base, 5),
      localSaveOk: true,
    })
    expect(plan.kind).toBe('upload')
    if (plan.kind === 'upload') {
      expect(plan.baseRevision).toBe(5)
      expect(plan.profile.revision).toBe(6)
    }
  })

  it('只改了设备设置：本地 revision 前进但指纹没变，云端更新时仍然拉取', () => {
    const base = profile((p) => {
      p.revision = 5
      p.currency.coins = 10
    })
    const local = cloneProfile(base)
    local.revision = 9
    local.settings.bgmVolume = 0.05
    const remote = cloneProfile(base)
    remote.revision = 8
    remote.currency.coins = 50

    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: markCloudSynced('alice', 5, syncFingerprint(base), 100),
      cloud: envelope(remote, 8),
      localSaveOk: true,
    })
    expect(plan.kind).toBe('download')
  })

  it('本地和云端都产生了新进度：进入冲突而不是 409 后自动重试覆盖', () => {
    const base = profile((p) => {
      p.revision = 5
      p.currency.coins = 10
    })
    const local = cloneProfile(base)
    local.revision = 6
    local.currency.coins = 30
    const remote = cloneProfile(base)
    remote.revision = 8
    remote.currency.coins = 70
    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: markCloudSynced('alice', 5, syncFingerprint(base), 100),
      cloud: envelope(remote, 8),
      localSaveOk: true,
    })
    expect(plan.kind).toBe('conflict')
  })

  it('内容碰巧一致时直接推进游标，不因 revision 不同制造一次假上传', () => {
    const local = profile((p) => {
      p.revision = 2
      p.currency.coins = 30
    })
    const remote = cloneProfile(local)
    remote.revision = 8
    const plan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: markCloudSynced('alice', 5, syncFingerprint(local), 100),
      cloud: envelope(remote, 8),
      localSaveOk: true,
    })
    expect(plan).toEqual({
      kind: 'up-to-date',
      revision: 8,
      fingerprint: syncFingerprint(local),
    })
  })

  it('云端 revision 回退或内容无 revision 变化时拒绝覆盖', () => {
    const base = profile((p) => {
      p.revision = 5
      p.currency.coins = 10
    })
    const meta = markCloudSynced('alice', 5, syncFingerprint(base), 100)
    const regressed = planCloudSync({
      accountKey: 'alice',
      local: base,
      meta,
      cloud: envelope(base, 4),
      localSaveOk: true,
    })
    expect(regressed).toMatchObject({ kind: 'blocked', code: 'cloud-revision-regressed' })

    const mutated = cloneProfile(base)
    mutated.currency.coins = 99
    const silentChange = planCloudSync({
      accountKey: 'alice',
      local: base,
      meta,
      cloud: envelope(mutated, 5),
      localSaveOk: true,
    })
    expect(silentChange).toMatchObject({
      kind: 'blocked',
      code: 'cloud-changed-without-revision',
    })
  })

  it('未来 schema、信封不一致和坏载荷都拒绝', () => {
    const local = profile()
    const future = cloneProfile(local)
    future.schemaVersion += 1
    const futurePlan = planCloudSync({
      accountKey: 'alice',
      local,
      meta: null,
      cloud: {
        payload: future,
        schemaVersion: future.schemaVersion,
        revision: 1,
        updatedAt: null,
      },
      localSaveOk: true,
    })
    expect(futurePlan).toMatchObject({ kind: 'blocked', code: 'cloud-schema-newer' })

    const mismatch = planCloudSync({
      accountKey: 'alice',
      local,
      meta: null,
      cloud: {
        payload: local,
        schemaVersion: local.schemaVersion + 1,
        revision: 1,
        updatedAt: null,
      },
      localSaveOk: true,
    })
    expect(mismatch).toMatchObject({ kind: 'blocked', code: 'invalid-cloud-save' })

    const broken = planCloudSync({
      accountKey: 'alice',
      local,
      meta: null,
      cloud: { payload: {}, schemaVersion: 1, revision: 1, updatedAt: null },
      localSaveOk: true,
    })
    expect(broken).toMatchObject({ kind: 'blocked', code: 'invalid-cloud-save' })
  })
})

describe('云同步协调器', () => {
  it('只本地有档时上传，并在成功后保存设备游标', async () => {
    const storage = new MemoryProfileStorage()
    const profileStore = new ProfileStore({ storage })
    profileStore.load()
    const local = profile((p) => {
      p.revision = 4
      p.currency.coins = 60
    })
    profileStore.applyCloudProfile(local)
    const metaStore = new CloudSyncMetaStore(storage, 'alice')
    const transport = new FakeTransport([{ kind: 'empty' }])
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: profileStore,
      metaStore,
      transport,
      now: () => 1000,
    })

    const result = await sync.sync()
    expect(result).toMatchObject({ kind: 'uploaded', revision: 4 })
    expect(transport.uploadCalls).toHaveLength(1)
    expect(transport.uploadCalls[0]!.baseRevision).toBe(0)
    expect(metaStore.load()).toMatchObject({
      baseRevision: 4,
      lastSyncedFingerprint: syncFingerprint(profileStore.profile),
      lastSyncedAtMs: 1000,
    })
  })

  it('只有云端有进度时自动下载，并保留本机设置', async () => {
    const storage = new MemoryProfileStorage()
    const profileStore = new ProfileStore({ storage })
    profileStore.load()
    profileStore.setSettings({ bgmVolume: 0.15 })
    const remote = profile((p) => {
      p.revision = 8
      p.currency.coins = 300
      p.settings.bgmVolume = 1
    })
    const transport = new FakeTransport([{ kind: 'found', save: envelope(remote, 8) }])
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: profileStore,
      metaStore: new CloudSyncMetaStore(storage, 'alice'),
      transport,
      now: () => 2000,
    })

    expect(await sync.sync()).toMatchObject({ kind: 'downloaded', revision: 8 })
    expect(profileStore.profile.currency.coins).toBe(300)
    expect(profileStore.profile.settings.bgmVolume).toBe(0.15)
  })

  it('PUT 409 后重新 GET；上次其实成功时收敛为 up-to-date，不覆盖云端', async () => {
    const storage = new MemoryProfileStorage()
    const profileStore = new ProfileStore({ storage })
    profileStore.load()
    const base = profile((p) => {
      p.revision = 5
      p.currency.coins = 10
    })
    const local = cloneProfile(base)
    local.revision = 6
    local.currency.coins = 30
    profileStore.applyCloudProfile(local)

    const metaStore = new CloudSyncMetaStore(storage, 'alice')
    metaStore.save(markCloudSynced('alice', 5, syncFingerprint(base), 100))
    const transport = new FakeTransport(
      [
        { kind: 'found', save: envelope(base, 5) },
        { kind: 'found', save: envelope(local, 6) },
      ],
      [{ kind: 'conflict', revision: 6 }],
    )
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: profileStore,
      metaStore,
      transport,
      now: () => 3000,
    })

    expect(await sync.sync()).toMatchObject({ kind: 'up-to-date', revision: 6 })
    expect(transport.uploadCalls).toHaveLength(1)
    expect(metaStore.load()?.baseRevision).toBe(6)
  })

  it('网络失败只返回离线，不修改本地档或同步游标', async () => {
    const storage = new MemoryProfileStorage()
    const profileStore = new ProfileStore({ storage })
    profileStore.load()
    profileStore.update((draft) => {
      draft.currency.coins = 10
    })
    const before = profileStore.snapshot()
    const metaStore = new CloudSyncMetaStore(storage, 'alice')
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: profileStore,
      metaStore,
      transport: new FakeTransport([{ kind: 'error', message: '断网了' }]),
    })

    expect(await sync.sync()).toEqual({ kind: 'offline', message: '断网了' })
    expect(profileStore.snapshot()).toEqual(before)
    expect(metaStore.load()).toBeNull()
  })

  it('本地写盘失败时连 GET 都不发，避免显示虚假的同步成功', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const noisy = new ProfileStore({ storage: new ThrowingStorage() })
    noisy.load()
    noisy.update((draft) => {
      draft.currency.coins = 1
    })
    expect(noisy.lastError).not.toBeNull()
    const transport = new FakeTransport([{ kind: 'empty' }])
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: noisy,
      metaStore: new CloudSyncMetaStore(new MemoryProfileStorage(), 'alice'),
      transport,
    })

    expect(await sync.sync()).toMatchObject({
      kind: 'blocked',
      code: 'local-save-failed',
    })
    expect(transport.loadCalls).toBe(0)
    quiet.mockRestore()
  })

  it('同步游标读不出来时阻断，不把损坏的游标当成首次绑定', async () => {
    const storage = new MemoryProfileStorage({
      [cloudSyncMetaStorageKey('alice')]: '{broken',
    })
    const profileStore = new ProfileStore({ storage })
    profileStore.load()
    const transport = new FakeTransport([{ kind: 'empty' }])
    const sync = new CloudSyncCoordinator({
      accountKey: 'alice',
      store: profileStore,
      metaStore: new CloudSyncMetaStore(storage, 'alice'),
      transport,
    })

    expect(await sync.sync()).toMatchObject({
      kind: 'blocked',
      code: 'meta-read-failed',
    })
    expect(transport.loadCalls).toBe(0)
  })
})
