# CP2K 입력파일(INP) 생성 / CP2K Input (INP) Generation

## 구현 위치 (폴더 구조)

본 기능은 `app/features/inp/` 아래에 구현된다. HTTP 라우트 핸들러는 `router.py`, 진입 로직(스텝 필터·분기·파일명 결정 등)은 `service.py`, 기능 전용 요청 모델(`InpRequest`)은 `schemas.py`에 둔다. 여러 기능을 가로지르는 cross-feature 모델(`AtomInfo`, `PlanStep`, `GeneratedFile` 등)은 `app/schemas/common.py`에 있고, 공유 엔진(`schema_engine`, `self_healing`, `physics_rules`, 옵션 병합 등)은 `app/shared/*`에 위치한다. 앱 부트스트랩(라우터 등록/미들웨어/정적 서빙)은 `app/main.py`다.

> 한 줄 책임: 플랜의 `steps`(selected/exclude 필터링)와 `atom_info`를 받아 스텝별로 `build_full_inp`를 호출하고, schema_engine 거버넌스 + self_healing 검증을 거친 CP2K `.inp` 텍스트를 생성해 반환한다.

- **feature id**: `f3-inp`
- **담당 모듈 / 소유 범위**:
  - `app/features/inp/service.py` (`generate_inp_logic`) — 본 기능의 진입 로직(스텝 필터링, 단일/다중 분기, 파일명 결정). **f3-inp 단독 소유.**
  - `app/features/inp/schemas.py` (`InpRequest`) — `/generate-inp` 요청 Pydantic 모델. **f3-inp 소유.**
  - `app/features/inp/router.py`의 `POST /generate-inp` 라우트 핸들러. **f3-inp 소유.**
- **소유하지 않는(공유) 모듈**: `app/features/inp/service.py`의 `build_full_inp`, `app/shared/options.py`(`merge_custom_options`, `parse_path_based_options`), `app/shared/schema_engine.py`, `app/shared/self_healing.py`, `app/shared/physics_rules.py` — 여러 기능이 공유하므로 시그니처를 임의 변경하지 말 것(아래 [내부·공유 의존성] 참조).
- **clean 기준**: 본 문서의 계약은 현재 코드(`app/features/inp/service.py`)를 SSOT로 하되, 깔끔한 목표 설계 관점에서 기술한다. 즉 "다른 기능이 이 기능에 기대해도 되는" 안정된 외부 표면을 정의한다.

---

## HTTP API 명세

### `POST /generate-inp`

- **method**: `POST`
- **path**: `/generate-inp`
- **handler**: `app/features/inp/router.py`의 `generate_inp` → `await generate_inp_logic(req)` (`app/features/inp/service.py`)
- **요청 Content-Type**: `application/json`
- **응답 Content-Type**: `application/json`
- **책임**: 선택된 스텝 각각에 대해 `.inp` 텍스트를 생성한다. 디스크에 쓰지 않고 **메모리상 텍스트로만** 반환한다(파일 저장/제출은 f4-jobs 책임).

#### 요청 본문 (`InpRequest` 계약)

`data-models.md` → **`InpRequest`** 계약을 그대로 사용한다. (`app/features/inp/schemas.py` 일치)

