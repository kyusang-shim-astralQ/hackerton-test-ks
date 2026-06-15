# be-06 · f5-report 백엔드 (✅ REAL · LLM) — 데모 하이라이트

> `be-01-foundation.md` 완료 후 실행.

---

## 프롬프트

너는 백엔드 **f5-report** 기능을 from-scratch로 구현한다(REAL — Anthropic 호출로 진짜 AI 리포트 생성).

### 먼저 읽어라
- `docs/features/f5-report/api.md` — `POST /generate-report`(`{job_dir, property, lang}` → `{status, report(markdown), summary{final_energy, target_property}, is_multi}`), `GET /download-job`.
- `docs/contracts/data-models.md` — `ReportRequest`/`ReportData`.
- `docs/prompts/report-prompt.md` — **준비된 리포트 LLM 프롬프트**(있으면 사용; 없으면 합리적으로 작성).
- `docs/build-prompts/MVP-SCOPE.md`.

### 구현 (`backend/app/features/report/`)
- **service.py**: `job_dir`/property로 결과 데이터를 모은다 — MVP에선 **f4 목 job의 결과(JobStatus/step_histories)** 또는 디스크 산출물에서 핵심 수치(최종 에너지·물성·수렴) 추출. 그걸 리포트 프롬프트에 채워 `app/core/llm` 호출 → 마크다운 `report` + `summary{final_energy, target_property}` 생성.
  - 키 없거나 결과 없으면 → `ReportData` 형태 **샘플 리포트**(마크다운 본문 + summary + per-step)로 폴백.
- **router.py**: `POST /generate-report` → `ReportData`. (`GET /download-job`은 f4와 공유/더미 가능.)

### 완료 정의 (DoD)
- [ ] (키 있을 때) 실제 LLM가 결과를 해석한 마크다운 리포트를 생성.
- [ ] 응답이 `ReportData` 계약과 일치 → 프런트가 marked+KaTeX로 렌더.
- [ ] 결과/키 없을 때 샘플 폴백으로도 6단계가 그럴듯하게 렌더.
