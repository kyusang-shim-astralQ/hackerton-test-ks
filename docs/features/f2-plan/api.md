# AI 시뮬레이션 플랜 생성 (AI Simulation Plan Generation) — `f2-plan`

> **한 줄 책임:** `atom_info`와 DFT 파라미터(`PlanRequest`)를 받아 2단계 Anthropic Claude 호출(키워드 추출 → 정밀 설계)로 멀티스텝 CP2K 시뮬레이션 플랜(`steps` + `expert_tip`)을 생성하고, 항상 `req.atom_info`를 결과에 에코해 SSOT를 동기화한다.

## 구현 위치 (폴더 구조)

이 기능은 도메인별(package-by-feature) 구조에서 `app/features/plan/` 아래에 구현된다: HTTP 라우팅은 `app/features/plan/router.py`, 2단계 LLM 오케스트레이션 비즈니스 로직은 `app/features/plan/service.py`, 플랜 system prompt는 `app/features/plan/prompts.py`, 이 기능 전용 요청 모델(`PlanRequest`)은 `app/features/plan/schemas.py`에 둔다.
기능 경계를 가로지르는(cross-feature) 모델(`AtomInfo`, `PlanStep`, `PlanResult` 등)은 `app/schemas/common.py`에 위치하며, 공유 엔진(`schema_engine`, `self_healing`, `physics_rules`, 옵션 파서/물리 패턴)은 `app/shared/*`, Anthropic 클라이언트는 `app/core/llm.py`에 있다.

**담당 모듈 / 소유 범위**

| 항목 | 내용 |
|---|---|
| Endpoint | `POST /generate-plan` |
| 라우터 | `app/features/plan/router.py :: generate_plan(req: PlanRequest)` |
| 핵심 로직 | `app/features/plan/service.py :: generate_plan_logic(req)` |
| 프롬프트 | `app/features/plan/prompts.py :: KEYWORD_EXTRACTION_PROMPT`, `UNIFIED_PROMPT` |
| 요청 모델 | `app/features/plan/schemas.py :: PlanRequest` |
| 소유하는 데이터 계약 | `PlanRequest`, `PlanResult`, `PlanStep` (data-models.md) |
| 소유하지 않음 (참고만) | `AtomInfo`(소유: f1-structure, `app/schemas/common.py`), `schema_engine`(공유 모듈, `app/shared/schema_engine.py`) |

**기능 경계 (이 기능이 끝나는 곳):** `f2-plan`은 LLM 플랜 JSON을 만들어 반환하는 데까지만 책임진다. 생성된 `steps[]`를 실제 `.inp` 파일로 렌더링하는 것은 `f3-inp`, 작업 제출/실행은 `f4-jobs`의 책임이다. `f2-plan`은 디스크에 아무것도 쓰지 않고 SGE에 아무것도 제출하지 않는다(순수 API + LLM 호출).

---

## HTTP API 명세

### `POST /generate-plan`

`atom_info` + DFT 파라미터를 받아 멀티스텝 시뮬레이션 플랜을 생성한다.

#### 요청 본문 — `PlanRequest`

`Content-Type: application/json`. Pydantic 모델(`app/features/plan/schemas.py`)로 검증되며, 검증 실패 시 `422`를 반환한다.