| 필드명 | 타입 | 필수 | 기본값 | 설명 |
|---|---|---|---|---|
| `atom_info` | `AtomInfo` | ✅ | — | 단일 구조 정보. `data-models.md`의 **`AtomInfo`** 계약. 단일 분기에서 사용 |
| `steps` | `List[PlanStep]` | ✅ | — | 플랜 단계 목록. `data-models.md`의 **`PlanStep`** 계약 |
| `property` | `str` | ✅ | — | 계산 물성 예 `energy`, `geo_opt`, `absorption` |
| `basis_set` | `str` | ✅ | — | 기저함수 세트 예 `DZVP-MOLOPT-GTH` |
| `cutoff` | `float` | ✅ | — | 평면파 cutoff (Ry) |
| `rel_cutoff` | `float` | ✅ | — | relative cutoff |
| `functional` | `str` | ✅ | — | XC functional 예 `PBE` |
| `method` | `str` | ❌ | `"GPW"` | QS method |
| `scf_algo` | `str` | ❌ | `"OT"` | SCF 알고리즘 |
| `charge` | `int` | ❌ | `0` | 전하 |
| `multiplicity` | `int` | ❌ | `1` | 다중도 |
| `use_smear` | `bool` | ❌ | `false` | SMEAR 사용 여부. **다중 분기에서는 구조별 `struct["use_smear"]`가 우선**(키 존재 시) |
| `smear_temp` | `float` | ❌ | `300.0` | 전자온도. 다중 분기에서는 구조별 `struct["smear_temp"]` 우선 |
| `custom_options` | `Dict[str,Any]` | ❌ | `{}` | 경로기반 옵션 오버라이드. `merge_custom_options`로 step별 병합 |
| `eps_scf` | `str` | ❌ | `"1.0E-6"` | SCF 수렴 임계값 |
| `periodic` | `str` | ❌ | `"XYZ"` | 주기성 |
| `max_scf` | `int \| null` | ❌ | `null` | 최대 SCF 스텝 |
| `ignore_scf_failure` | `bool` | ❌ | `false` | SCF 실패 무시 |
| `basis_file` | `str \| null` | ❌ | `null` | basis 파일 경로 |
| `pot_file` | `str \| null` | ❌ | `null` | potential 파일 경로 |
| `lsd` | `bool` | ❌ | `false` | LSD(UKS) |
| `added_mos` | `str \| null` | ❌ | `null` | 추가 분자궤도 수 |
| `multi_atom_info` | `List[AtomInfo] \| null` | ❌ | `null` | **`len > 1`이면 구조별 개별 `.inp` 생성 분기**. 그 외(`null`/`len<=1`)에는 단일 분기 |

> **주의 — `lang` 필드 없음**: `InpRequest`는 `PlanRequest`와 달리 `lang` 필드를 갖지 않는다. `.inp` 텍스트는 언어 중립적이므로 추가하지 말 것.

#### 생성 규칙 (계약 핵심)

1. **스텝 필터링**: `selected != False` 이고 `exclude != True`인 스텝만 사용한다. 두 키 모두 `PlanStep`에서 `.get`으로 방어적으로 읽으며 기본값은 `selected=True`, `exclude=False`. (`app/features/inp/service.py`)
2. **인덱싱**: 필터링된 스텝을 1-based로 재인덱싱(`enumerate(..., 1)`)하여 파일명 `i`를 결정한다. 원본 `step_idx`가 아니라 **필터 후 순번**을 쓴다.
3. **분기 및 파일명**:
   - `multi_atom_info`가 있고 `len > 1` → 구조별 × 스텝별로 `f"{base}_step{i}.inp"` 생성. `base`는 `struct["filename"]`에서 `.cif` 제거 + 공백을 `_`로 치환.
   - 그 외 → `req.atom_info` 단일 구조로 `f"step{i}.inp"` 생성.
4. **옵션 처리(스텝당)**: `step["inp_options"]`가 `list`면 `parse_path_based_options`로 dict 변환 → `custom_options`가 truthy면 `merge_custom_options(raw, custom, step_idx=i)`로 병합 → `build_full_inp(...)`에 `tree`로 전달.

#### 응답 JSON 스키마 (`GenerateInpResult` 계약)

`data-models.md` → **`GenerateInpResult`** 계약. 항상 HTTP 200 + 아래 형태(부분 실패 없음; 예외 시 500).

```jsonc
{
  "status": "string",            // 'success' 고정
  "generated_files": [           // GeneratedFile[] (data-models.md: GeneratedFile)
    {
      "filename": "string",      // 'step{i}.inp' | '{base}_step{i}.inp'
      "content": "string"        // build_full_inp가 렌더링한 CP2K .inp 텍스트
    }
  ]
}
```

> `generated_files[]`는 `data-models.md`의 **`GeneratedFile`** 계약이다. f3가 생산하는 `GeneratedFile`은 `validation_logs` 키를 **포함하지 않는다**(이 선택 키는 f4-jobs 제출 측 `FileItem` 모델에만 존재). 소비자는 `validation_logs`를 `.get`으로 읽을 것.

