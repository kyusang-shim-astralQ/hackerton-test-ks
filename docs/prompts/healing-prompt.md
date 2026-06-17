# Healing Prompt (자가치유 — `heal_with_ai`) — ★ reference 원문 그대로

> 이 프롬프트는 self_healing의 `heal_with_ai`가 쓰는 **reference 원문**이다(영문, `[CP2K XML SCHEMA REFERENCE]` 주입 포함). f4 재구현(be/05 B-4) 시 이 텍스트를 `prompts.py`로 모아 `f-string`으로 채운다. **임의로 줄이거나 `@PARAM/`·한글화 등으로 바꾸지 말 것** — 그건 폐기된 가공물이다.

- **사용처**: f4-jobs(그리고 f6 벤치마크) — CP2K 실패 시 `.out` 로그를 읽고 `.inp`를 자동 수정. Claude API **3번째 호출 지점**(① 플랜 ② **치유** ③ 리포트).
- **모델/파라미터**: `max_tokens = 1000`. 모델 id는 **`claude-api` 스킬 확인**(reference는 `claude-sonnet-4-6` 사용; 코드에 박지 말고 설정/스킬 기준). 호출은 `app/core/llm`(Anthropic) 경유.
- **placeholders**(`f-string`): `{system_context}`, `{has_kpts}`(`"YES"`/`"NO"`), `{current_inp}`(현재 `.inp` 전문), `{xml_context}`(`schema_engine.get_manual_snippet` 토큰별 합본), `{core_error}`, `{log_tail}`(★ reference는 **원본 log_tail 그대로** 주입 — 압축본 아님), `{history_msg}`.
- **`system_context` 구성**(reference 그대로):
  ```text
  - Atom Count: {atom_count}
  - Cell Size: {cell}
  - Periodic: {periodic}
  - Mode: {mode} (If BENCHMARK, follow reference paths strictly)
  - Current SCF Algo: {scf_algo} (USER INTENT: Do NOT change this algorithm. Focus on adjusting parameters instead.)
  - Target Property: {property}
  - Elements: {el1, el2, ...}
  ```

## 프롬프트 본문 (verbatim)

```text
[SYSTEM CONTEXT]
{system_context}
K-POINTS ACTIVE: {has_kpts} (CRITICAL: If YES, OT algorithm is NOT allowed!)

[FAILED INPUT STRUCTURE]
This is the input file that caused the error. Look for logical contradictions in its hierarchy:
{current_inp}

[CP2K XML SCHEMA REFERENCE]
{xml_context}

[CORE ERROR MESSAGE FROM LOG]
{core_error}

[DETAILED LOG FOOTER]
{log_tail}

[VALIDATION & ATTEMPT HISTORY]
{history_msg}
(Note: If keywords were recently dropped, suggest a different path or parameter combination that fits the schema.)

[CP2K EXPERT KNOWLEDGE]
1. OT Compatibility: OT (Orbital Transformation) is FAST but works ONLY for systems with a Large Gap and NO K-POINTS. 
   - If K-POINTS is YES, suggest &DFT/&SCF/&DIAGONALIZATION.
2. Large Systems (>100 atoms): Convergence often requires Smearing.
   - Suggest adding &DFT/&SCF/&SMEAR with &DFT/&SCF/ADDED_MOS (at least 20-50).
3. Memory/Convergence: If SCF sloshes, reduce &DFT/&SCF/&MIXING/ALPHA to 0.1.
4. Benchmark Sync: If Mode is BENCHMARK, preserve the original section names (e.g., &XC_FUNCTIONAL PBE) instead of splitting them.
5. NO SUBSYS: Do NOT suggest or modify anything under &SUBSYS (COORD, CELL, KIND). This is strictly managed by the agent.
6. PRESERVE the user's requested [Current SCF Algo]. If convergence fails, adjust MIXING, ALPHA, SMEAR, or ADDED_MOS instead of changing the algorithm itself.

[MISSION]
1. Analyze the [CORE ERROR MESSAGE] in the context of [SYSTEM CONTEXT] and [FAILED INPUT STRUCTURE].
2. Identify why the current input failed (e.g., path mismatch, invalid algo for system size, or missing required sub-section).
3. Provide a contextual fix in 'Path-based' format. Ensure paths are precise and follow the [CP2K XML SCHEMA REFERENCE].
4. DO NOT include &END tags.
5. NEVER suggest modifications to COORD, CELL, or KIND.
6. PRESERVE the user's requested [Current SCF Algo]. If convergence fails, adjust MIXING, ALPHA, SMEAR, or ADDED_MOS instead of changing the algorithm itself.

[FORMAT]
REASON_KR: (에러 원인에 대한 정밀한 분석 결과, 한글 1문장)
FIX_KR: (이 시스템 맥락에 맞는 구체적인 해결책, 한글 1문장)
REASON: (Brief English explanation focusing on why this fix works for this specific system)
FIX:
&DFT/&SCF/&DIAGONALIZATION/ALGORITHM STANDARD
&DFT/&SCF/&MIXING/ALPHA 0.1
```

## 응답 파싱 (reference verbatim — be/05 B-4와 동일)
- `reason_kr = re.search(r"REASON_KR:\s*(.*)", text).group(1) if "REASON_KR:" in text else "분석 중..."`
- `fix_kr   = re.search(r"FIX_KR:\s*(.*)", text).group(1) if "FIX_KR:" in text else "수정 중..."`
- `reason_en= re.search(r"REASON:\s*(.*)", text).group(1) if "REASON:" in text else "AI Analysis"`
- `fix_part = text.split("FIX:")[1] if "FIX:" in text else text`
- `fix_lines = [l.strip() for l in fix_part.splitlines() if '/' in l and len(l.split()) >= 2]`
- `fix_lines` 있으면 `last_attempt={"signature":sig,"reason":reason_en,"fixes":fix_lines}` → 트리에 `_deep_update` → `validate_and_correct` → 3-튜플 `(options, [log], msg)`. 없으면/예외면 `(options, [실패문구], "AI 분석 실패")`.

> ※ FIX는 `&`-경로형(`&DFT/&SCF/...`, `&END` 금지)이며 `'/'` 포함 + 2토큰 이상 줄만 채택된다. 코드 측 `parse_path_based_options`가 `&`를 제거하고 경로로 분해한다.
