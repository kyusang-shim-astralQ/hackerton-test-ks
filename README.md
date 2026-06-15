# CP2K Agent — 해커톤 모노레포

> 신소재 후보 결정구조(`.cif`)만 넣으면, AI가 CP2K 물성 계산을 **자동으로 셋업·실행·자가수정·리포트**까지 끝낸다.

## 시작하기
1. 루트 **`CLAUDE.md`** 를 먼저 읽으세요 — 프로젝트 헌법(Claude Code가 자동 로드).
2. 빌드는 **`docs/build-prompts/00-README.md`** 의 순서대로 (파운데이션 → 기능).
3. 분업·타임라인은 `docs/build-prompts/WORKPLAN.md`, real/stub 경계는 `MVP-SCOPE.md`.

## 구조
```
.
├── CLAUDE.md        # 프로젝트 헌법 (필독)
├── docs/            # 계약·디자인·빌드 프롬프트 (단일 소스)
├── backend/         # FastAPI — 해커톤 당일 빌드
├── frontend/        # Next.js — 해커톤 당일 빌드
└── reference/       # (gitignored) 레거시 코드 참조용 — 백지 빌드엔 미포함
```

## 실행
```bash
# Backend (:8000)
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
# Frontend (:3000)
cd frontend && npm install && npm run dev
```
env: `CLAUDE_API_KEY`(backend/.env) · `NEXT_PUBLIC_API_BASE=http://localhost:8000` · `NEXT_PUBLIC_MOCK=1`(frontend/.env.local, 클러스터 없이 시연).