#### 상태코드 / 에러

| 상태코드 | 조건 | 본문 |
|---|---|---|
| `200 OK` | 정상. 선택 스텝 0개여도 `generated_files: []`로 200 | `GenerateInpResult` |
| `422 Unprocessable Entity` | Pydantic 검증 실패(필수 필드 누락/타입 불일치) | FastAPI 기본 검증 에러 |
| `500 Internal Server Error` | 생성 중 예외(스키마/치유/렌더링 실패 등) | `{"detail": "INP 생성 중 에러 발생: {원인}"}` (`app/features/inp/router.py`) |

> **부분 실패 없음**: 한 스텝/구조에서 예외가 나면 전체 요청이 500으로 실패한다. 개별 파일 단위 에러 보고는 현재 계약에 없다.

#### 요청 예시 — 단일 구조

```json
{
  "atom_info": {
    "filename": "Si.cif",
    "atom_count": 2,
    "atoms": [{"element": "Si", "x": 0.0, "y": 0.0, "z": 0.0}],
    "elements": ["Si"],
    "element_counts": {"Si": 2},
    "cell": [5.43, 5.43, 5.43],
    "cell_angles": [90.0, 90.0, 90.0],
    "full_coord_text": "Si 0.0 0.0 0.0\nSi 1.3575 1.3575 1.3575",
    "full_cell_text": "ABC 5.43 5.43 5.43\nALPHA_BETA_GAMMA 90.0 90.0 90.0",
    "use_scaled": false
  },
  "steps": [
    {
      "step_name": "Geometry Optimization",
      "run_type": "GEO_OPT",
      "inp_options": ["FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6", "MOTION/GEO_OPT/MAX_ITER 200"],
      "selected": true,
      "exclude": false
    }
  ],
  "property": "geo_opt",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE",
  "scf_algo": "OT"
}
```

#### 응답 예시 — 단일 구조

```json
{
  "status": "success",
  "generated_files": [
    {
      "filename": "step1.inp",
      "content": "&GLOBAL\n  PROJECT step1\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n&FORCE_EVAL\n  METHOD QS\n  &DFT\n    &SCF\n      EPS_SCF 1.0E-6\n    &END SCF\n  &END DFT\n&END FORCE_EVAL\n&MOTION\n  &GEO_OPT\n    MAX_ITER 200\n  &END GEO_OPT\n&END MOTION"
    }
  ]
}
```

#### 요청 예시 — 다중 구조 (`multi_atom_info`, `len > 1`)

```json
{
  "atom_info": {"filename": "A.cif", "atom_count": 2, "atoms": [], "elements": ["Si"], "element_counts": {"Si": 2}, "cell": [5.43, 5.43, 5.43], "full_coord_text": "", "full_cell_text": "", "use_scaled": false},
  "multi_atom_info": [
    {"filename": "A.cif", "atom_count": 2, "atoms": [], "elements": ["Si"], "element_counts": {"Si": 2}, "cell": [5.43, 5.43, 5.43], "full_coord_text": "", "full_cell_text": "", "use_scaled": false, "use_smear": false},
    {"filename": "B structure.cif", "atom_count": 4, "atoms": [], "elements": ["Ge"], "element_counts": {"Ge": 4}, "cell": [5.65, 5.65, 5.65], "full_coord_text": "", "full_cell_text": "", "use_scaled": false, "use_smear": true, "smear_temp": 500.0}
  ],
  "steps": [
    {"step_name": "Energy", "run_type": "ENERGY", "inp_options": [], "selected": true},
    {"step_name": "Excluded", "run_type": "ENERGY", "inp_options": [], "exclude": true}
  ],
  "property": "energy",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE"
}
```

#### 응답 예시 — 다중 구조

