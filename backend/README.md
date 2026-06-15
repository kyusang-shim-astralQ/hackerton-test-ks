# backend/ — FastAPI (해커톤 당일 빌드)

이 폴더는 **빈 상태로 시작**해서 해커톤 당일 빌드 프롬프트로 생성합니다(백지 MVP).

- 빌드: `docs/build-prompts/be-01-foundation.md` → `be-02 ~ be-07`(기능별)
- 구조 규약: `docs/backend-structure.md` (package-by-feature: `app/features/<도메인>/{router,service,schemas}.py`)
- 계약(단일 소스): `docs/features/<도메인>/api.md` + `docs/contracts/data-models.md`
- LLM 프롬프트: `docs/prompts/*.md` → 빌드 시 `prompts.py`
- 실행: `uvicorn app.main:app --reload --port 8000` · env `CLAUDE_API_KEY`
