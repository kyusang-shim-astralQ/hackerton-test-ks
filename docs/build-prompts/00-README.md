# 해커톤 빌드 프롬프트 (Option A) — 사용법

이 폴더는 **사전 코드 없이** 해커톤 당일 작동하는 앱을 즉시 생성하기 위한 **빌드 프롬프트(md)** 모음입니다.
각 프롬프트는 **새(콜드) Claude Code 세션**에 그대로 붙여넣어 쓰도록 자급자족으로 작성되어 있습니다 — 우리 대화 맥락 없이도, 프롬프트가 스펙 파일을 직접 읽고 빌드합니다.

> 시뮬레이션 방법: 이 세션이 아닌 **새 Claude Code 세션**을 프로젝트 루트(clone한 repo 루트)에서 열고, 아래 순서대로 각 파일의 "프롬프트" 블록을 붙여넣으세요.

## 무엇을 빌드하나
- **확정 디자인**: Lab Paper (밝은 과학 논문 톤). 시각 기준 = `docs/design-system.md`.
- **스택**: Next.js(App Router) + TypeScript + Tailwind + shadcn/ui + lucide-react + 3Dmol.js + react-chartjs-2.
- **백엔드**: **모노레포의 `backend/`를 from-scratch로 빌드**(MVP — 깊은 엔진은 단순화/목). 각 엔드포인트는 `docs/features/<도메인>/api.md` 계약을 따른다. real/stub 경계는 **`MVP-SCOPE.md`** 참조.
- **모노레포 구조**: 한 repo에 `docs/`(계약) + `backend/`(FastAPI) + `frontend/`(Next.js). **한 사람이 한 기능을 풀스택(FE+BE)으로 소유** → 분업/타임라인은 **`WORKPLAN.md`** 참조.
- **포트**: 백엔드 `:8000`, 프런트 `:3000`(프런트가 `NEXT_PUBLIC_API_BASE=http://localhost:8000`로 호출).

## 프롬프트가 의존하는 스펙(콜드 세션이 읽음)
- `docs/design-system.md` — 토큰·레이아웃·컴포넌트·CSS 함정(§4.5)·원본 델타(§8) · **시각 레퍼런스(source of truth)**
- `docs/ARCHITECTURE.md`, `docs/backend-structure.md` — 전체 구조 맥락
- `docs/contracts/data-models.md` — cross-feature 데이터 계약
- `docs/features/f1-structure ~ f6-benchmark/api.md` — 기능별 HTTP 계약

## 실행 순서 (자세한 분업·타임라인은 `WORKPLAN.md`)
1. **파운데이션 먼저(FE·BE 병행 가능)**: `be/01-foundation.md`(백엔드 스캐폴드) + `fe/01-foundation.md`(프런트 스캐폴드). **반드시 먼저.**
2. **기능별(한 사람 = 한 기능 풀스택)**: 자기 기능의 **`be/0X`(백엔드) + `fe/0X`(프런트)** 를 함께 실행. f1~f6. 여러 명이면 병렬, 혼자면 f1→f6 순서.
3. 경계/분업 참조: real/stub은 **`MVP-SCOPE.md`**, 분업·타임라인·데모 시나리오는 **`WORKPLAN.md`**.

각 프롬프트 끝의 **완료 정의(DoD)** 가 통과하면 다음으로 넘어가세요.

### 의존성 / 병렬 규칙
- **fe/01은 하드 의존성**: fe/02~07은 fe/01이 만든 공유 스캐폴드(앱·토큰·3-존 셸·공유 컴포넌트·스토어·API 클라이언트·라우트 자리)에 의존한다. **fe/01이 `npm run dev`로 정상 기동하는 것을 확인한 뒤** fe/02~07을 시작한다.
- **fe/02~07은 병렬 가능**: 각 기능은 자기 단계 라우트(`app/(wizard)/step-N/`)와 기능 폴더(`features/<도메인>/`)만 소유하므로 서로 막지 않는다. fe/01이 공유 표면(store/steps/i18n/api base)을 전부 확정하므로(fe/01-foundation의 "병렬 안전" 절) 같은 파일을 동시에 안 건드린다.
- **단, 동시 실행 방식 주의**:
  - **여러 사람/세션이 동시에** 같은 `frontend` 트리를 작업하면 → **git 브랜치 또는 worktree를 기능별로** 분리해 작업 후 머지(공유 파일 충돌 방지의 안전망).
  - **혼자 한 세션으로 시뮬레이션**하면 → 한 세션은 본질적으로 순차이므로 **02 → 07 순서로** 실행(병렬은 "여러 세션"일 때 의미). 각 기능 프롬프트는 상위 데이터가 없으면 목/시드로 단독 동작하도록 작성되어 있어 순서를 바꿔도 빌드는 됨(단 end-to-end 흐름 확인은 02→07 순서가 편함).

## 사전 준비 (가동)
1. `backend/.env`에 `CLAUDE_API_KEY=...` 설정(f2·f5 LLM 호출용).
2. **백엔드는 `be/01~07` 프롬프트로 from-scratch 빌드**. 빌드 후 의존성(예): `fastapi uvicorn anthropic ase python-dotenv pydantic` (CIF 파싱에 `ase`).
3. 백엔드 실행: `backend/`에서 `uvicorn app.main:app --reload --port 8000` → `http://localhost:8000` (CORS `*`).
4. 프런트 실행: `frontend/`에서 `npm run dev` → `http://localhost:3000` (`NEXT_PUBLIC_API_BASE=http://localhost:8000`).

## "정확히 돌아가는지" — 현실적 기대치 (중요)
로컬 시뮬레이션에서 **완전 동작**하는 것과 **클러스터 필요**한 것이 갈립니다:
- ✅ **로컬에서 진짜 동작**: f1 `/analyze-cif`(구조 분석), f2 `/generate-plan`(Claude 키 필요), f3 `/generate-inp`(결정론적). → 실제 백엔드 응답으로 화면이 채워짐.
- ⚠️ **Faraday SGE 클러스터 필요(로컬엔 없음)**: f4 `/submit-job`·`/job-live-status`·`/job-stop`, f6 벤치마크 실행, f5는 완료된 결과 디렉터리 필요. → 이 부분은 **MOCK MODE**(아래)로 빌드해 흐름을 끝까지 시연.
- 각 기능 프롬프트는 `NEXT_PUBLIC_MOCK=1`일 때 클러스터 의존 엔드포인트를 **계약(api.md/data-models.md) 형태의 목 데이터**로 대체하도록 지시합니다. → 클러스터 없이도 6단계 전체가 "돌아가는" 걸 확인 가능.

## 핵심 규칙(콜드 세션이 지킬 것)
- 디자인은 **design-system.md를 단일 소스**로(토큰 하드코딩 금지). CSS 함정 §4.5(스크롤 체인 `min-height:0`, `height`가 stretch 무력화, `.card+.card` 그리드 마진)를 반드시 준수.
- API 요청/응답 모양은 **그 기능의 api.md + data-models.md를 단일 소스**로. 임의로 바꾸지 말 것.
- 공유 컴포넌트는 `components/ui`에만 정의, 각 기능은 import만(일관성).