`exclude:true` 스텝은 제외되고 1개 스텝만 남으므로, 구조 2개 × 스텝 1개 = 파일 2개. 파일명은 구조 파일명 base 기준이고 `step{i}`의 `i`는 필터 후 순번(`1`)이다. 두 번째 구조는 공백이 `_`로 치환되어 base가 `B_structure`. smear/smear_temp는 구조 키 존재 시 구조값이 우선 반영되어, 첫 구조는 smear off, 두 번째 구조는 `FERMI_DIRAC 500.0K`가 적용된다.

```json
{
  "status": "success",
  "generated_files": [
    {"filename": "A_step1.inp", "content": "...(smear off)..."},
    {"filename": "B_structure_step1.inp", "content": "...(smear FERMI_DIRAC 500.0K)..."}
  ]
}
```

---

## 생산하는 데이터 계약

본 기능이 내보내 다른 기능이 소비하는 구조. 정의 본문은 `data-models.md`를 SSOT로 한다.

| 계약 (data-models.md 링크) | 형태 | 소비 기능 | 비고 |
|---|---|---|---|
| **`InpRequest`** | `/generate-inp` 요청 Pydantic 모델 | `f3-inp`(자기 소비) | f3 소유 모델. f2-plan의 `PlanRequest`와 필드 대부분 공유하나 `lang` 없음, `steps`/`multi_atom_info` 추가 |
| **`GeneratedFile`** | `{filename, content}` 단일 `.inp` 파일 | `f4-jobs`, `f6-benchmark` | **기능 경계(inp생성→제출)를 가로지르는 핵심 계약.** f4의 `/submit-job` 요청 `files[]`(`FileItem`)와 호환. f3는 `validation_logs` 키를 생산하지 않음 |
| **`GenerateInpResult`** | `{status, generated_files[]}` `/generate-inp` 응답 | `f4-jobs` | 응답 래퍼. `generated_files`는 `GeneratedFile[]` |

> 다운스트림 계약: f4-jobs는 `GeneratedFile`을 `SubmitRequest.files[]`로 다시 받아 제출한다. 따라서 `filename`/`content` 두 키의 의미를 변경하면 f4가 깨진다. **이 두 키는 변경 금지(append-only 진화).**

---

## 소비하는 데이터 계약

본 기능이 필요로 하는 상위 기능의 출력. 상위 기능이 미완성이어도 **아래 목업 JSON으로 단독 개발을 시작**할 수 있다.

### 1) `AtomInfo` — from **f1-structure** (`data-models.md`: `AtomInfo`)

- 사용처: `req.atom_info`(단일 분기), `req.multi_atom_info[*]`(다중 분기), `build_full_inp(atom_info=...)`로 전달.
- **방어적 읽기 필수**: f3가 직접 읽는 선택 키는 다중 분기의 `filename`, `use_smear`, `smear_temp`이며 모두 `.get`/`in` 체크로 처리한다. `build_full_inp` 내부는 `cell_angles`(비직교 셀 판정), `full_coord_text`, `full_cell_text` 등을 사용한다.
- AtomInfo는 정상/parse-failure 폴백/empty-CIF 폴백 **세 형태의 키 집합이 다르므로** 선택 키는 반드시 `.get`으로 읽을 것.

목업 (정상 경로, 단일):

```json
{
  "filename": "mock.cif",
  "atom_count": 8,
  "atoms": [{"element": "Si", "x": 0.0, "y": 0.0, "z": 0.0}],
  "elements": ["Si"],
  "element_counts": {"Si": 8},
  "element_indices": {"Si": [1, 2, 3, 4, 5, 6, 7, 8]},
  "cell": [5.43, 5.43, 5.43],
  "cell_angles": [90.0, 90.0, 90.0],
  "volume": 160.1,
  "full_coord_text": "Si 0.0 0.0 0.0\nSi 1.3575 1.3575 1.3575",
  "full_cell_text": "ABC 5.43 5.43 5.43\nALPHA_BETA_GAMMA 90.0 90.0 90.0",
  "use_scaled": false,
  "smear_recommended": false,
  "periodic": "XYZ"
}
```

목업 (다중 분기용 — 구조별 우선 키 포함):

