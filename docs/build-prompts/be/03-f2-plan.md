# be/03 · f2-plan 백엔드 (✅ REAL · LLM) — 데모 하이라이트

> `be/01-foundation.md` 완료 후 실행.

---

## 프롬프트

너는 백엔드 **f2-plan** 기능을 from-scratch로 구현한다(REAL — Anthropic 호출로 진짜 멀티스텝 플랜 생성). 이게 데모의 핵심이다.

### 먼저 읽어라
- `docs/features/f2-plan/api.md` — `POST /generate-plan` 계약(`PlanRequest` → `{atom_info, steps[], expert_tip}`).
- `docs/contracts/data-models.md` — `PlanRequest`/`PlanStep`/`PlanResult` 필드.
- `docs/prompts/plan-prompt.md` — **준비된 플랜 LLM 프롬프트**(있으면 사용; 없으면 합리적 프롬프트를 작성하되 출력이 `PlanStep[]` JSON이 되도록).
- `docs/build-prompts/MVP-SCOPE.md`.

### 구현 (`backend/app/features/plan/`)
- **service.py**: `PlanRequest`(atom_info + property + DFT params)로 플랜 프롬프트를 채워 `app/core/llm`을 통해 Anthropic 호출 → 응답을 파싱해 `steps[]`(각 `PlanStep`: step_name/run_type/inp_options/selected/…)와 `expert_tip` 생성. 항상 `req.atom_info`를 결과에 에코. **JSON 파싱 견고하게**(코드펜스 제거 등).
  - `CLAUDE_API_KEY`가 없거나 호출 실패 시 → `data-models.md`의 `PlanResult` 형태 **목 플랜**(예: GeomOpt→SCF→Band→DOS)으로 폴백해 흐름 유지.
- **router.py**: `POST /generate-plan` → `{atom_info, steps[], expert_tip}`.

### 완료 정의 (DoD)
- [ ] (키 있을 때) 실제 LLM가 구조/물성에 맞는 `steps[]`를 생성.
- [ ] 응답이 `PlanResult` 계약과 일치(프런트가 그대로 소비).
- [ ] 키 없을 때 목 폴백으로도 흐름이 끊기지 않음.
