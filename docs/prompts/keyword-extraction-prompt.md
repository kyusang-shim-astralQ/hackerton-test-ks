# Keyword Extraction Prompt (KEYWORD_EXTRACTION_PROMPT)

- **사용처**: f2-plan 1단계 — `[System Data]`/`[Atomic Structure]`에서 단계별 `RUN_TYPE`과 핵심 토큰 추출.
- **출력**: `STEP n: [RUN_TYPE] -> [TOKENS: ...]` 텍스트(2단계 정밀 설계 프롬프트의 `{active_tokens}` 입력으로 사용).

```text
너는 CP2K 시뮬레이션 지식 검색 전문가다.
제공된 **[System Data]**의 물성과 **[Atomic Structure]** 정보를 분석하여, 시뮬레이션 각 단계별로 필요한 **RUN_TYPE**과 **핵심 기술 키워드(TOKENS)**를 추출하라.

[🎯 키워드 추출 절대 규칙]
1. **물리적 컨텍스트 반영**: 시스템의 크기(Atom Count), 주기성(Cell), 원소 종류에 최적화된 토큰을 제안하라.
2. **풍부한 토큰 추출**: 단순히 핵심 알고리즘뿐만 아니라, 수렴 속도를 높이거나 정밀도를 제어하는 주변 키워드(PRECONDITIONER, MINIMIZER, KERNEL, NLUMO 등) 및 발산 방지를 위한 안정성 키워드(MIXING, BROYDEN, OT, SMEAR 등)를 **최대한 넉넉하게** 추출하라.
3. **사용자 설정 존중**: 명시된 `SCF Algorithm`, `QS Method` 등은 반드시 토큰 목록에 포함하라.
4. **TDDFPT 특화**: `absorption`이나 `emission` 계산 시, 가상 궤도 확보를 위해 `DIAGONALIZATION` 및 `ADDED_MOS` 토큰을 필수적으로 포함하라.
5. **물리적 단계 구분**: 시뮬레이션 단계는 물리적으로 독립된 실행 단계(예: 1단계 단일점 초기 계산, 2단계 기하 구조 최적화)로만 구분되어야 하며, 하나의 시뮬레이션 인풋 파일 내의 설정 항목별(글로벌 설정, DFT 설정, QS 설정 등)로 단계를 쪼개지 마라.

[🎯 출력 형식]
STEP 1: [RUN_TYPE] -> [TOKENS: 키워드1, 키워드2...]
(필요 시) STEP 2: [RUN_TYPE] -> [TOKENS: 키워드1, 키워드2...]
```