```json
[
  {"filename": "A.cif", "atom_count": 2, "atoms": [], "elements": ["Si"], "element_counts": {"Si": 2}, "cell": [5.43, 5.43, 5.43], "cell_angles": [90.0, 90.0, 90.0], "full_coord_text": "Si 0 0 0", "full_cell_text": "ABC 5.43 5.43 5.43", "use_scaled": false, "use_smear": false},
  {"filename": "B structure.cif", "atom_count": 4, "atoms": [], "elements": ["Ge"], "element_counts": {"Ge": 4}, "cell": [5.65, 5.65, 5.65], "cell_angles": [85.0, 90.0, 90.0], "full_coord_text": "Ge 0 0 0", "full_cell_text": "ABC 5.65 5.65 5.65", "use_scaled": false, "use_smear": true, "smear_temp": 500.0}
]
```

목업 (parse-failure 폴백 — 방어 코드 테스트용): `cell_angles`/`volume`/`smear_recommended` 부재.

```json
{
  "filename": "broken.cif",
  "atom_count": 0,
  "atoms": [],
  "elements": [],
  "element_counts": {},
  "element_indices": {},
  "cell": [10.0, 10.0, 10.0],
  "full_coord_text": "",
  "full_cell_text": "ABC 10.0 10.0 10.0",
  "use_scaled": false,
  "error": "could not parse CIF"
}
```

### 2) `PlanStep` — from **f2-plan** (`data-models.md`: `PlanStep`)

- 사용처: `req.steps[*]`. f3는 각 스텝에서 `selected`/`exclude`(필터), `inp_options`(옵션 트리), `run_type`(RUN_TYPE)을 읽는다. 모두 `.get`으로 읽으며 기본값은 `selected=True`, `exclude=False`, `run_type="ENERGY"`, `inp_options={}`.
- **`active_tokens` 경로 주의**: inp/제출 단계에서 `PlanStep`의 `active_tokens`는 step 키로 읽혀 치유 메타에 전달될 수 있다(제출/inp 전용 키). 플랜 생성 시점의 토큰 주입은 `PlanRequest` 쪽이며 f3와 무관.
- `inp_options`는 `List[str]`(경로기반, `"SECTION/SUB/KEY VALUE"`) 또는 이미 변환된 `Dict[str,Any]` 둘 다 허용. list면 `parse_path_based_options`로 dict 변환된다.

목업 (선택/제외/경로옵션 케이스 모두 포함):

```json
[
  {
    "step_idx": 1,
    "step_name": "Geometry Optimization",
    "importance": "필수",
    "run_type": "GEO_OPT",
    "physics_reason": "원자 위치 최적화로 기저 에너지 도달",
    "inp_options": [
      "FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6",
      "FORCE_EVAL/DFT/SCF/MAX_SCF 50",
      "MOTION/GEO_OPT/MAX_ITER 200",
      "MOTION/GEO_OPT/OPTIMIZER BFGS"
    ],
    "selected": true,
    "exclude": false
  },
  {
    "step_idx": 2,
    "step_name": "Single Point (Dict form)",
    "run_type": "ENERGY",
    "inp_options": {"FORCE_EVAL": {"DFT": {"SCF": {"EPS_SCF": "1.0E-7"}}}},
    "selected": true
  },
  {
    "step_idx": 3,
    "step_name": "Skipped step",
    "run_type": "ENERGY",
    "inp_options": [],
    "exclude": true
  }
]
```

> 위 목업으로 `/generate-inp`를 호출하면 step3은 `exclude:true`로 제외되어 `step1.inp`, `step2.inp` 두 개만 생성되어야 한다(필터 후 재인덱싱 검증 포인트).

---

## 내부·공유 의존성

f3-inp는 다음 공유 모듈을 **읽기 전용 의존**한다. 시그니처를 바꾸면 f2/f4/f6도 영향을 받으므로 변경 시 합의 필요.