| 필드 | 타입 | 필수 | 기본값 | 설명 |
|---|---|:---:|---|---|
| `atom_info` | `AtomInfo` (object) | ✅ | — | f1-structure가 생성하는 구조 정보 dict. SSOT. (consumes 섹션 참조) |
| `property` | `str` | ✅ | — | 계산 물성. **표준 12종 중 단 하나만 선택하는 단일 문자열**(리스트/다중 선택 아님). `PROPERTY_SECTION_MAP`의 키. 표준 12종 물성 키: `geo_opt`, `single_point`, `dos`, `band`, `aimd`, `vibrational`, `neb`, `adsorption`, `work_function`, `hirshfeld`, `absorption`, `emission` |
| `basis_set` | `str` | ✅ | — | 기저함수 세트. 예 `DZVP-MOLOPT-GTH` |
| `cutoff` | `float` | ✅ | — | 평면파 cutoff (Ry) |
| `rel_cutoff` | `float` | ✅ | — | relative cutoff |
| `functional` | `str` | ✅ | — | XC functional. 예 `PBE`, `B3LYP` |
| `method` | `str` | ❌ | `"GPW"` | QS Method. 프롬프트의 `QS Method`에 반영 |
| `scf_algo` | `str` | ❌ | `"OT"` | SCF 알고리즘. 프롬프트에 그대로 노출 |
| `charge` | `int` | ❌ | `0` | 전하 |
| `multiplicity` | `int` | ❌ | `1` | 다중도 |
| `use_smear` | `bool` | ❌ | `false` | `false`면 키워드 추출 결과에서 `SMEAR` 토큰을 금지(`forbidden_tokens`에 추가) |
| `smear_temp` | `float` | ❌ | `300.0` | Fermi-Dirac 전자 온도 |
| `custom_options` | `Dict[str, Any]` | ❌ | `{}` | UI 세부 옵션. `OPTION_TOKEN_MAP`으로 토큰 보강 + 프롬프트 요약 생성 |
| `lang` | `str` | ❌ | `"ko"` | `"en"`이면 `UNIFIED_PROMPT`와 user 메시지를 영어로 치환. **이 모델에만 존재하는 필드** |
| `eps_scf` | `str` | ❌ | `"1.0E-6"` | SCF 수렴 기준 |
| `periodic` | `str` | ❌ | `"XYZ"` | 주기성 |
| `max_scf` | `int \| null` | ❌ | `null` | 최대 SCF 반복 |
| `ignore_scf_failure` | `bool` | ❌ | `false` | SCF 실패 무시 여부 |
| `basis_file` | `str \| null` | ❌ | `null` | 기저함수 파일 경로 |
| `pot_file` | `str \| null` | ❌ | `null` | 유사퍼텐셜 파일 경로 |
| `lsd` | `bool` | ❌ | `false` | LSD(UKS). 프롬프트의 `LSD (UKS)`에 반영 |
| `added_mos` | `str \| null` | ❌ | `null` | 추가 가상 궤도 수 |

> **`active_tokens`는 `PlanRequest`의 정규 필드가 아니다(위 표에 포함하지 않음).** Pydantic 모델 정의에는 존재하지 않는 **런타임 동적 속성**이며, 일반 HTTP 클라이언트는 본문에 넣을 필요가 없고 무시해도 무방하다(요청 검증에 영향 없음). 동작은 다음과 같다.
>
> | 동적 속성 | 타입 | 주입 주체 | 소비 | 비고 |
> |---|---|---|---|---|
> | `active_tokens` | `List[str]` | f6-benchmark 등이 `setattr(req, 'active_tokens', [...])`로 주입 | `generate_plan_logic`(app/features/plan/service.py)이 `hasattr(req, 'active_tokens')`로 체크해 있으면 토큰 집합에 추가 | **모델 필드 아님 → 정규 필드로 오인 금지.** `PlanStep`의 `active_tokens`와 별개 — 플랜 생성 시점 토큰 주입은 step이 아니라 req에 해야 한다 |

#### 응답 — `PlanResult` (`200 OK`)

```jsonc
{
  "expert_tip": "string",          // 시스템 특성 기반 전략 요약 (파싱 실패 시 폴백 문구)
  "steps": [ /* PlanStep[] */ ],    // AI 설계 단계 목록. 파싱 실패 시 []
  "atom_info": { /* AtomInfo */ }   // 요청 atom_info를 그대로 에코 (SSOT 동기화)
}
```

##### `PlanStep` 요소 스키마

> 소비자(f3-inp generator / f4-jobs orchestrator)는 모든 키를 `.get()`으로 방어적으로 읽는다. 따라서 `required`는 "정상 경로에서 AI가 채워야 하는" 의미이며, 누락 시 소비자가 기본값으로 폴백한다.

