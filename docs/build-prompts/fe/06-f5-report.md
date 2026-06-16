# 06 · f5-report — 6단계(시뮬레이션 리포트)  ※ 완료 결과 필요 → MOCK MODE 권장

> 사용법: `fe/01-foundation.md` 완료 후, 새/같은 세션에 아래 프롬프트를 붙여넣으세요.

---

## 프롬프트

너는 **f5-report** 기능(6단계: AI 분석 리포트 + 결과 다운로드)을 `frontend`에 구현한다. 실제 리포트는 **완료된 계산 결과 디렉터리**가 필요하므로(로컬 시뮬레이션엔 보통 없음) **MOCK MODE를 기본 경로로** 만들고 실제 호출을 얹는다.

### 먼저 읽어라 (단일 소스)
- `docs/features/f5-report/api.md` — `POST /generate-report`(요청 `{job_dir, property, lang}` → `{status, report(markdown), summary{final_energy, target_property}, is_multi}`), `GET /download-job/{job_name}`.
- `docs/contracts/data-models.md` — `ReportRequest`, `ReportData`, `SimulationArtifacts`, `MultiMetadata`(f5는 디스크 산출물/문자열만 소비, JobStatus는 소비 안 함).
- `docs/design-system.md` §4.2(6단계).

### 만들 것 (`app/(wizard)/step-6`)
1. **리포트 생성**: 진입/버튼에서 `POST /generate-report`(body=store의 `job_dir`(=SubmitJobResponse.directory)/property/lang). 응답의 `is_multi`로 단일/다중-CIF 리포트를 구분한다.
2. **렌더링**: 응답 `report`(마크다운)를 `react-markdown` + KaTeX(`rehype-katex`/`remark-math`)로 렌더(수식 지원). `summary`(final_energy/target_property)와 스텝별 표를 KPI 카드/테이블로. **수렴 차트는 `step_histories` 기준 스텝별로 분리**(스텝 탭 또는 스텝별 개별 차트 — 여러 스텝을 한 차트에 합치지 말 것). **다중-CIF(`is_multi`)면** 구조 간 **비교 리포트**로 — 구조별 final_energy/target_property를 나란히 비교하는 표/차트를 추가하고, 구조별 스텝 차트는 구조 탭 아래에 둔다. 리포트 본문은 **`report_absorption.html` 형식의 7섹션**(1.요약 2.구조 3.방법 4.물성 데이터 5.해석 6.품질 7.후속)으로 오고 **흡수 스펙트럼 곡선은 없으며**, 다중-CIF의 §4 '구조별 주요 물성 종합 비교' 표(행=구조, 열=전체에너지+타겟 물성+영역/분류; 동일에너지면 isostructural)를 표로 또렷이 렌더한다.
3. **다운로드**: [전체 결과 (.tar.gz)] → `GET /download-job/{job_name}`(blob 저장). [새 분석 시작] → wizard-store **`reset()`**(상태 초기화 + `persist.clearStorage()`로 localStorage 비움; design-system §4.6) 후 step-1.

### ★ MOCK MODE
`NEXT_PUBLIC_MOCK === "1"`이거나 완료 결과가 없으면:
- `/generate-report`를 `data-models.md`의 `ReportData` 형태 샘플(마크다운 본문 + summary + per-step)로 대체. 마크다운/수식/표/KPI/스텝별 수렴 차트가 실제처럼 렌더되어야 함. (샘플 마크다운도 위 7섹션 구조를 따르고, 다중 시연 시 §4 구조별 물성 종합 비교 표를 포함.)
- 다중-CIF 시연용으로 `is_multi=true`에 구조 2개 이상을 비교하는 샘플도 준비(비교 표/차트가 렌더되게).
- 다운로드는 비활성 또는 더미.

### 완료 정의 (DoD)
- [ ] (MOCK) 6단계에서 마크다운 리포트(수식 포함)·KPI·스텝 표가 제대로 렌더된다.
- [ ] 수렴 차트가 `step_histories` 기준 **스텝별로 분리**되어(스텝 탭/개별 차트) 렌더된다.
- [ ] 다중-CIF(`is_multi`)면 구조 간 비교 표/차트가 렌더되고, 구조별 스텝 차트가 구조 탭 아래에 표시된다.
- [ ] `ReportData` 계약과 응답 처리(`summary=={}` 등 에러 축약형 방어 — api.md의 status 덧씌움 주의 참고).
- [ ] 실제 결과가 있으면 `NEXT_PUBLIC_MOCK` 끄고 `/generate-report`로 동작.
- [ ] [새 분석 시작]이 `reset()`(상태 + localStorage 초기화)으로 비우고 1단계로 복귀.