| 모듈 / 심볼 | 호출 방식 | 역할 | f3에서의 사용 위치 |
|---|---|---|---|
| `app/features/inp/service.py`의 `generate_inp_logic(req)` | `await generate_inp_logic(req)` | **f3 진입 로직(소유)**. 스텝 필터·단일/다중 분기·파일명 결정 | `app/features/inp/router.py` |
| `app/shared/options.py`의 `parse_path_based_options(list)` | `parse_path_based_options(step["inp_options"])` | 경로기반 옵션(`"A/B/KEY VALUE"`) → 중첩 dict 변환 | `app/features/inp/service.py` |
| `app/shared/options.py`의 `merge_custom_options(base, custom, step_idx=i)` | `merge_custom_options(raw, custom_opts, step_idx=i)` | `custom_options`를 step별로 병합. `step{i}/` 접두 경로는 해당 스텝에만, 비접두 경로는 전 스텝 공통 | `app/features/inp/service.py` |
| `app/features/inp/service.py`의 `build_full_inp(tree, atom_info, step_idx, **kwargs)` | 스텝당 1회 호출, `.inp` 텍스트 반환 | SMEAR 주입/제거, 비직교 셀 MIXING 보강, 3-pass 치유, 최종 렌더링 | `app/features/inp/service.py` |
| `app/shared/schema_engine.py` (`CP2KSchemaEngine` 인스턴스) | `build_full_inp` 내부에서 `engine.dict_to_tree_schema_aware(...)`; 치유가 `validate_and_relocate(...)` | 스키마 거버넌스(키 정규화/재배치) + 트리 렌더링 | `app/features/inp/service.py` / `app/shared/self_healing.py` |
| `app/shared/self_healing.py`의 `healing_engine.validate_and_correct(options, mandatory_params=...)` | `build_full_inp`가 **3회 반복** 호출 | 스키마 정규화 + 물리 규칙 강제(자가치유) | `app/features/inp/service.py` |
| `app/shared/physics_rules.py`의 `apply_physics_rules(options)` | `validate_and_correct` 내부에서 호출 | 물리적 무결성/모순 강제, 유실 파라미터 복구 | `app/shared/self_healing.py` |
| `app/features/inp/schemas.py`의 `InpRequest` | FastAPI가 요청 본문을 파싱 | `/generate-inp` 요청 스키마(소유) | `app/features/inp/schemas.py` |

**거버넌스 흐름 요약** (clean 관점의 책임 분리):
`generate_inp_logic`(필터·분기) → `parse_path_based_options`/`merge_custom_options`(옵션 정규화) → `build_full_inp`(SMEAR·triclinic 보강 + 렌더링) → `validate_and_correct` ×3(거버넌스·치유) → `app/shared/schema_engine.py`의 `dict_to_tree_schema_aware` + `tree_to_lines`(렌더링).

---

## 외부 의존성

`f3-inp`의 `/generate-inp` 경로는 **외부 의존성이 없다**(`external_deps: []`).

| 항목 | f3-inp 사용 여부 | 비고 |
|---|---|---|
| Anthropic API 키 (`CLAUDE_API_KEY`) | ❌ 미사용 | LLM 호출은 `app/features/plan/service.py`의 `generate_plan_logic`(f2-plan)만 사용(클라이언트는 `app/core/llm.py`). f3의 `generate_inp_logic`/`build_full_inp`는 LLM을 호출하지 않음. **`.inp` 생성은 결정론적** |
| `ANTHROPIC_MODEL` | ❌ 미사용 | 위와 동일(f2 전용) |
| SGE / `qsub` | ❌ 미사용 | 작업 제출은 f4-jobs. f3는 텍스트만 생성하고 디스크/스케줄러를 건드리지 않음 |
| 파일 경로 / 디스크 I/O | ❌ 미사용 | `generated_files`는 메모리상 문자열로만 반환. 디스크 기록은 f4-jobs(`simulations/{directory}/`) |
| 환경변수 | ❌ 없음 | f3 경로에서 읽는 환경변수 없음 |
| 파이썬 패키지 | (간접) | `app/shared/schema_engine.py`/`app/shared/self_healing.py`/`app/shared/physics_rules.py`가 사용하는 표준/내부 라이브러리에만 간접 의존. 외부 네트워크 없음 |

