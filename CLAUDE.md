# CLAUDE.md — 프로젝트 헌법 (모든 작업 전 필독)

> 이 문서는 Claude Code가 **매 작업마다 자동으로 읽는 단일 기준서**다. (그래서 **repo 루트**에 둔다.)
> 여기 적힌 규칙은 사용자의 다른 지시보다 우선하지 않지만, **충돌 시 반드시 사용자에게 먼저 확인**한다.
> 새 규칙이 생기면 흩어진 메모가 아니라 **이 파일에 추가**한다.

---

## 0. 한 줄 정의 (문제 정의 명확성 — 평가 15%)

**"신소재 후보 결정구조(.cif)만 넣으면, CP2K 물성 계산을 자동으로 셋업·실행·자가수정·리포트까지 끝내는 파이프라인."**

- **누가 쓰나:** 계산재료과학 연구자 / 소재 R&D 팀
- **어떤 고통을 없애나:** CP2K 입력파일(.inp) 작성은 전문가도 수 시간~수일이 걸리고, 키워드 한 줄 틀리면 계산이 죽는다. 에러 진단·재시도 루프가 연구의 병목이다.
- **우리의 가치 명제 (데모·영상 첫 문장에 그대로 쓸 것):**
  > "DFT 계산 입력 셋업·디버깅에 드는 **연구자 1인당 주 N시간**을, 업로드 한 번으로 **분 단위**로 줄인다."
  - 숫자(N)는 데모 전 팀이 합의해 채운다. **모든 기능 PR 설명에 "이 기능이 줄이는 비용"을 한 줄 적는다.**

---

## 1. 비즈니스 가치 — 코드 짤 때 항상 의식할 것 (평가 40%, 최고 가중치)

기능을 추가/수정할 때 스스로 묻는다: **"이게 사용자의 시간·비용·실패율 중 무엇을 줄이는가?"**
답이 불명확하면 그 기능은 데모에서 빠질 후보다. 우선순위는 아래 가치 순서를 따른다.

1. **셋업 자동화** — .cif → 검증된 .inp (가장 큰 시간 절감, 데모의 핵심)
2. **자가수정 루프** — 에러 → 자동 진단 → 재계산 (실패율 절감, 우리만의 차별점)
3. **리포트 자동화** — 결과 → 사람이 읽는 물성 요약 (의사결정 가속)
4. **대시보드** — 진행상황 가시화 (신뢰·운영성)

> 동점 시 비즈니스 가치로 선정된다. 화려한 기능보다 **"숫자로 말할 수 있는 절감"**을 만든다.

---

## 2. 프로젝트 지도 — 어디에 뭐가 있나 (작업 전 해당 문서부터 읽기)

모든 작업의 단일 소스는 `docs/`다. 추측 대신 아래를 먼저 읽는다.

- **계약 (데이터/엔드포인트 — 단일 소스):**
  - `docs/contracts/data-models.md` — 기능 경계를 넘나드는 데이터 계약(필드/타입/예시)
  - `docs/features/<도메인>/api.md` — 기능별 HTTP 계약. 도메인 6개: **f1-structure · f2-plan · f3-inp · f4-jobs · f5-report · f6-benchmark**
- **디자인 (프런트):**
  - `docs/design-system.md` — 확정 디자인 **Lab Paper** 및 **시각 기준(source of truth)**: 토큰·3-존 레이아웃·**CSS 함정(§4.5)**·컴포넌트
- **구조:**
  - `docs/backend-structure.md` — 백엔드 폴더 규약(package-by-feature)
  - `docs/ARCHITECTURE.md` — 전체 기능 지도·의존성 그래프
- **해커톤 빌드:**
  - `docs/build-prompts/00-README.md` — 사용법·순서·기대치
  - `docs/build-prompts/WORKPLAN.md` — **분업·2시간 타임라인·데모 시나리오**
  - `docs/build-prompts/MVP-SCOPE.md` — **무엇을 진짜로/목으로** (백지 MVP 경계)
  - `fe/01-foundation`+`be/01-foundation`(파운데이션), `fe/02~07`+`be/02~07`(기능별 FE+BE)

> 규칙: 디자인은 `design-system.md`, 데이터/엔드포인트는 해당 `api.md`+`data-models.md`를 **단일 소스**로 삼는다. 토큰·필드를 임의로 만들지 않는다.

---

## 3. 아키텍처 & 스택

```
모노레포 (repo 루트)
├── docs/        계약·디자인·빌드프롬프트 (단일 소스)
├── backend/     FastAPI (package-by-feature)
└── frontend/    Next.js (Lab Paper)
```

- **Backend:** Python 3.11+ / FastAPI. 구조는 `docs/backend-structure.md` 준수:
  `backend/app/{ main.py, core/(config·llm·sge), schemas/common.py, shared/, features/<f1..f6>/(router·service·schemas).py }`