| 필드 | 타입 | 필수 | 기본/폴백 | 설명 |
|---|---|:---:|---|---|
| `step_idx` | `int` | ❌ | 재인덱싱됨 | 1-based 인덱스 |
| `step_name` | `str` | ✅ | — | 단계 이름. orchestrator가 `'Step N: ...'`로 재작성 |
| `importance` | `str` | ❌ | — | `필수` \| `권장` \| `선택` |
| `run_type` | `str` | ✅ | `"ENERGY"` | CP2K RUN_TYPE. 예 `ENERGY`, `GEO_OPT`, `CELL_OPT`, `MD`, `TDDFPT` |
| `physics_reason` | `str` | ❌ | — | 물리적 근거 (AI 설명) |
| `objective` | `str` | ❌ | — | 목표 (AI 설명) |
| `description` | `str` | ❌ | — | 방법론 (AI 설명) |
| `inp_options` | `List[str] \| Dict[str, Any]` | ✅ | — | 경로기반 옵션. 예 `"FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6"`. list면 f3-inp의 `parse_path_based_options`가 dict로 변환 |
| `selected` | `bool` | ❌ | `true` | `false`면 f3/f4에서 제외 |
| `exclude` | `bool` | ❌ | `false` | `true`면 f3/f4에서 제외 |
| `active_tokens` | `List[str]` | ❌ | `[]` | **f3-inp/f4-jobs 제출 단계 전용 키** (build_full_inp/치유 메타 전달). f2-plan은 이 키를 생성하지 않는다 |

#### 요청 예시 JSON

```json
{
  "atom_info": {
    "filename": "TiO2_anatase.cif",
    "atom_count": 12,
    "atoms": [
      {"element": "Ti", "x": 0.0, "y": 0.0, "z": 0.0},
      {"element": "O",  "x": 1.9, "y": 0.0, "z": 0.0}
    ],
    "elements": ["Ti", "O"],
    "element_counts": {"Ti": 4, "O": 8},
    "cell": [3.78, 3.78, 9.51],
    "cell_angles": [90.0, 90.0, 90.0],
    "full_coord_text": "Ti 0.0 0.0 0.0\nO 1.9 0.0 0.0",
    "full_cell_text": "ABC 3.78 3.78 9.51\nALPHA_BETA_GAMMA 90 90 90",
    "use_scaled": false,
    "smear_recommended": true,
    "smear_reason_en": "Metallic-like d-states near Fermi level"
  },
  "property": "geo_opt",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE",
  "scf_algo": "OT",
  "use_smear": false,
  "lang": "ko"
}
```

#### 응답 예시 JSON

```json
{
  "expert_tip": "TiO2 anatase는 d-전자가 페르미 준위 근처에 있어 SCF 수렴이 까다롭습니다. OT 대신 DIAGONALIZATION + Broyden MIXING을 권장합니다.",
  "steps": [
    {
      "step_idx": 1,
      "step_name": "단일점 파동함수 초기화",
      "importance": "필수",
      "run_type": "ENERGY",
      "physics_reason": "구조 최적화 전 안정적인 초기 밀도를 확보해 발산을 방지합니다.",
      "objective": "초기 SCF 수렴",
      "description": "DIAGONALIZATION + Broyden MIXING으로 기저 상태 밀도를 수렴시킵니다.",
      "inp_options": [
        "FORCE_EVAL/DFT/SCF/SCF_GUESS ATOMIC",
        "FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6",
        "FORCE_EVAL/DFT/SCF/MAX_SCF 50",
        "FORCE_EVAL/DFT/SCF/MIXING/METHOD BROYDEN_MIXING",
        "FORCE_EVAL/DFT/SCF/MIXING/ALPHA 0.3"
      ]
    },
    {
      "step_idx": 2,
      "step_name": "기하 구조 최적화",
      "importance": "필수",
      "run_type": "GEO_OPT",
      "physics_reason": "원자에 작용하는 힘을 최소화해 평형 구조를 찾습니다.",
      "objective": "에너지 최소 구조 탐색",
      "description": "LBFGS optimizer로 50개 이상 원자 주기계의 진동을 억제합니다.",
      "inp_options": [
        "MOTION/GEO_OPT/OPTIMIZER LBFGS",
        "MOTION/GEO_OPT/MAX_ITER 200",
        "MOTION/GEO_OPT/MAX_FORCE 4.5E-4",
        "MOTION/GEO_OPT/RMS_FORCE 3.0E-4"
      ]
    }
  ],
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 12, "...": "요청과 동일하게 에코" }
}
```

