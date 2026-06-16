# be/07 · f6-benchmark 백엔드 (🔴 MOCK)

> `be/01-foundation.md` 완료 후 실행. (시간 남을 때 — 우선순위 낮음)

---

## 프롬프트

너는 백엔드 **f6-benchmark** 기능을 from-scratch로 구현한다(MOCK — 클러스터 없이 12레벨 가짜 진행).

### 먼저 읽어라
- `docs/features/f6-benchmark/api.md` — `POST /api/benchmark/run`(`{levels, ...params}` → `{status, message}`), `GET /api/benchmark/status?lang`(→ `{status, current_level, reports[]}`).
- `docs/contracts/data-models.md` — `BenchmarkRequest`/`BenchmarkReport`/`BenchmarkLevelReport`(레벨→물성 매핑: 1 geo_opt … 12 hirshfeld).
- `docs/build-prompts/MVP-SCOPE.md`(🔴 MOCK).

### 구현 (`backend/app/features/benchmark/`)
- **service.py**: 인메모리 벤치마크 상태 + 백그라운드 가짜 진행기. `run` 호출 시 `current_level`을 1→12로 진행시키며 각 레벨 `reports[]`(level/status/agent_energy/official_energy/diff/message)를 채우다 `status="Finished"`.
- **router.py**: `POST /api/benchmark/run` → 시작. `GET /api/benchmark/status?lang=ko` → `{status, current_level, reports[]}`(폴링마다 진행).

### 완료 정의 (DoD)
- [ ] 가동 → `/api/benchmark/status` 폴링으로 12레벨이 1→12 진행, `Finished`에서 정지.
- [ ] 데이터가 `BenchmarkReport`/`BenchmarkLevelReport` 계약과 일치, 레벨→물성 매핑 정확.
- [ ] (명시) 실제 벤치마크 실행은 MVP 밖.
