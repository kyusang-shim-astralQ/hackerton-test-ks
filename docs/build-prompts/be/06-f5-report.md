# be/06 · f5-report 백엔드 (✅ REAL · LLM) — 실제 결과 → AI 리포트

> `be/01-foundation.md` 완료 후 실행. (f4가 완료 결과를 로컬 `simulations/{job_dir}/`에 회수해 둔 상태에서 실제 리포트가 나온다.)

---

## 프롬프트

너는 백엔드 **f5-report** 기능을 from-scratch로 구현한다(REAL — 실제 CP2K 결과 `.out`을 파싱해 Anthropic으로 AI 리포트 생성). **실제 결과가 있으면 절대 샘플로 빠지지 않는다.**

### 먼저 읽어라
- `docs/features/f5-report/api.md` — `POST /generate-report`(`{job_dir, property, lang}` → `{status, report(markdown), summary{final_energy, target_property}, is_multi}`), `GET /download-job`.
- `docs/contracts/data-models.md` — `ReportRequest`/`ReportData`/`SimulationArtifacts`/`MultiMetadata`.
- `docs/prompts/report-prompt.md` — **준비된 리포트 LLM 프롬프트**.
- `docs/build-prompts/MVP-SCOPE.md`.

### 구현 (`backend/app/features/report/`)
- **service.py**: `job_dir`/property로 **실제 결과 디렉터리 `simulations/{job_dir}/`** 를 walk하며 산출물에서 핵심 수치를 추출:
  - **최종 에너지**: `ENERGY| Total FORCE_EVAL ...` 라인(필요 단위 변환 — a.u.→eV `×27.2114` 등 명시).
  - **property별 물성**: `.out`(+필요 시 `.pdos`/`.bs`)에서 정규식으로 추출(원본 `PHYSICS_PATTERNS`류; 없으면 합리적 정규식 작성). 12종 중 요청 property에 해당하는 값.
  - **단계별 수렴 이력**: `.out`(또는 f4가 남긴 step_histories)에서 스텝별 SCF/에너지 → 리포트 표/차트 데이터.
  - 결과가 로컬에 없고 원격에만 있으면 f4의 회수를 트리거하거나 SSH로 직접 읽는다.
- 추출 수치를 **report-prompt에 채워 `app/core/llm` 호출** → 마크다운 `report` + `summary{final_energy, target_property}` 생성.
- **다중-CIF**(`multi_metadata.json` 존재)면 `is_multi=true`로 구조별 결과를 모아 **구조 간 비교 리포트**(구조별 final_energy/물성 비교 표 + 구조 탭).
- **폴백(데모 안전망)**: 결과 파일/키가 **없을 때만** → `ReportData` 형태 **샘플 리포트**로 폴백하되, 본문에 "샘플(실측 아님)"임을 명시. (실제 `.out`이 있으면 반드시 실측 기반 리포트.)
- **리포트 형식(7섹션 — `report_absorption.html` 구조)**: report-prompt(단일)/comparative-report-prompt(다중)가 **1.요약 2.계산 대상 구조 3.계산 방법 4.물성 데이터 5.결과 해석 6.계산 품질 평가 7.권장 후속**의 마크다운을 생성. §4는 **단일=타겟 물성 결과표 / 다중=구조별 주요 물성 종합 비교 표**(행=구조, 열=전체에너지+타겟 물성 핵심수치+영역/분류, 동일에너지면 isostructural 해석 노트). **흡수 스펙트럼 전용 섹션·곡선은 만들지 않는다.**
- **router.py**: `POST /generate-report` → `ReportData{... is_multi}`.

### 완료 정의 (DoD)
- [ ] 실제 `.out`이 있을 때 그 수치(최종 에너지·물성·수렴)를 파싱해 **LLM이 해석한 실측 마크다운 리포트**를 생성(샘플 아님).
- [ ] `summary.final_energy`/`target_property`가 `.out` 실제 값과 일치.
- [ ] 다중-CIF면 `is_multi=true`로 구조 간 비교 표/차트.
- [ ] 결과/키가 **없을 때만** 샘플 폴백이며, "샘플"임을 명시(실측이 있으면 절대 샘플로 빠지지 않음).
- [ ] `ReportData` 계약과 응답 형태 일치 → 프런트가 marked+KaTeX로 렌더.