#### 상태 코드 / 에러

| 코드 | 상황 | 본문 |
|---|---|---|
| `200` | 정상. **AI JSON 파싱 실패 시에도 200** — `steps=[]` + 폴백 `expert_tip`으로 graceful degradation |
| `422` | 요청 본문 검증 실패(필수 필드 누락 등). FastAPI `RequestValidationError` 핸들러가 `{"detail": [...]}` 반환 |
| `500` | LLM 호출/로직 예외. `{"detail": "AI 플랜 생성 중 에러 발생: <message>"}` |

> **graceful degradation 계약(중요):** `generate_plan_logic`은 두 번째 Claude 호출 응답에서 `{...}` JSON 블록을 정규식으로 추출하고 `clean_json_string`으로 보정한다. 그래도 파싱이 실패하면 예외를 던지지 않고 `{"expert_tip": "<폴백 문구>", "steps": []}`를 반환한 뒤 `atom_info`를 에코한다. **소비자는 `steps`가 빈 배열일 수 있음을 항상 가정해야 한다.**

##### `steps=[]` 폴백 응답 예시

```json
{
  "expert_tip": "AI 응답 형식이 올바르지 않아 기본 설정을 로드합니다.",
  "steps": [],
  "atom_info": { "filename": "TiO2_anatase.cif", "...": "에코" }
}
```
(`lang: "en"`이면 `"AI response format was invalid, loading default settings."`)

---

## 생산하는 데이터 계약

이 기능이 내보내 다른 기능이 소비하는 구조. (정의: **data-models.md**)

