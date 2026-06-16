# 07 · f6-benchmark — 12-레벨 정확도 벤치마크  ※ 클러스터 의존 → MOCK MODE 필수

> 사용법: `fe/01-foundation.md` 완료 후, 새/같은 세션에 아래 프롬프트를 붙여넣으세요. (벤치마크는 메인 6단계와 별개 트랙)

---

## 프롬프트

너는 **f6-benchmark** 기능(공식 12개 케이스로 에이전트 정확도를 검증하는 벤치마크 대시보드)을 `frontend`에 구현한다. 실제 실행은 **클러스터가 필요**하므로 **MOCK MODE를 1순위로** 만든다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f6-benchmark/api.md` — `POST /api/benchmark/run`(body `{levels, ...params}` → `{status, message}`), `GET /api/benchmark/status?lang`(→ `{status, current_level, reports[]}`).
- `docs/contracts/data-models.md` — `BenchmarkRequest`, `BenchmarkReport`, `BenchmarkLevelReport`(레벨→물성 매핑: 1 geo_opt … 12 hirshfeld).
- `docs/design-system.md`(Lab Paper) 톤.

### 만들 것
1. **진입/실행**: 벤치마크 화면(예: 1단계 내 진입 버튼 또는 별도 라우트 `app/(wizard)/benchmark` — design-system 톤 유지). [통합 벤치마크 가동] → `POST /api/benchmark/run`.
2. **진행 모니터링**: `GET /api/benchmark/status?lang=ko`를 **3초 주기** 폴링. 12-레벨 상태 그리드(레벨별 Pending/Running/Success/Skipped) + 결과 테이블(Agent 에너지 vs 공식 에너지 vs 오차). `status==='Finished'`에서 폴링 중단.

### ★ MOCK MODE (클러스터 없이 시연)
`NEXT_PUBLIC_MOCK === "1"`이면:
- `/api/benchmark/run`을 즉시 성공 처리.
- `/api/benchmark/status`를 가짜 진행 스트림으로 대체: `data-models.md`의 `BenchmarkReport`/`BenchmarkLevelReport` 형태로 `current_level`이 1→12로 진행하고 각 레벨 reports가 채워지다 `Finished`. 그리드/테이블이 끝까지 갱신되어야 함.

### 완료 정의 (DoD)
- [ ] (MOCK) 가동 → 3초(목은 더 짧게) 폴링 → 12레벨 그리드+테이블이 1→12로 진행, Finished에서 정지.
- [ ] 폴링 누수 없음(언마운트/완료 정리).
- [ ] 데이터 모양이 `BenchmarkReport`/`BenchmarkLevelReport` 계약과 일치, 레벨→물성 매핑 정확.
- [ ] 실제 클러스터 있으면 `NEXT_PUBLIC_MOCK` 끄고 동일 UI가 실제 엔드포인트로 동작.
