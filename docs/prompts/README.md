# docs/prompts — LLM 프롬프트 (반입 자산 = 에이전트의 뇌)

CP2K 에이전트의 Claude 호출에 쓰는 **프롬프트 원본**입니다. 사전 준비(반입) 자산이며, 빌드 시 각 기능의 `prompts.py`로 들어가고 호출부는 import만 합니다(CLAUDE.md §6).

| 파일 | 사용처 | 비고 |
|---|---|---|
| `keyword-extraction-prompt.md` | f2-plan 1단계 | RUN_TYPE·핵심 토큰 추출 |
| `plan-prompt.md` (UNIFIED) | f2-plan 2단계 | 정밀 플랜 설계 → JSON `{expert_tip, steps[]}`. **`be/03`이 사용** |
| `report-prompt.md` | f5-report | 단일 구조 리포트(마크다운). **`be/06`이 사용** |
| `comparative-report-prompt.md` | f5-report | 다중 구조 비교 리포트 |

**템플릿 변수**: Python `str.format()` 플레이스홀더 — `{xml_context}`, `{active_tokens}`, `{user_config}`, `{context}`. `plan-prompt`의 JSON 예시에 있는 `{{ }}`는 `.format` 이스케이프(실제 전송 시 `{ }`로 치환됨).

> 백지 MVP에서 f2/f5는 이 프롬프트로 실제 LLM 호출을 한다(데모 하이라이트). 키가 없으면 빌드 프롬프트가 목 폴백.