| 계약 | 무엇 | 누가 소비 | data-models.md 링크 |
|---|---|---|---|
| **`PlanRequest`** | `/generate-plan` 요청 본문 모델 | f2-plan(자체), f6-benchmark가 `setattr`로 `active_tokens` 주입 | [data-models.md#planrequest](../../data-models.md#planrequest) |
| **`PlanStep`** | 플랜의 단일 스텝. 기능 경계를 가로지르는 핵심 계약 | **f3-inp**(`/generate-inp` steps[]), **f4-jobs**(`/submit-job` steps[]), **f6-benchmark** | [data-models.md#planstep](../../data-models.md#planstep) |
| **`PlanResult`** | `/generate-plan` 응답(`expert_tip` + `steps` + 에코된 `atom_info`) | **f6-benchmark** | [data-models.md#planresult](../../data-models.md#planresult) |

**다운스트림 계약 의무 (깨면 f3/f4가 깨진다):**
1. `steps[]`의 각 요소는 최소 `step_name`, `run_type`, `inp_options`를 포함한다. `inp_options`는 **FULL PATH ONLY**(`&` 없이 `/` 구분)인 문자열 리스트 또는 dict여야 한다. `COORD`/`CELL`/`KIND`는 절대 포함하지 않는다(구조는 f1의 `atom_info`가 SSOT).
2. 응답의 `atom_info`는 **요청 `atom_info`를 변형 없이 그대로 에코**한다. f6-benchmark/프런트엔드는 이 에코로 SSOT를 동기화하므로 키를 추가·삭제하면 안 된다.
3. `active_tokens`는 `PlanStep` 키로 **생산하지 않는다**(f3/f4가 제출 단계에서 자체적으로 쓰는 키다).

---

## 소비하는 데이터 계약

이 기능이 필요로 하는 상위 기능의 출력. **상위 기능이 미완성이어도 아래 목업으로 단독 개발을 시작할 수 있다.**

### `AtomInfo` ← `f1-structure`

`PlanRequest.atom_info`로 전달되는 정규화 구조 dict. 파이프라인 전체의 SSOT. `generate_plan_logic`이 읽는 키는 모두 `.get()` 방어 접근이므로, 아래 키 중 일부만 채워도 동작한다.

`generate_plan_logic`이 실제로 읽는 키와 폴백:

| 읽는 키 | 사용처 | 누락 시 폴백 |
|---|---|---|
| `filename` | 프롬프트 `struct_summary` | `None` 표기 |
| `atom_count` | `struct_summary` | `None` 표기 |
| `elements` | `struct_summary`, 프롬프트 `{elements}` 치환 | `[]` |
| `cell` | `struct_summary` Cell Size | `None` 표기 |
| `cell_angles` | `cell_angles_str` | `"90.00, 90.00, 90.00"` |
| `periodic` | `struct_summary` | `"XYZ"` |
| `smear_recommended` | Smearing Recommendation | `NO` |
| `smear_reason_en` | Smearing 사유 | `"N/A"` |

> **방어 규칙:** `AtomInfo`는 정상 / parse-failure 폴백 / empty-CIF 폴백 3가지 형태로 키 집합이 다르다. `cell_angles`, `smear_recommended` 등 선택 키는 empty-CIF 폴백에 부재할 수 있으므로 반드시 `.get()`으로 읽을 것(이미 `generate_plan_logic`이 그렇게 한다).

#### 목업 — 정상 경로 `AtomInfo`

```json
{
  "filename": "benzene.cif",
  "atom_count": 12,
  "atoms": [
    {"element": "C", "x": 0.000, "y": 1.396, "z": 0.0},
    {"element": "H", "x": 0.000, "y": 2.480, "z": 0.0}
  ],
  "elements": ["C", "H"],
  "element_counts": {"C": 6, "H": 6},
  "element_indices": {"C": [1,2,3,4,5,6], "H": [7,8,9,10,11,12]},
  "cell": [15.0, 15.0, 15.0],
  "cell_angles": [90.0, 90.0, 90.0],
  "volume": 3375.0,
  "full_coord_text": "C 0.000 1.396 0.0\nH 0.000 2.480 0.0",
  "full_cell_text": "ABC 15.0 15.0 15.0\nALPHA_BETA_GAMMA 90 90 90",
  "use_scaled": false,
  "smear_recommended": false,
  "smear_reason_ko": "밴드갭이 충분히 커 SMEAR 불필요",
  "smear_reason_en": "Band gap is wide enough; SMEAR not required",
  "periodic": "XYZ"
}
```

#### 목업 — parse-failure 폴백 `AtomInfo`

```json
{
  "filename": "broken.cif",
  "atom_count": 0,
  "atoms": [],
  "elements": [],
  "element_counts": {},
  "element_indices": {},
  "cell": [10.0, 10.0, 10.0],
  "volume": 1000.0,
  "full_coord_text": "",
  "full_cell_text": "",
  "use_scaled": false,
  "error": "could not parse CIF: unexpected token"
}
```

#### 목업 — empty-CIF 폴백 `AtomInfo` (가장 축약된 형태)

```json
{
  "filename": "empty.cif",
  "atom_count": 0,
  "atoms": [],
  "elements": [],
  "element_counts": {},
  "cell": [10.0, 10.0, 10.0],
  "full_coord_text": "",
  "full_cell_text": "",
  "use_scaled": false,
  "error": "Empty CIF (No atoms)"
}
```

> 이 폴백에는 `cell_angles`, `volume`, `element_indices`, `smear_*`가 **부재**한다. f2-plan은 모두 `.get()` 폴백으로 처리하므로 빈 플랜이라도 안전하게 생성된다.

---

## 내부·공유 의존성

| 모듈 | 위치 | 호출 방식 | f2-plan에서의 용도 |
|---|---|---|---|
| `schema_engine` (`CP2KSchemaEngine`) | `app/shared/schema_engine.py` | 모듈 로드 시 `schema_engine = CP2KSchemaEngine()` 싱글톤 생성. `generate_plan_logic`에서 `schema_engine.get_manual_snippet(token)` 호출 | 토큰 집합 → 공식 CP2K XML 스키마 스니펫 추출. `UNIFIED_PROMPT`의 `{xml_context}`를 채워 LLM grounding | 
| `prompts` | `app/features/plan/prompts.py` | `from app.features.plan.prompts import KEYWORD_EXTRACTION_PROMPT, UNIFIED_PROMPT` | 1단계 키워드 추출 system prompt + 2단계 정밀 설계 system prompt |
| `PlanRequest` | `app/features/plan/schemas.py` | FastAPI 라우터가 본문을 `PlanRequest`로 검증 | 요청 스키마 |
| `generate_plan_logic` | `app/features/plan/service.py` | `await generate_plan_logic(req)` | 본 기능의 전체 비즈니스 로직(2단계 LLM 오케스트레이션) |

**`get_manual_snippet` 시그니처(참고):** `get_manual_snippet(self, token: str, run_type: str = "ENERGY") -> str` — 토큰에 해당하는 스니펫이 없으면 빈 문자열을 반환한다. f2-plan은 빈 문자열을 `if snippet:`으로 걸러 `xml_context`에서 제외한다.

**기본 필수 토큰(코드 고정):** `["GLOBAL", "DFT", "SCF", "MGRID", "XC"]` 는 항상 토큰 집합에 포함된다. 여기에 `PROPERTY_SECTION_MAP[property]`, `OPTION_TOKEN_MAP[custom_option_key]`, 1단계 LLM이 추출한 `TOKENS:`, 그리고 `req.active_tokens`가 합쳐진다(`use_smear=False`면 `SMEAR`는 `forbidden_tokens`로 제거).

---

## 외부 의존성

| 의존성 | 이름 / 키 | 기본값 | 비고 |
|---|---|---|---|
| Anthropic Claude API | `client = AsyncAnthropic(api_key=os.getenv('CLAUDE_API_KEY'))` | — (필수) | `.env`의 `CLAUDE_API_KEY` 환경변수에서 로드. **레포에 커밋된 키 값은 사용/노출 금지 — 각자 환경에 주입할 것.** `app/main.py`가 `load_dotenv()`를 모든 import 전에 호출 |
| 모델 ID | `os.getenv("ANTHROPIC_MODEL", ...)` | `claude-sonnet-4-6` (코드 기본) | 기능 정의서상 기본은 `claude-sonnet-4-6`. 환경변수로 override 가능 |
| 1단계 호출 | `client.messages.create(model, max_tokens=500, system=KEYWORD_EXTRACTION_PROMPT, messages=[...])` | — | 키워드/RUN_TYPE 추출 |
| 2단계 호출 | `client.messages.create(model, max_tokens=8000, system=[{type:text, text:..., cache_control:{type:"ephemeral"}}], messages=[...])` | — | 정밀 설계. **prompt caching(ephemeral)** 사용 |
| 패키지 | `anthropic` (`AsyncAnthropic`), `fastapi`, `pydantic`, `python-dotenv` | — | — |

> **SGE/qsub:** f2-plan은 **사용하지 않는다.** 작업 스케줄러 제출은 f4-jobs의 책임이다. 이 기능은 파일 경로/디스크 쓰기도 없다(순수 LLM 호출). 외부 의존성은 사실상 Anthropic API 하나.

**필요 환경변수 요약:**
```dotenv
CLAUDE_API_KEY=<your-anthropic-key>     # 필수
ANTHROPIC_MODEL=claude-sonnet-4-6        # 선택 (미설정 시 코드 기본값)
```

---

## 병렬 개발 가이드

### 무엇을 목업하면 단독 개발 가능한가

이 기능은 **상위(f1-structure)와 하위(f3/f4/f6) 모두로부터 독립적으로** 풀스택 개발 가능하다.

1. **상위 입력 목업 (f1 미완성이어도 OK):** 위 "소비하는 데이터 계약"의 `AtomInfo` 목업 3종(정상/parse-failure/empty-CIF)을 그대로 요청 본문의 `atom_info`에 넣으면 된다. f1-structure의 `/analyze-cif`를 호출할 필요 없이 정적 JSON으로 시작할 수 있다.
2. **Anthropic API 목업 (키 없이 프런트/백 흐름 검증):** `generate_plan_logic` 내부의 `client.messages.create` 두 호출을 스텁으로 대체하거나, 라우터 레벨에서 `/generate-plan`이 위 "응답 예시 JSON"을 즉시 반환하도록 목업하면 LLM 비용/지연 없이 f3/f4와의 계약 통합을 테스트할 수 있다. 폴백 경로(`steps: []`) 응답도 함께 목업해 소비자의 방어 처리를 검증할 것.
3. **하위 소비자 목업 (f3/f4 미완성이어도 OK):** f2-plan은 JSON만 반환하므로, 생성된 `PlanResult`를 콘솔/파일로 덤프해 `steps[].inp_options`가 FULL PATH 규칙을 지키는지 단독 검증 가능하다. f3의 `parse_path_based_options`를 호출할 필요는 없지만, 통합 스모크 테스트로 한 번 변환해보면 안전하다.
4. **schema_engine 목업:** 실제 `cp2k_input.xml`(약 35MB) 로딩이 부담되면 `get_manual_snippet`이 빈 문자열을 반환하는 스텁으로 대체 가능. 이 경우 `xml_context`가 비어 grounding 품질만 떨어지고 API 계약/형상은 동일하게 동작한다.

### 완료 정의 (Definition of Done)

- [ ] `POST /generate-plan`이 `PlanRequest`(필수 6필드 + 선택 필드)를 422 없이 수락한다.
- [ ] 정상 입력에 대해 `expert_tip`(str), `steps`(`PlanStep[]`), `atom_info`(요청 에코) 3키를 가진 `200` 응답을 반환한다.
- [ ] 응답 `atom_info`가 요청 `atom_info`와 **바이트 동일하게 에코**된다(SSOT).
- [ ] 각 `PlanStep`이 `step_name` / `run_type` / `inp_options`를 포함하고, `inp_options`가 FULL PATH(`&` 없이 `/`) 규칙을 지키며 `COORD`/`CELL`/`KIND`를 포함하지 않는다.
- [ ] `lang: "en"` 요청 시 `expert_tip`/`step_name`/`physics_reason`/`objective`/`description`이 영어로 생성된다.
- [ ] `use_smear: false`일 때 `SMEAR` 토큰이 추출 결과에서 제거된다(스니펫에 SMEAR 미포함).
- [ ] AI JSON 파싱 실패 시 **500이 아니라 200 + `steps: []` + 폴백 `expert_tip`**으로 graceful degradation 한다.
- [ ] `property`별 `PROPERTY_SECTION_MAP` 토큰과 `custom_options`별 `OPTION_TOKEN_MAP` 토큰이 컨텍스트에 반영된다(예: `property=absorption`이면 `TDDFPT` 스니펫 포함).
- [ ] `req.active_tokens`가 주입된 경우(`hasattr` true) 토큰 집합에 합쳐진다(f6-benchmark 통합). **단, `active_tokens`는 `PlanRequest` 정규 필드가 아니라 동적 속성이므로 모델 스키마/필드 표에 추가하지 않는다.**
- [ ] empty-CIF 폴백 `AtomInfo`(선택 키 부재)로도 예외 없이 플랜이 생성된다.
- [ ] `CLAUDE_API_KEY`는 `.env`/환경변수에서만 로드하고, 코드/문서/로그에 키 값을 하드코딩하지 않는다.
- [ ] 잘못된 본문(필수 필드 누락)에 대해 `422`, LLM/로직 예외에 대해 `500 {"detail": "AI 플랜 생성 중 에러 발생: ..."}`를 반환한다.
