# MVP 스코프 — 백지(from-scratch) 2시간 빌드 기준

> reference 코드 없이 2시간에 **"작동하는 AI 에이전트 데모"** 를 만들기 위한 real/stub 경계. 모든 백엔드 빌드 프롬프트(be/*)는 이 문서를 기준으로 동작합니다.

## 핵심 전략
**에이전트의 지능(LLM 프롬프트)은 진짜로, 무거운 결정론적 배관은 단순화/목.**
→ "구조 올리면 AI가 계산을 설계하고·입력을 만들고·결과를 해석한다"는 흐름이 진짜로 돌고, 34MB 스키마 검증 같은 무거운 배관만 단순화. **f4 작업 제출은 SSH/SGE로 실제 클러스터에 올린다(`USE_SGE=1`)** — 클러스터 없으면 목 폴백.

## 가져올 것 (사전 준비 = 허용)
- **LLM 프롬프트**(에이전트의 뇌): 플랜 생성·리포트 프롬프트를 `docs/prompts/plan-prompt.md`, `docs/prompts/report-prompt.md`로 준비. (기존 `prompts.py`에서 가져와 다듬기 — 프롬프트는 반입 허용.)
- **계약/디자인**: `docs/` 전체(api.md·data-models·design-system·build-prompts).
- (반입 허용 시) `cp2k_input.xml`·`basis_map.json` — 있으면 f3 정확도↑, 없으면 템플릿으로.

## 기능별 real vs stub
| 기능 | MVP 구현 | 내용 |
|---|---|---|
| **f1 구조** | ✅ REAL | ASE(`ase.io.read`)로 CIF 파싱 → `atom_info`(data-models 형태). 캐시는 dict/JSON. |
| **f2 플랜** | ✅ REAL | Anthropic 호출 + 플랜 프롬프트 → `steps[]`. (API 키 필요) **← 데모 하이라이트** |
| **f3 INP** | 🟡 SIMPLE | 34MB 스키마 엔진 대신 **문자열 템플릿**으로 `.inp` 생성. 완전 검증은 생략. |
| **f4 제출/모니터** | ✅ REAL (SSH/SGE) | `paramiko`로 클러스터(`CLUSTER_*`) 접속 → `.inp`+`run.sh` 업로드 → 실제 `qsub` → `qstat` 폴링 → 결과 회수(`app/core/sge.py`). **실패 시 AI 자가치유(진단→`.inp` 수정→재시도 MAX 3)**. `USE_SGE=0`/연결 실패 시 목 스트림 폴백. |
| **f5 리포트** | ✅ REAL | **실제 `.out` 파싱** + Anthropic 리포트 프롬프트 → 마크다운 리포트. 결과 없을 때만 샘플 폴백. **← 데모 하이라이트** |
| **f6 벤치마크** | 🔴 MOCK | 12레벨 가짜 진행. (시간 남으면) |

> **f4 실제 실행 전제**: `.env`에 `USE_SGE=1` + `CLUSTER_*`/`CP2K_*` 설정(값은 `.env`만, **절대 커밋 금지**). 미설정/`USE_SGE=0`이면 목 폴백으로 흐름은 그대로 시연된다.

## 데모 메인 경로 (진짜 도는 것)
**f1 파싱 → f2 AI 플랜 → f3 INP 생성 → f4 실제 SGE 실행(SSH; 목 폴백) → f5 AI 리포트(실측 `.out` 파싱).**
= "CIF 올리면 AI가 계획·입력·해석"하는 풀 흐름이 실제로 작동.

## 명시적으로 "안 하는 것" (MVP 범위 밖)
완전 스키마 검증(34MB `schema_engine`), 자가치유 **지식베이스 학습**(`record_success`), `physics_rules` 전체. (f4 **실제 SGE 제출 + 경량 AI 자가치유**(진단→`.inp` 수정→재시도 MAX 3)는 **범위 안** — `core/sge.py` SSH + `docs/prompts/healing-prompt.md`.)
→ reference 코드가 허용되면 지식베이스 학습·스키마 검증을 별도로 이식해 강화하면 됨(별도 프롬프트 세트).
