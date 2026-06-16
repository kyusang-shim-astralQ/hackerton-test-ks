# RUNSHEET — 2인(BE/FE 분담) 실행 순서

> 백엔드 개발자 / 프론트엔드 개발자가 **각자 자기 Claude Code 세션**(자기 clone)에서 위→아래로 순서대로 실행.
> **프롬프트 호출**: 해당 파일을 **통째로 복사해 붙여넣기**(파일 자체가 프롬프트). 한 번에 하나씩 → 그 파일 맨 아래 **완료 정의(DoD)** 통과 확인 → **커밋**.

---

## 0. 공통 셋업 (둘 다 · ~10분)
- repo clone한 폴더에서 **Claude Code를 루트에서 열기** (`CLAUDE.md` 자동 로드).
- **git 전략(2인 권장): `main` 하나(trunk-based)** — push 전 `git pull --rebase`, 커밋은 항상 도는 상태로. (BE는 `backend/`, FE는 `frontend/`만 건드려 충돌 거의 0. 격리를 원하면 `backend`/`frontend` 브랜치 후 통합 시 main 머지 — `dev` 브랜치는 불필요.)
- **BE**: `backend/.env` → `CLAUDE_API_KEY=...` (f2·f5 LLM, 필수)
- **FE**: `frontend/.env.local` → `NEXT_PUBLIC_API_BASE=http://localhost:8000` , `NEXT_PUBLIC_MOCK=1`
- 둘 다 `00-README.md` 훑기.

---

## 1. 백엔드 개발자 — 순서대로 (`:8000` 띄워두기)

| # | 실행 프롬프트 | 확인 (DoD 요약) | 끝나면 |
|---|---|---|---|
| 1 | **`be/01-foundation`** | `uvicorn app.main:app --reload --port 8000` → `/health` 200, `/docs` | **commit (+push)** |
| 2 | **`be/02-f1-structure`** | `/analyze-cif`에 CIF 업로드 → `atom_info`(좌표). 여러 파일이면 프런트가 파일별 호출 | commit |
| 3 | **`be/03-f2-plan`** ⭐ | `/generate-plan` → 실제 LLM `steps[]` (물성 **1개** 기준) | commit |
| 4 | **`be/04-f3-inp`** | `/generate-inp` → `.inp` (다중-CIF면 **구조별 × 스텝별**) | commit |
| 5 | **`be/06-f5-report`** ⭐ | `/generate-report` → LLM 마크다운 (다중이면 **비교 리포트**) | commit |
| 6 | **`be/05-f4-jobs`** (MOCK) | `/submit-job`+`/job-live-status` → **`step_histories` 스텝별** 채움, 다중이면 `sub_jobs` N개 | commit |
| 7 | **`be/07-f6-benchmark`** (MOCK·여유 시) | `/api/benchmark/*` 가짜 12레벨 | commit |

⭐ = 데모 하이라이트(실제 Claude 호출).

---

## 2. 프론트엔드 개발자 — 순서대로 (`:3000`, MOCK으로 시작)

| # | 실행 프롬프트 | 확인 | 끝나면 |
|---|---|---|---|
| 1 | **`fe/01-foundation`** | `npm run dev` → 3-존 셸, 전역 무스크롤, 우측 패널 토글 | **commit (+push)** |
| 2 | **`fe/02-f1-structure`** | 1단계: **여러 CIF 업로드** → 3D·메타데이터, 구조 전환 탭 | commit |
| 3 | **`fe/03-f2-plan`** | 2단계 물성 **단일 선택(12개 중 1개·라디오)** + 3단계 옵션(**k 입력 없음**) → 플랜 | commit |
| 4 | **`fe/04-f3-inp`** | 4단계: 플랜 편집(제외 토글) → INP(다중이면 구조별 그룹) | commit |
| 5 | **`fe/06-f5-report`** | 6단계: 마크다운 리포트(다중이면 비교 표) | commit |
| 6 | **`fe/05-f4-jobs`** | 5단계: 로그 + **스텝별 수렴 차트**(step1→그래프1, step2→그래프2…) + STOP, 다중이면 서브잡 탭 | commit |
| 7 | **`fe/07-f6-benchmark`** (여유 시) | 벤치마크 12레벨 그리드(목) | commit |

→ 처음 `NEXT_PUBLIC_MOCK=1`로 단독 진행 → BE 엔드포인트 뜨면 **MOCK 끄고** f1→f2→f3→f5 실연결.

---

## 3. 통합 체크포인트
- **(A) 파운데이션 직후**: FE 셸 + BE `/health`.
- **(B) 척추 양쪽 끝나면**: FE `NEXT_PUBLIC_MOCK=0` → **f1→f2→f3→f5 실연결** 확인.
- **f4 / f6은 MOCK 유지**(클러스터 없음). 어긋나면 그 기능 `api.md`/`data-models.md` 계약부터 맞춤.

---

## 4. 2시간 타임라인 (권장)
| 시각 | 할 일 |
|---|---|
| 0:00–0:10 | 공통 셋업(§0) |
| 0:10–0:30 | 파운데이션: BE `be/01` / FE `fe/01` + 기동 확인 |
| 0:30–1:20 | **척추**: f1→f2→f3→f5 (각자 `be/0X` / `fe/0X`) |
| 1:20–1:40 | f4(목 모니터·스텝별 차트) + **통합 end-to-end**(MOCK off) |
| 1:40–1:55 | f6(여유 시) + 버그픽스 |
| 1:55–2:00 | **데모 리허설**: f1→f2→f3→(f4 목)→f5 클릭스루 |

---

## 5. 데모 척추 (심사에서 보일 흐름)
**CIF(여러 개 가능) 업로드 → 물성 1개 선택 → AI 플랜(f2, 실제 LLM) → INP 생성(f3) → (f4 목 실행 + 스텝별 수렴 차트) → AI 리포트(f5, 실제 LLM; 다중이면 구조 비교).**
> 시간 부족 시: f6 → f4 디테일 순으로 줄이고 **f1→f2→f3→f5 척추는 사수**.

---

## 6. 이번 반영된 피드백 (스펙에 baked-in)
- **여러 CIF 처리**(f1 업로드 → f3 구조별 inp → f4 서브잡 → f5 비교 리포트)
- **물성 단일 선택**(12개 중 1개, 라디오)
- **K-point 완전 제거**(모든 계산 Gamma-point, k 입력·표시 없음)
- **스텝별 수렴 그래프 분리**(step1→그래프1, step2→그래프2 …, `step_histories` 기준)
