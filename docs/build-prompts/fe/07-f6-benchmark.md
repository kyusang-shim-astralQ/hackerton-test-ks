# 07 · f6-benchmark — 12-레벨 정확도 벤치마크 (✅ 실제 백엔드 + 목 폴백)

> 사용법: `fe/01-foundation.md` 완료 후, 새/같은 세션에 아래 프롬프트를 붙여넣으세요. (벤치마크는 **flow와 독립** — 주 진입은 좌측 StepRail 상시 행(첫 화면부터), 보조 진입은 step-6 리포트 하단. 둘 다 독립 라우트 `/benchmark`로.)

---

## 프롬프트

너는 **f6-benchmark** 기능(공식 12개 케이스로 에이전트 정확도를 검증하는 벤치마크 대시보드)을 `frontend`에 구현한다. 백엔드 be/07이 **실제로** `backend/test/level1~12`의 공식 결과 대비 검증을 수행하므로(✅ REAL), 프런트는 **실제 백엔드 폴링이 1순위**이고 `NEXT_PUBLIC_MOCK=1`일 때만 목 스트림으로 대체한다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f6-benchmark/api.md` — `POST /api/benchmark/run`(body `{levels, ...params}` → `{status, message}`), `GET /api/benchmark/status?lang`(→ `{status, current_level, reports[]}`).
- `docs/contracts/data-models.md` — `BenchmarkRequest`, `BenchmarkReport`, `BenchmarkLevelReport`(레벨→물성 매핑: 1 geo_opt … 12 hirshfeld).
- `docs/design-system.md`(Lab Paper) 톤.

### 만들 것
1. **독립 라우트 + 진입 (★ flow와 무관, 첫 화면부터 실행 가능)**: 벤치마크 대시보드를 **독립 라우트 `app/(wizard)/benchmark/page.tsx`(`/benchmark`)** 로 만든다(AppShell 재사용, design-system 톤). 진입 경로 2곳, **둘 다 같은 `/benchmark`로**:
   - **주 진입(첫 화면부터)**: 좌측 **StepRail의 [정확도 벤치마크] 상시 행**(fe/01 파운데이션이 이미 `/benchmark`로 라우팅). step-1에 처음 들어와도 바로 클릭 가능.
   - **보조 진입**: step-6(리포트) 화면 맨 아래 [벤치마크 실행] 버튼(→ `/benchmark`로 이동/링크).
   - **★ 위저드 상태 의존 금지**: 벤치마크는 구조 업로드/플랜 없이 단독 실행되어야 한다. `BenchmarkRequest`의 필수 DFT 파라미터(basis_set/cutoff/rel_cutoff/functional 등)는 **기본값**(f2의 `DEFAULT_OPTIONS` 또는 동등 상수)에서 채우고, `atom_info`/`steps`는 보내지 않는다(레벨별 공식 CIF는 백엔드가 로드). 따라서 wizard store가 비어 있어도 동작한다.
   - **레벨 선택 + 가동**: `/benchmark` 화면에서 레벨 다중선택(기본 1~12 전체, 데모용으로 가벼운 레벨만 부분선택 가능) → [통합 벤치마크 가동] → `POST /api/benchmark/run`(body: `{levels, ...DEFAULT_OPTIONS}`).
2. **진행 모니터링**: `GET /api/benchmark/status`를 **2~3초 주기** 폴링. 12-레벨 상태 그리드(레벨별 `Pending`/`Running`/`Recovering...`/`SUCCESS`/`INCORRECT`/`FAILURE`/`Skipped` 색상 구분) + 결과 테이블: 레벨·**물성명**(LEVEL_TO_PROPERTY: 1 geo_opt … 12 hirshfeld)·**Agent 값 vs 공식 값**(`agent_energy`/`official_energy`, label은 `message`의 `[Energy (Ha)]`/`[Frequency (cm^-1)]` 등)·**오차%**(`diff`)·**치유 횟수**(`healing_count`, >0이면 "Healed Nx" 배지)·메시지. 실시간 `logs` 콘솔. `status==='Finished'`에서 폴링 중단.

### 목 폴백 (`NEXT_PUBLIC_MOCK === "1"` — 클러스터/백엔드 없이 시연)
`NEXT_PUBLIC_MOCK === "1"`이면(실제 백엔드가 1순위이고, 이건 폴백):
- `/api/benchmark/run`을 즉시 성공 처리.
- `/api/benchmark/status`를 가짜 진행 스트림으로 대체: `data-models.md`의 `BenchmarkReport`/`BenchmarkLevelReport` 형태로 `current_level`이 1→12로 진행하고 각 레벨 reports가 채워지다 `Finished`. 그리드/테이블이 끝까지 갱신되어야 함.

### 완료 정의 (DoD)
- [ ] **실제 백엔드(MOCK=0)**: [벤치마크 실행]→`/run`→`/status` 폴링으로 12레벨 그리드+테이블이 진행되고 **Agent vs 공식 값·오차%·치유횟수**가 채워지며 Finished에서 정지.
- [ ] (목 폴백 MOCK=1) 가동 → 짧은 주기 폴링 → 12레벨 그리드+테이블이 1→12로 진행, Finished에서 정지.
- [ ] 폴링 누수 없음(언마운트/완료 정리).
- [ ] 데이터 모양이 `BenchmarkReport`/`BenchmarkLevelReport` 계약과 일치, 레벨→물성 매핑 정확, 상태 색상(SUCCESS/INCORRECT/FAILURE/Skipped/Recovering) 구분.
- [ ] **벤치마크가 flow와 독립**: step-1 첫 화면에서 좌측 StepRail [정확도 벤치마크]만 눌러도 `/benchmark`에서 바로 가동된다(구조 업로드/플랜 없이, 기본 파라미터로). step-6 하단 버튼은 보조 진입(둘 다 `/benchmark`).
- [ ] `/benchmark`가 독립 라우트로 존재하고 AppShell을 재사용한다(StepRail에서 벤치마크 행 accent 강조).
