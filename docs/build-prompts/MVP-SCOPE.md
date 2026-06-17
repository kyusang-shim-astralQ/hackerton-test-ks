# MVP 스코프 — 백지(from-scratch) 2시간 빌드 기준

> reference 코드 없이 2시간에 **"작동하는 AI 에이전트 데모"** 를 만들기 위한 real/stub 경계. 모든 백엔드 빌드 프롬프트(be/*)는 이 문서를 기준으로 동작합니다.

## 핵심 전략
**에이전트의 지능(LLM 프롬프트)은 진짜로, 무거운 결정론적 배관은 단순화/목.**
→ "구조 올리면 AI가 계산을 설계하고·입력을 만들고·결과를 해석한다"는 흐름이 진짜로 돈다. **f3 `.inp` 생성(schema_engine/XML)·f4 자가치유·SGE 제출의 원래 로직을 be/04·be/05 명세대로 재구현**한다(코드는 복사하지 않고 md 명세만으로 작성; XML 등 **데이터만 반입**). 클러스터 없으면 `USE_SGE=0` 목 폴백.

## 가져올 것 (사전 준비 = 허용)
- **LLM 프롬프트**(에이전트의 뇌): 플랜 생성·리포트 프롬프트를 `docs/prompts/plan-prompt.md`, `docs/prompts/report-prompt.md`로 준비. (기존 `prompts.py`에서 가져와 다듬기 — 프롬프트는 반입 허용.)
- **계약/디자인**: `docs/` 전체(api.md·data-models·design-system·build-prompts).
- **데이터만 반입(f3/f4 — 필수)**: `cp2k_input.xml`(+`.cache.pkl`)·`basis_map.json`·`healing_knowledge.json`를 `backend/app/shared/`에 둔다. **코드(schema_engine·self_healing·physics_rules·inp 로직)는 복사하지 않고 be/04·be/05 명세대로 재구현**한다.

## 기능별 real vs stub
| 기능 | MVP 구현 | 내용 |
|---|---|---|
| **f1 구조** | ✅ REAL | ASE(`ase.io.read`)로 CIF 파싱 → `atom_info`(data-models 형태). 캐시는 dict/JSON. |
| **f2 플랜** | ✅ REAL | Anthropic 호출 + 플랜 프롬프트 → `steps[]`. (API 키 필요) **← 데모 하이라이트** |
| **f3 INP** | ✅ REAL (명세 재구현) | **`schema_engine`(cp2k_input.xml)로 스키마 인식 렌더 + 3-pass `validate_and_correct`**. be/04 명세대로 재구현(코드 복사 아님, 문자열 템플릿 아님). |
| **f4 제출/모니터** | ✅ REAL (SSH/SGE) | be/05 명세대로 orchestrator+self_healing **재구현**(진단→KB heal→AI heal→재시도≤3, 좌표 체이닝). SGE는 `app/core/sge.py` SSH로. **다중-CIF는 구조별 독립 자가치유**. `USE_SGE=0` 시 목. |
| **f5 리포트** | ✅ REAL | **실제 `.out` 파싱** + Anthropic 리포트 프롬프트 → 마크다운 리포트. 결과 없을 때만 샘플 폴백. **← 데모 하이라이트** |
| **f6 벤치마크** | ✅ REAL (명세 재구현) | `backend/test/level1~12` 공식 결과 대비 12레벨 자동 검증(CIF→플랜→INP→SSH제출→치유→오차비교). be/07 명세대로 재구현. `USE_SGE=0`이면 공식결과 폴백으로 흐름 시연. **데이터 `backend/test/` 반입 필요.** |

> **f4 실제 실행 전제**: `.env`에 `USE_SGE=1` + `CLUSTER_*`/`CP2K_*` 설정(값은 `.env`만, **절대 커밋 금지**). 미설정/`USE_SGE=0`이면 목 폴백으로 흐름은 그대로 시연된다.

## 데모 메인 경로 (진짜 도는 것)
**f1 파싱 → f2 AI 플랜 → f3 INP 생성 → f4 실제 SGE 실행(SSH; 목 폴백) → f5 AI 리포트(실측 `.out` 파싱).**
= "CIF 올리면 AI가 계획·입력·해석"하는 풀 흐름이 실제로 작동.

## 명시적으로 "안 하는 것" (MVP 범위 밖)
(f3 inp·f4 자가치유·f6 벤치마크·schema_engine·self_healing·physics_rules는 **be/04·be/05·be/07 명세대로 원래 로직을 재구현 — 더 이상 단순화 아님**. 단 코드 복사는 안 함.) — 더 이상 목으로 두는 핵심 기능은 없다.
→ ⚠️ f3/f4 동작엔 **데이터 파일** `cp2k_input.xml`(+`.cache.pkl`)·`basis_map.json`·`healing_knowledge.json`이 backend(`app/shared/`)에, **f6 동작엔 `backend/test/level1~12/`(공식 CIF·INP·calculation.out)** 가 있어야 한다(코드는 명세로 재구현, 데이터만 반입).