> 결정론성 보장: 동일 입력 → 동일 `.inp` 출력. LLM/네트워크/시간 의존이 없으므로 테스트가 재현 가능하다.

---

## 병렬 개발 가이드

### 무엇을 목업하면 단독 개발이 가능한가

f3-inp는 **상류(f1/f2)와 하류(f4) 모두 미완성이어도 완전 독립 개발 가능**하다. LLM·네트워크·디스크 의존이 없기 때문이다.

1. **상류 입력 목업 (f1/f2 불필요)**: 위 [소비하는 데이터 계약]의 `AtomInfo` / `PlanStep` 목업 JSON을 그대로 `InpRequest` 본문으로 조립하면 된다. f1-structure(`/analyze-cif`)나 f2-plan(`/generate-plan`)을 실제로 띄울 필요가 없다.
2. **하류 검증 목업 (f4 불필요)**: 응답 `GeneratedFile`은 `{filename, content}` 두 키만 확정이면 f4가 소비 가능하다. f4를 띄우지 않고도 응답 스키마 단위 테스트로 계약 충족을 검증한다.
3. **공유 모듈 목업 (선택)**: `schema_engine`/`self_healing`/`physics_rules`를 실제로 쓰면 풀스택 흐름을 그대로 검증할 수 있어 권장. 다만 이들이 불안정하면, `build_full_inp`를 다음 시그니처의 스텁으로 대체해 `generate_inp_logic`의 필터·분기·파일명 로직만 먼저 개발 가능:

   ```python
   def build_full_inp(tree, atom_info, step_idx=1, **kwargs) -> str:
       # 스텁: 인자가 제대로 흘러오는지만 확인
       return f"&GLOBAL\n  PROJECT step{step_idx}\n  RUN_TYPE {kwargs.get('run_type','ENERGY')}\n&END GLOBAL"
   ```

### 완료 정의 (DoD)

- [ ] `POST /generate-inp`가 `InpRequest`(필수 7필드 + 선택 필드)를 검증하고, 누락/타입오류 시 `422`를 반환한다.
- [ ] **스텝 필터**: `selected != False AND exclude != True`만 통과. selected/exclude 미지정 스텝은 포함된다.
- [ ] **단일 분기**: `multi_atom_info`가 없거나 `len<=1`이면 `req.atom_info` 기준으로 `step{i}.inp`(i=필터 후 1-based)를 생성한다.
- [ ] **다중 분기**: `multi_atom_info`가 있고 `len>1`이면 구조마다 `{base}_step{i}.inp`를 생성한다. `base`는 `filename`에서 `.cif` 제거 + 공백→`_` 치환.
- [ ] **다중 분기 구조별 우선**: smear/smear_temp는 구조 키(`struct["use_smear"]`/`struct["smear_temp"]`)가 존재하면 구조값이 `req` 값보다 우선한다.
- [ ] `inp_options`가 `list`/`dict` 둘 다 정상 처리되고, `custom_options`가 truthy일 때 `step{i}/` 접두/비접두 경로가 의도대로 병합된다.
- [ ] 응답이 `GenerateInpResult`(`status:"success"`, `generated_files: GeneratedFile[]`) 스키마를 만족하고, f3가 생산하는 `GeneratedFile`에는 `validation_logs`가 없다.
- [ ] 선택 스텝 0개일 때 `200` + `generated_files: []`를 반환한다(에러 아님).
- [ ] 동일 입력 2회 호출 시 바이트 단위로 동일한 `content`가 나온다(결정론성).
- [ ] parse-failure / empty-CIF 폴백 `AtomInfo`(선택 키 부재)를 넣어도 `KeyError` 없이 동작한다(방어적 `.get` 검증).
- [ ] 생성/제거된 SMEAR, 비직교 셀(`cell_angles`가 90°에서 5° 초과 이탈) MIXING 보강이 `use_smear`/`cell_angles`에 따라 올바르게 반영된다.
- [ ] (통합) 응답 `generated_files`를 그대로 f4-jobs `/submit-job`의 `files[]`로 전달했을 때 형태 호환된다(계약 라운드트립).