- **Frontend:** **Next.js(App Router) + TypeScript + Tailwind + shadcn/ui**, 디자인 **Lab Paper(`docs/design-system.md`)**. 대시보드는 폴링으로 작업 상태 표시.
- **AI:** Anthropic Claude — 최신·최강 모델. 모델 id·파라미터·가격은 기억 말고 **`claude-api` 스킬 확인**.
- **env 키:** **`CLAUDE_API_KEY`**(LLM) + **클러스터(SSH/SGE) `USE_SGE`·`CLUSTER_HOST`/`CLUSTER_PORT`/`CLUSTER_USER`/`CLUSTER_PASSWORD`·`CLUSTER_REMOTE_ROOT`·`CLUSTER_QUEUE`·`CLUSTER_PE`·`CLUSTER_MPI_RANKS`·`CP2K_ROOT`/`CP2K_DATA_DIR`/`CP2K_MPIEXEC`/`CP2K_SETVARS`**(f4 실제 제출용). **전부 하드코딩 금지 — `.env`(gitignore)만**; 특히 `CLUSTER_PASSWORD`는 로그·응답·문서에도 노출 금지.
- **포트:** backend `:8000`, frontend `:3000` (`NEXT_PUBLIC_API_BASE=http://localhost:8000`).
- **배포(선택):** Replit(Autoscale) 등. 로컬 시뮬레이션은 위 :8000/:3000.
- 데모는 가능한 **실제 결과**로: 클러스터 연결 시 **`USE_SGE=1`**로 f4가 실제 `qsub` 제출→결과로 f5가 실측 리포트. 클러스터 없으면 **`USE_SGE=0`**(백엔드 목) + 프런트 **`NEXT_PUBLIC_MOCK=1`**로 6단계 전체를 끝까지 시연.

### 폴더 = 소유권 (병렬 충돌 방지)
**한 사람이 한 기능을 풀스택으로 소유** — 자기 것만 건드린다:

| 소유 범위 | 무엇 |
|---|---|
| `backend/app/features/<도메인>/` | 그 기능의 router·service·schemas |
| `frontend/features/<도메인>/` + 자기 store 슬라이스 + `frontend/lib/i18n/<도메인>.ts` | 그 기능의 화면 |
| **공유(변경 시 합의·알림)**: `docs/`, `backend/app/{core,schemas,shared}`, `frontend/components/ui`, store 골격 | 모든 기능이 의존 |

**다른 사람 폴더는 수정하지 않는다.** 필요하면 계약을 고치고 알린다. 배분·타임라인은 `docs/build-prompts/WORKPLAN.md`.

---

## 4. 계약 우선 원칙 (Contract-First)

- 프론트·백은 서로의 코드에 직접 의존하지 않고 **`docs/features/<도메인>/api.md` + `docs/contracts/data-models.md`만 참조**한다.
- 상대 기능이 아직 없으면 **mock/seed로 진행**한다 (idle 금지).
- 계약을 바꾸려면: ① 먼저 해당 `api.md`/`data-models.md` 수정 → ② 팀에 알림 → ③ 양쪽 반영.
- **계약에 없는 필드를 임의로 추가하지 않는다.**

---

## 5. CP2K 도메인 규칙 — 환각 방지 (실행 안정성의 핵심)

> ⚠️ **LLM은 그럴듯하지만 존재하지 않는 CP2K 키워드·BASIS_SET·PSEUDOPOTENTIAL을 잘 만든다.**
> 생성된 .inp는 **검증 없이 신뢰하지 않는다.**

- **.inp 생성 후 반드시 검증 게이트를 통과시킨다:**
  1. CP2K 섹션 계층(`&GLOBAL`, `&FORCE_EVAL`, `&SUBSYS`, `&DFT` 등) 구조 검사
  2. 참조한 `BASIS_SET` / `POTENTIAL` 이름이 **실제 데이터 파일에 존재하는지** 대조 (추측 금지)
  3. 좌표·셀 정보는 **ASE가 .cif에서 파싱한 값**을 쓴다 — LLM이 좌표를 지어내지 않게 한다
- 검증 실패 → 사용자에게 보여주고 **자가수정 루프**로 넘긴다.
- **자가수정 루프 안전장치:** `MAX_RETRIES`(예: 3) 초과 시 멈추고 에스컬레이트 / 매 재시도 "무엇을 왜 고쳤는지" 로그(대시보드·리포트 노출) / 같은 에러 반복 시 즉시 중단.
- 단위·물리량(에너지/길이)은 명시적으로 다룬다.

> **백지 MVP 주의:** 완전 스키마 검증 대신 **템플릿 수준**으로 시작한다(`docs/build-prompts/MVP-SCOPE.md`). reference 코드가 허용되면 `schema_engine` 이식으로 강화.

---

## 6. AI 도구 활용 — 보이게 만들기 (평가 20%)

