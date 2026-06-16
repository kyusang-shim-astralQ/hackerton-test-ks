# frontend/ — Next.js (해커톤 당일 빌드)

이 폴더는 **빈 상태로 시작**해서 해커톤 당일 빌드 프롬프트로 생성합니다.

- 빌드: `docs/build-prompts/fe/01-foundation.md` → `fe/02 ~ 07`(기능별)
- 디자인(단일 소스): `docs/design-system.md` (Lab Paper) · 시각 기준(source of truth)도 `docs/design-system.md`
- 스택: Next.js(App Router) + TypeScript + Tailwind + shadcn/ui
- 계약: `docs/features/<도메인>/api.md` + `docs/contracts/data-models.md`
- 실행: `npm run dev`(:3000) · env `NEXT_PUBLIC_API_BASE=http://localhost:8000`, `NEXT_PUBLIC_MOCK`