심사 기준은 "Claude를 **제대로** 썼는가"다. 작동만 시키지 말고 **활용이 드러나게** 한다.

- **Claude API 호출 지점 3곳:** ① 플랜/.inp 생성(f2-plan) ② 에러 진단·수정(자가치유) ③ 리포트 작성(f5-report).
- 각 호출은 **구조화된 출력(JSON 스키마 / tool use)** 으로 받는다 — 파싱 깨짐 방지.
- 프롬프트는 호출 코드에 흩지 말고 **`docs/prompts/*.md`로 준비(반입 자산)** 하여, 빌드 시 각 기능의 **`prompts.py`** 로 모은다. 호출부는 import만.
- **자가수정 과정을 UI/리포트에 노출** → "AI가 에러를 읽고 스스로 고쳤다"가 데모 하이라이트.
- 개발 과정도 Claude Code(서브에이전트·슬래시커맨드)로 했음을 영상에 보여준다.
- 모델 id·파라미터·가격은 **`claude-api` 스킬**을 먼저 확인. 토큰 한도·타임아웃 설정(비용 폭주 방지).

---

## 7. 데모 & 제출 규칙 (실행 품질 25% — 안정적 동작 = 점수)

> **제출 데모는 가능한 실제 결과를 분석해 보여준다.** 클러스터 없는 환경은 `MVP-SCOPE.md`의 목 모드로 6단계 흐름을 끝까지 시연(`f1→f2→f3→f4→f5`).

- **데모용 .cif는 가볍고 빠르게 수렴하는 계를 미리 골라 검증**해 둔다(`samples/`). 당일 처음 보는 무거운 계는 금지.
- 본 데모 전에 **같은 입력으로 끝까지 도는지 사전 리허설**(시간 측정 포함)을 반드시 한 번.
- **폴백 안전망:** 리허설 실제 결과/로그를 보관해, 라이브가 실패하면 그 실제 결과로 매끄럽게 전환("데모 모드" 플래그).
- 라이브 시 **진행상황·자가수정 로그 실시간 노출** = 하이라이트.
- **main은 항상 green.** 통합자가 계속 합친다.
- **조기 제출 + 30분마다 업데이트.** **마감 20분 전 새 기능 금지**(버그픽스·안정화·리허설만).
- 데모 영상: **문제·가치(숫자) → 라이브 데모(계산→자가수정→리포트) → 향후 운영(확장성)**.

---

## 8. 코딩 규칙 / 금지사항

- **하지 말 것**
  - 다른 담당자 폴더 수정 / 계약 외 필드 임의 추가
  - 검증 안 된 LLM 생성 .inp를 그대로 실행
  - 비밀키 하드코딩 — 반드시 환경변수(Secrets/.env)
  - 데모 직전 대규모 리팩터링 / 무한 재시도 / 한도 없는 API 호출
- **할 것**
  - 작은 단위로 자주 커밋, 항상 동작하는 상태 유지
  - 새 의존성·환경변수 추가 시 이 문서·README에 반영
  - 에러는 사용자에게 **읽을 수 있게** 보여준다(대시보드)
  - 디자인/구조는 §2의 docs를 단일 소스로, 주변 코드 스타일을 따른다

---

## 9. 실행 방법

```bash
# Backend (:8000)
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
# Frontend (:3000)
cd frontend && npm install && npm run dev

# 환경변수
# backend/.env  (값은 .env에만 — 절대 커밋 금지, .gitignore 확인)
CLAUDE_API_KEY=...
USE_SGE=1                 # 1=실제 SGE(SSH) 제출, 0=목 스트림 폴백
CLUSTER_HOST=...  CLUSTER_PORT=22  CLUSTER_USER=...  CLUSTER_PASSWORD=...
CLUSTER_REMOTE_ROOT=...  CLUSTER_QUEUE=...  CLUSTER_PE=...  CLUSTER_MPI_RANKS=...
CP2K_ROOT=...  CP2K_DATA_DIR=...  CP2K_MPIEXEC=...  CP2K_SETVARS=...
# frontend/.env.local
NEXT_PUBLIC_API_BASE=http://localhost:8000
NEXT_PUBLIC_MOCK=0        # 실제 백엔드 연결(USE_SGE=1). 클러스터 없이 목만 시연할 땐 1
```

---

## 10. 권장 추가 자산 (플레이북)

- `docs/prompts/*.md` — 플랜·에러진단·리포트 LLM 프롬프트(반입 자산, 빌드 시 `prompts.py`로)
- `.claude/agents/` — `inp-generator`, `cp2k-debugger` 같은 도메인 전담 서브에이전트
- `.claude/commands/` — `/new-calc`, `/fix-inp` 등 자주 쓰는 단축 명령
- `samples/` — 데모용 .cif 입력 + 미리 계산된 결과(폴백용)
