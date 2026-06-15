# 데이터 모델 (Data Models)

> **목적**: 이 문서는 기능 경계를 가로지르는 **모든 데이터 계약(Data Contract)의 표준 사전(SSOT, Single Source of Truth)** 입니다.
> 한 기능(feature)이 생산(`produced_by`)하고 다른 기능들이 소비(`consumed_by`)하는 모든 dict / Pydantic 모델 / 디스크 파일 포맷을 여기에서 한 번만 정의합니다.
> 같은 구조가 여러 곳에서 재사용되면 **단 한 번만** 정의하고, 다른 계약은 이름으로 참조합니다.

## 기능(Feature) 식별자

| ID | 이름 | 책임 |
|----|------|------|
| `f1-structure` | 구조 분석 | CIF 파싱 → `AtomInfo` 생성, K-point 캐시 |
| `f2-plan` | AI 플랜 생성 | `AtomInfo` + DFT 파라미터 → 시뮬레이션 단계(`PlanStep`) 설계 |
| `f3-inp` | INP 생성 | 플랜 → CP2K `.inp` 파일 렌더링 |
| `f4-jobs` | 작업 제출/모니터링 | `.inp` 제출(SGE), 실시간 상태 추적, 자가치유 |
| `f5-report` | 리포트 생성 | 디스크 산출물 파싱 → 마크다운 리포트 |
| `f6-benchmark` | 벤치마크 | 공식 결과 vs 에이전트 결과 정확도 비교 |

## 계약 의존성 개요

```
f1-structure ── AtomInfo ─────────────▶ f2-plan, f3-inp, f4-jobs, f6-benchmark
f1-structure ── AnalyzeCifResponse ───▶ (프런트엔드)
f2-plan      ── PlanStep ─────────────▶ f3-inp, f4-jobs, f6-benchmark
f3-inp       ── GeneratedFile ────────▶ f4-jobs
f4-jobs      ── SubmitJobResponse.directory ─▶ f5-report
f4-jobs      ── MultiMetadata (디스크) ──────▶ f5-report
f4-jobs      ── SimulationArtifacts (디스크) ─▶ f5-report
```

> **중요 (f5-report 경계)**: `f5-report`(app/features/report/service.py)는 `JobStatus` / `StepHistory` / `BenchmarkReport` 같은 **인메모리 객체를 전혀 소비하지 않습니다.** reporter는 오직 (1) `SubmitJobResponse.directory` 문자열, (2) 디스크의 `MultiMetadata`(`multi_metadata.json`), (3) 디스크의 `SimulationArtifacts`(`*.out`/`*.pdos`/`*.bs`)만 읽습니다.

---

## 목차

1. [AtomInfo](#1-atominfo) — 정규화된 구조 정보 (SSOT)
2. [AnalyzeCifResponse](#2-analyzecifresponse)
3. [KpointCacheUpdate](#3-kpointcacheupdate)
4. [PlanRequest](#4-planrequest)
5. [PlanStep](#5-planstep) — 핵심 교차 계약
6. [PlanResult](#6-planresult)
7. [InpRequest](#7-inprequest)
8. [GeneratedFile](#8-generatedfile)
9. [GenerateInpResult](#9-generateinpresult)
10. [SubmitRequest](#10-submitrequest)
11. [SubmitJobResponse](#11-submitjobresponse)
12. [JobStatus](#12-jobstatus)
13. [StepHistory](#13-stephistory)
14. [MultiMetadata](#14-multimetadata)
15. [SimulationArtifacts](#15-simulationartifacts) — 디스크 파일 포맷
16. [JobLiveStatusResponse](#16-joblivestatusresponse)
17. [ReportRequest](#17-reportrequest)
18. [ReportData](#18-reportdata)
19. [BenchmarkRequest](#19-benchmarkrequest)
20. [BenchmarkReport](#20-benchmarkreport)
21. [BenchmarkLevelReport](#21-benchmarklevelreport)

---

## 1. AtomInfo

**설명**: CIF 파싱으로 생성되는 정규화된 구조 정보 dict. **파이프라인 전체의 단일 진실 소스(SSOT)** 로, 플랜/입력생성/제출/벤치마크 모든 요청에 실립니다.

> ⚠️ **세 가지 형태가 존재하며 키 집합이 서로 다릅니다.** 소비자는 선택적 키를 반드시 `.get()` 으로 읽고, `atom_count == 0` 및 `error` 키 유무를 방어적으로 체크해야 합니다.
>
> | 형태 | 트리거 | 부재 키 |
> |------|--------|---------|
> | **정상 경로** (success) | ASE 파싱 성공, 원자 ≥ 1 | (전체 키 존재) |
> | **parse-failure 폴백** | `ase.io.read` 예외 | `cell_angles`, `smear_*` 부재. `element_indices`/`volume`/`kpoint_recommended`/`initial_guess_kpoint`는 존재(빈 값/기본값), `error` 추가 |
> | **empty-CIF 폴백** | 파싱 성공했으나 원자 0개 (예: NEB용 빈 CIF) | `element_indices`/`volume`/`kpoint_recommended`/`initial_guess_kpoint`/`cell_angles`/`smear_*` 모두 부재, `error` 추가 |

| key | type | required | notes |
|-----|------|:--------:|-------|
| `filename` | `str` | ✅ | 구조 파일명. **세 형태 모두 존재** |
| `atom_count` | `int` | ✅ | 원자 수. 파싱 실패/빈 CIF 시 `0`. **세 형태 모두 존재** |
| `atoms` | `List[{element:str, x:float, y:float, z:float}]` | ✅ | 원자별 좌표(unwrapping 보정 후). 실패/빈CIF 시 빈 리스트. **세 형태 모두 존재** |
| `elements` | `List[str]` | ✅ | 등장 원소 기호 목록(`element_counts.keys()`). 실패/빈CIF 시 `[]` |
| `element_counts` | `Dict[str,int]` | ✅ | 원소별 개수(`Counter`). 실패/빈CIF 시 `{}` |
| `element_indices` | `Dict[str,List[int]]` | ⬜ | 원소별 **1-based** 인덱스. 정상 경로 + parse-failure 폴백(`{}`)에만 존재. **empty-CIF 폴백에는 부재** |
| `cell` | `List[float]` (길이 3) | ✅ | `[a,b,c]` 격자상수. CIF 태그 원본 우선, 없으면 ASE 교차검증. **세 형태 모두 존재**(폴백은 정규식 추출 또는 `10.0` 기본) |
| `cell_angles` | `List[float]` (길이 3) | ⬜ | `[alpha,beta,gamma]` 도(degree) 단위. **정상 경로에만 존재**. 폴백에는 부재 → 소비자(generator `_is_non_orthogonal_cell` / `cell_angles_str`)는 `.get`으로 90도 기본 처리 |
| `volume` | `float` | ⬜ | 셀 부피(`get_volume()`). 정상 경로 + parse-failure 폴백(`a*b*c` 단순곱)에 존재. **empty-CIF 폴백에는 부재** |
| `full_coord_text` | `str` | ✅ | CP2K `COORD` 섹션용 좌표 텍스트. 실패/빈CIF 시 `""`. **세 형태 모두 존재** |
| `full_cell_text` | `str` | ✅ | `ABC` + `ALPHA_BETA_GAMMA` 텍스트. **세 형태 모두 존재**(폴백은 포맷 정밀도 없음) |
| `use_scaled` | `bool` | ✅ | `SCALED` 좌표 모드 제안 여부(모든 좌표 절댓값 ≤ 1.2 & 원자수 > 0). 폴백은 항상 `False`. **세 형태 모두 존재** |
| `kpoint_recommended` | `bool` | ⬜ | K-point 샘플링 권장(어떤 축 < 10 Å). 정상 경로 + parse-failure 폴백(`False`)에 존재. **empty-CIF 폴백에는 부재** |
| `initial_guess_kpoint` | `str` | ⬜ | 권장 k-grid 예 `"2 2 1"`(공백 구분 3정수). 정상 경로 + parse-failure 폴백(`"1 1 1"`)에 존재. **empty-CIF 폴백에는 부재** |
| `smear_recommended` | `bool` | ⬜ | `SMEAR` 권장 여부(금속/전이금속/triclinic/조건부 금속 판정). **정상 경로에만 존재** |
| `smear_reason_ko` | `str` | ⬜ | SMEAR 권장 사유(한국어). **정상 경로에만 존재** |
| `smear_reason_en` | `str` | ⬜ | SMEAR 권장 사유(영어). generator가 읽음. **정상 경로에만 존재** |
| `verified_optimal_kpoint` | `str` | ⬜ | 선택적. 캐시/검증된 최적 k-point. inp생성·제출 다중분기에서 `req.kpoints`보다 우선 사용 |
| `periodic` | `str` | ⬜ | 선택적. 없으면 generator가 `'XYZ'`로 fallback |
| `error` | `str` | ⬜ | **파싱 실패/빈 CIF 시에만 존재**하는 예외 메시지. parse-failure = `str(e)`, empty-CIF = `'Empty CIF (No atoms)'` |

- **produced_by**: `f1-structure`
- **consumed_by**: `f2-plan`, `f3-inp`, `f4-jobs`, `f6-benchmark`

### 예시 (정상 경로)

```json
{
  "filename": "TiO2_anatase.cif",
  "atom_count": 6,
  "atoms": [
    { "element": "Ti", "x": 0.0,       "y": 0.0,       "z": 0.0 },
    { "element": "Ti", "x": 1.8965,    "y": 1.8965,    "z": 4.7795 },
    { "element": "O",  "x": 0.0,       "y": 0.0,       "z": 2.0762 },
    { "element": "O",  "x": 0.0,       "y": 0.0,       "z": -2.0762 },
    { "element": "O",  "x": 1.8965,    "y": 1.8965,    "z": 2.7033 },
    { "element": "O",  "x": 1.8965,    "y": 1.8965,    "z": 6.8557 }
  ],
  "elements": ["Ti", "O"],
  "element_counts": { "Ti": 2, "O": 4 },
  "element_indices": { "Ti": [1, 2], "O": [3, 4, 5, 6] },
  "cell": [3.793, 3.793, 9.559],
  "cell_angles": [90.0, 90.0, 90.0],
  "volume": 137.52,
  "full_coord_text": "      Ti   0.00000000   0.00000000   0.00000000\n      Ti   1.89650000   1.89650000   4.77950000\n      O    0.00000000   0.00000000   2.07620000",
  "full_cell_text": "      ABC   3.79300000   3.79300000   9.55900000\n      ALPHA_BETA_GAMMA  90.00000000  90.00000000  90.00000000",
  "use_scaled": false,
  "kpoint_recommended": true,
  "initial_guess_kpoint": "8 8 3",
  "smear_recommended": true,
  "smear_reason_ko": "전이금속 또는 희토류 원소가 포함되어 있어 d/f 오비탈의 축퇴로 인한 수렴 저하를 방지하기 위해 SMEAR 활성화가 권장됩니다.",
  "smear_reason_en": "Contains transition metal or lanthanide elements. Enabling SMEAR is recommended to prevent SCF convergence issues due to d/f orbital degeneracy."
}
```

### 예시 (parse-failure 폴백)

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
  "use_scaled": false,
  "full_coord_text": "",
  "full_cell_text": "      ABC 10.0 10.0 10.0\n      ALPHA_BETA_GAMMA 90.0 90.0 90.0",
  "kpoint_recommended": false,
  "initial_guess_kpoint": "1 1 1",
  "error": "Failed to parse CIF block"
}
```

### 예시 (empty-CIF 폴백)

```json
{
  "filename": "neb_endpoint_empty.cif",
  "atom_count": 0,
  "atoms": [],
  "elements": [],
  "element_counts": {},
  "cell": [12.5, 12.5, 12.5],
  "use_scaled": false,
  "full_coord_text": "",
  "full_cell_text": "      ABC 12.5 12.5 12.5\n      ALPHA_BETA_GAMMA 90.0 90.0 90.0",
  "error": "Empty CIF (No atoms)"
}
```

---

## 2. AnalyzeCifResponse

**설명**: `POST /analyze-cif` 응답. `atom_info`와 캐시 조회 결과(`content_hash`, `cached_kpoint`)를 함께 반환합니다. 프런트엔드는 `cached_kpoint`가 있으면 K-point 입력을 자동으로 채웁니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'success'` 고정. 비-cif 확장자는 `400`, 처리 실패는 `500` |
| `filename` | `str` | ✅ | 업로드 파일명 |
| `atom_info` | [`AtomInfo`](#1-atominfo) | ✅ | 분석된 구조 정보 |
| `content_hash` | `str` | ✅ | CIF 본문 SHA-256 hex(64자). `/update-kpoint-cache` 키로 재사용 |
| `cached_kpoint` | `str \| null` | ✅ | 캐시된 최적 K-point 문자열 또는 `null` |

- **produced_by**: `f1-structure`
- **consumed_by**: `f2-plan`, `f3-inp`, `f4-jobs` (프런트엔드 경유)

### 예시

```json
{
  "status": "success",
  "filename": "TiO2_anatase.cif",
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 6, "atoms": ["...생략(AtomInfo 참조)..."] },
  "content_hash": "a3f5c9e1b8d2740a6f1e2c3b4d5e6f70819aabbccddeeff00112233445566778",
  "cached_kpoint": "8 8 3"
}
```

---

## 3. KpointCacheUpdate

**설명**: `POST /update-kpoint-cache` 요청 본문. 프런트가 작업 완료 후 검증된 최적 K-point를 CIF 해시 키로 영속 캐시(`kpoint_cache.json`)에 기록합니다. `content_hash`와 `kpoint`가 **모두 truthy일 때만** 저장됩니다.

> ⚠️ **현재 구현 주의**: `app/features/structure/router.py`가 `kp_cache._cache[content_hash] = kpoint` 로 내부 dict에 직접 대입한 뒤 `_save_cache()`를 호출합니다(캡슐화 위반). clean 재설계 시 `save_by_hash(content_hash, kpoint)` 같은 public 메서드를 권장합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `content_hash` | `str` | ✅ | `AnalyzeCifResponse.content_hash`에서 받은 SHA-256 해시 |
| `kpoint` | `str` | ✅ | 저장할 최적 K-point 문자열 예 `"2 2 1"` |

- **produced_by**: `f1-structure`
- **consumed_by**: `f1-structure`

### kpoint_cache.json 파일 구조

키는 CIF 본문 SHA-256 hexdigest(동적 키, 고정 키 이름 없음), 값은 K-point 문자열입니다. 타입 힌트는 `Dict[str, str]`.

### 예시 (요청 본문)

```json
{
  "content_hash": "a3f5c9e1b8d2740a6f1e2c3b4d5e6f70819aabbccddeeff00112233445566778",
  "kpoint": "2 2 1"
}
```

### 예시 (kpoint_cache.json 디스크 구조)

```json
{
  "a3f5c9e1b8d2740a6f1e2c3b4d5e6f70819aabbccddeeff00112233445566778": "2 2 1",
  "b1029384756acefdb1029384756acefdb1029384756acefdb1029384756acefd": "4 4 4"
}
```

---

## 4. PlanRequest

**설명**: `POST /generate-plan` 요청 본문(Pydantic). `atom_info` + DFT 파라미터로 LLM 플랜 생성을 요청합니다.

> ⚠️ **특징**: 다른 요청 모델과 달리 `lang` 필드를 가집니다. `active_tokens`는 **모델 정의에 없는 동적 속성**으로, benchmark가 `setattr`로 주입하고 `generate_plan_logic`(app/features/plan/service.py)이 `hasattr(req, 'active_tokens')`로 체크합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `atom_info` | [`AtomInfo`](#1-atominfo) | ✅ | 구조 정보 |
| `property` | `str` | ✅ | 계산 물성 예 `'energy'`, `'geo_opt'`, `'absorption'`. `PROPERTY_SECTION_MAP` 키로 `lower()` 사용 |
| `basis_set` | `str` | ✅ | 기저함수 세트 예 `'DZVP-MOLOPT-GTH'` |
| `cutoff` | `float` | ✅ | 평면파 cutoff (Ry) |
| `rel_cutoff` | `float` | ✅ | relative cutoff |
| `functional` | `str` | ✅ | XC functional 예 `'PBE'` |
| `method` | `str` | ⬜ | 기본 `'GPW'` |
| `scf_algo` | `str` | ⬜ | 기본 `'OT'` |
| `charge` | `int` | ⬜ | 기본 `0` |
| `multiplicity` | `int` | ⬜ | 기본 `1` |
| `use_smear` | `bool` | ⬜ | 기본 `False`. `False`면 forbidden_tokens에 `'SMEAR'` 추가 |
| `smear_temp` | `float` | ⬜ | 기본 `300.0` |
| `custom_options` | `Dict[str,Any]` | ⬜ | 기본 `{}`. 경로기반 옵션 오버라이드, `OPTION_TOKEN_MAP`으로 토큰 보강 |
| `lang` | `str` | ⬜ | 기본 `'ko'`. `'en'`이면 프롬프트 영어화. **이 모델에만 존재** |
| `kpoints` | `str \| null` | ⬜ | 기본 `None`. `None`이면 Gamma-point |
| `eps_scf` | `str` | ⬜ | 기본 `'1.0E-6'` |
| `periodic` | `str` | ⬜ | 기본 `'XYZ'` |
| `max_scf` | `int \| null` | ⬜ | 기본 `None` |
| `ignore_scf_failure` | `bool` | ⬜ | 기본 `False` |
| `basis_file` | `str \| null` | ⬜ | 기본 `None` |
| `pot_file` | `str \| null` | ⬜ | 기본 `None` |
| `lsd` | `bool` | ⬜ | 기본 `False`. LSD(UKS) |
| `added_mos` | `str \| null` | ⬜ | 기본 `None` |
| `active_tokens` | `List[str]` | ⬜ | **모델 정의에 없는 동적 속성.** `generate_plan_logic`이 `hasattr(req,'active_tokens')`로 체크해 있으면 토큰 집합에 추가. `benchmark_manager` 등이 `setattr`로 주입 |

- **produced_by**: `f2-plan`
- **consumed_by**: `f2-plan`

### 예시

```json
{
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 6, "elements": ["Ti", "O"] },
  "property": "geo_opt",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 600.0,
  "rel_cutoff": 60.0,
  "functional": "PBE",
  "method": "GPW",
  "scf_algo": "OT",
  "charge": 0,
  "multiplicity": 1,
  "use_smear": true,
  "smear_temp": 300.0,
  "custom_options": { "vdw_corr": "DFTD3" },
  "lang": "ko",
  "kpoints": "8 8 3",
  "eps_scf": "1.0E-6",
  "periodic": "XYZ",
  "max_scf": null,
  "ignore_scf_failure": false,
  "basis_file": null,
  "pot_file": null,
  "lsd": false,
  "added_mos": null
}
```

---

## 5. PlanStep

**설명**: AI가 생성하는 단일 플랜 스텝. `/generate-plan` 응답의 `steps[]` 요소이며, `/generate-inp`·`/submit-job` 요청의 `steps[]`로 다시 전달되는 **기능 경계를 가로지르는 핵심 계약**입니다. 소비자(generator/orchestrator)는 `.get()`으로 방어적으로 읽습니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `step_idx` | `int` | ⬜ | **1-based** 인덱스. 자가치유/재인덱싱에서 참조 |
| `step_name` | `str` | ✅ | 단계 이름. orchestrator가 `'Step N: ...'`로 재작성 |
| `importance` | `str` | ⬜ | `'필수'` \| `'권장'` \| `'선택'` |
| `run_type` | `str` | ✅ | CP2K RUN_TYPE 예 `'ENERGY'`,`'GEO_OPT'`,`'CELL_OPT'`,`'MD'`,`'TDDFPT'`. 기본 `'ENERGY'` |
| `physics_reason` | `str` | ⬜ | 물리적 근거 (AI 설명, 1~2문장) |
| `objective` | `str` | ⬜ | 목표 (AI 설명) |
| `description` | `str` | ⬜ | 방법론 (AI 설명) |
| `inp_options` | `List[str] \| Dict[str,Any]` | ✅ | 경로기반 옵션 예 `"FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6"`(`&` 없이 `/` 구분 FULL PATH). list면 `parse_path_based_options`로 dict 변환. `COORD`/`CELL`/`KIND` 금지(NO SUBSYS) |
| `selected` | `bool` | ⬜ | 기본 `True`. `False`면 제외 |
| `exclude` | `bool` | ⬜ | 기본 `False`. `True`면 제외 |
| `active_tokens` | `List[str]` | ⬜ | **두 경로가 서로 다른 소비처임에 주의** (아래 박스 참조) |

> ⚠️ **`active_tokens`의 이중 경로**
> 1. **플랜 생성 단계**: PlanStep 키가 아니라 **`req`(PlanRequest) 동적 속성**으로 토큰이 추가됨 (`generate_plan_logic`, app/features/plan/service.py `req.active_tokens`).
> 2. **inp/제출 단계**: **step 키**로 읽혀 `build_full_inp`/AI 치유 메타에 전달됨 (app/features/jobs/service.py `step.get('active_tokens',[])`).
>
> 따라서 PlanStep의 `active_tokens`는 **제출/inp 단계 전용 키**이며, 플랜 생성 시점의 토큰 주입은 `req` 쪽에 해야 합니다.

- **produced_by**: `f2-plan`
- **consumed_by**: `f3-inp`, `f4-jobs`, `f6-benchmark`

### 예시

```json
{
  "step_idx": 1,
  "step_name": "구조 최적화 (Geometry Optimization)",
  "importance": "필수",
  "run_type": "GEO_OPT",
  "physics_reason": "초기 CIF 좌표는 실험적 불확실성을 포함하므로, 힘이 수렴하도록 원자 위치를 완화해야 정확한 전자 구조를 얻을 수 있습니다.",
  "objective": "바닥 상태 평형 구조 확보",
  "description": "BFGS 옵티마이저로 원자에 작용하는 최대 힘이 임계값 이하로 수렴할 때까지 이완합니다.",
  "inp_options": [
    "FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-6",
    "FORCE_EVAL/DFT/SCF/MAX_SCF 50",
    "MOTION/GEO_OPT/OPTIMIZER BFGS",
    "MOTION/GEO_OPT/MAX_ITER 200"
  ],
  "selected": true,
  "exclude": false
}
```

---

## 6. PlanResult

**설명**: `POST /generate-plan` 응답. `expert_tip` + `steps` + 에코된 `atom_info`(SSOT 동기화). AI JSON 파싱 실패 시 `steps=[]`로 폴백합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `expert_tip` | `str` | ✅ | 시스템 특성 기반 전략 요약. 파싱 실패 시 폴백 문구(ko/en) |
| `steps` | `List[`[`PlanStep`](#5-planstep)`]` | ✅ | AI 설계 단계 목록. 파싱 실패 시 `[]` |
| `atom_info` | [`AtomInfo`](#1-atominfo) | ✅ | 요청 `atom_info`를 그대로 에코 (SSOT, `data['atom_info']=req.atom_info`) |

- **produced_by**: `f2-plan`
- **consumed_by**: `f6-benchmark`

### 예시

```json
{
  "expert_tip": "이 시스템은 전이금속(Ti)을 포함하므로 SCF 수렴이 까다롭습니다. SMEAR 활성화와 함께 충분한 cutoff(600 Ry 이상)를 권장합니다.",
  "steps": [
    { "step_idx": 1, "step_name": "구조 최적화", "run_type": "GEO_OPT", "inp_options": ["MOTION/GEO_OPT/OPTIMIZER BFGS"], "selected": true },
    { "step_idx": 2, "step_name": "단일점 에너지", "run_type": "ENERGY", "inp_options": ["FORCE_EVAL/DFT/SCF/EPS_SCF 1.0E-7"], "selected": true }
  ],
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 6, "elements": ["Ti", "O"] }
}
```

---

## 7. InpRequest

**설명**: `POST /generate-inp` 요청 본문(Pydantic). PlanRequest 필드 대부분 + `steps` + `multi_atom_info`. **`lang` 필드는 없습니다.**

| key | type | required | notes |
|-----|------|:--------:|-------|
| `atom_info` | [`AtomInfo`](#1-atominfo) | ✅ | 단일 구조 정보 |
| `steps` | `List[`[`PlanStep`](#5-planstep)`]` | ✅ | 플랜 단계 목록. `selected`/`exclude`/`inp_options`/`run_type` 키를 읽음 |
| `property` | `str` | ✅ | 계산 물성 |
| `basis_set` | `str` | ✅ | 기저함수 세트 |
| `cutoff` | `float` | ✅ | cutoff (Ry) |
| `rel_cutoff` | `float` | ✅ | relative cutoff |
| `functional` | `str` | ✅ | XC functional |
| `method` | `str` | ⬜ | 기본 `'GPW'` |
| `scf_algo` | `str` | ⬜ | 기본 `'OT'` |
| `charge` | `int` | ⬜ | 기본 `0` |
| `multiplicity` | `int` | ⬜ | 기본 `1` |
| `use_smear` | `bool` | ⬜ | 기본 `False`. multi분기는 struct값 우선 |
| `smear_temp` | `float` | ⬜ | 기본 `300.0` |
| `custom_options` | `Dict[str,Any]` | ⬜ | 기본 `{}`. `merge_custom_options`로 step별 병합 |
| `kpoints` | `str \| null` | ⬜ | 기본 `None`. multi분기는 `verified_optimal_kpoint` → `initial_guess_kpoint` → `req.kpoints` 순 |
| `eps_scf` | `str` | ⬜ | 기본 `'1.0E-6'` |
| `periodic` | `str` | ⬜ | 기본 `'XYZ'` |
| `max_scf` | `int \| null` | ⬜ | 기본 `None` |
| `ignore_scf_failure` | `bool` | ⬜ | 기본 `False` |
| `basis_file` | `str \| null` | ⬜ | 기본 `None` |
| `pot_file` | `str \| null` | ⬜ | 기본 `None` |
| `lsd` | `bool` | ⬜ | 기본 `False` |
| `added_mos` | `str \| null` | ⬜ | 기본 `None` |
| `multi_atom_info` | `List[`[`AtomInfo`](#1-atominfo)`] \| null` | ⬜ | 기본 `None`. `len > 1`이면 구조별 개별 `.inp` 생성 |

- **produced_by**: `f3-inp`
- **consumed_by**: `f3-inp`

### 예시

```json
{
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 6, "elements": ["Ti", "O"] },
  "steps": [
    { "step_name": "구조 최적화", "run_type": "GEO_OPT", "inp_options": ["MOTION/GEO_OPT/OPTIMIZER BFGS"], "selected": true }
  ],
  "property": "geo_opt",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 600.0,
  "rel_cutoff": 60.0,
  "functional": "PBE",
  "method": "GPW",
  "use_smear": true,
  "kpoints": "8 8 3",
  "custom_options": {},
  "multi_atom_info": null
}
```

---

## 8. GeneratedFile

**설명**: 생성된 단일 CP2K `.inp` 파일. `/generate-inp` 응답 `generated_files[]` 요소이자, `/submit-job` 요청 `files[]`(Pydantic `FileItem`)의 **호환 형태**입니다. 기능 경계(inp생성 → 제출)를 가로지릅니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `filename` | `str` | ✅ | 단일 구조 `'step{i}.inp'`, 다중 구조 `'{base}_step{i}.inp'`(`base` = `struct.filename`에서 `.cif` 제거 및 공백→`_`) |
| `content` | `str` | ✅ | `build_full_inp`가 렌더링한 CP2K `.inp` 텍스트 |
| `validation_logs` | `List \| null` | ⬜ | 선택. `FileItem`으로 제출 시 검증 로그. **제출 측(`FileItem`) 모델에만 존재** |

- **produced_by**: `f3-inp`
- **consumed_by**: `f4-jobs`, `f6-benchmark`

### 예시

```json
{
  "filename": "step1.inp",
  "content": "&GLOBAL\n  PROJECT_NAME CP2K_AGENT_FORCE_WRITE_V1\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n&FORCE_EVAL\n  METHOD QUICKSTEP\n  &DFT\n    ...\n  &END DFT\n&END FORCE_EVAL\n",
  "validation_logs": null
}
```

---

## 9. GenerateInpResult

**설명**: `POST /generate-inp` 응답. 생성된 `.inp` 파일 목록.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'success'` 고정 |
| `generated_files` | `List[`[`GeneratedFile`](#8-generatedfile)`]` | ✅ | 생성된 `.inp` 파일 리스트 |

- **produced_by**: `f3-inp`
- **consumed_by**: `f4-jobs`

### 예시

```json
{
  "status": "success",
  "generated_files": [
    { "filename": "step1.inp", "content": "&GLOBAL\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n..." },
    { "filename": "step2.inp", "content": "&GLOBAL\n  RUN_TYPE ENERGY\n&END GLOBAL\n..." }
  ]
}
```

---

## 10. SubmitRequest

**설명**: `POST /submit-job` 요청 본문(Pydantic). 생성된 `.inp`(`files`) 또는 자동생성으로 작업을 제출합니다.

> ⚠️ **기본값이 다른 모델과 다름**: `cutoff=400.0`, `rel_cutoff=50.0`, `functional='PBE'`, `basis_set='DZVP-MOLOPT-GTH'`, `property='energy'` (다른 모델들에서는 이 필드들이 필수). `property`가 `absorption`/`emission`이면 `kpoints`를 강제 `None`(Gamma)으로 합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `files` | `List[`[`GeneratedFile`](#8-generatedfile)`] \| null` | ⬜ | 기본 `None`. 제출할 `.inp` 파일(`FileItem`). `None`이면 오케스트레이터가 자동 생성 |
| `atom_info` | [`AtomInfo`](#1-atominfo) | ✅ | 구조 정보 |
| `steps` | `List[`[`PlanStep`](#5-planstep)`]` | ✅ | 플랜 단계 목록 |
| `job_name` | `str \| null` | ⬜ | 기본 `None`. 폴더명. 없으면 `job_{timestamp}` |
| `multi_atom_info` | `List[`[`AtomInfo`](#1-atominfo)`] \| null` | ⬜ | 기본 `None`. `len > 1`이면 다중구조 병렬 제출 |
| `cutoff` | `float` | ⬜ | **기본 `400.0`** |
| `rel_cutoff` | `float` | ⬜ | **기본 `50.0`** |
| `functional` | `str` | ⬜ | **기본 `'PBE'`** |
| `basis_set` | `str` | ⬜ | **기본 `'DZVP-MOLOPT-GTH'`** |
| `method` | `str` | ⬜ | 기본 `'GPW'` |
| `scf_algo` | `str` | ⬜ | 기본 `'OT'` |
| `charge` | `int` | ⬜ | 기본 `0` |
| `multiplicity` | `int` | ⬜ | 기본 `1` |
| `use_smear` | `bool` | ⬜ | 기본 `False` |
| `smear_temp` | `float` | ⬜ | 기본 `300.0` |
| `kpoints` | `str \| null` | ⬜ | 기본 `None` |
| `property` | `str` | ⬜ | **기본 `'energy'`** |
| `custom_options` | `Dict[str,Any]` | ⬜ | 기본 `{}`. `expert_tip` 키를 오케스트레이터에 전달 |
| `eps_scf` | `str` | ⬜ | 기본 `'1.0E-6'` |
| `periodic` | `str` | ⬜ | 기본 `'XYZ'` |
| `max_scf` | `int \| null` | ⬜ | 기본 `None` |
| `ignore_scf_failure` | `bool` | ⬜ | 기본 `False` |
| `basis_file` | `str \| null` | ⬜ | 기본 `None` |
| `pot_file` | `str \| null` | ⬜ | 기본 `None` |
| `lsd` | `bool` | ⬜ | 기본 `False` |
| `added_mos` | `str \| null` | ⬜ | 기본 `None` |

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`

### 예시

```json
{
  "files": [
    { "filename": "step1.inp", "content": "&GLOBAL\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n..." }
  ],
  "atom_info": { "filename": "TiO2_anatase.cif", "atom_count": 6, "elements": ["Ti", "O"] },
  "steps": [
    { "step_name": "구조 최적화", "run_type": "GEO_OPT", "inp_options": ["MOTION/GEO_OPT/OPTIMIZER BFGS"], "selected": true }
  ],
  "job_name": "TiO2_geoopt_run",
  "multi_atom_info": null,
  "cutoff": 600.0,
  "rel_cutoff": 60.0,
  "functional": "PBE",
  "basis_set": "DZVP-MOLOPT-GTH",
  "property": "geo_opt",
  "use_smear": true,
  "kpoints": "8 8 3",
  "custom_options": { "expert_tip": "SMEAR 활성화 권장" }
}
```

---

## 11. SubmitJobResponse

**설명**: `POST /submit-job` 응답. 단일/다중구조에 따라 형태가 다릅니다. `directory`와 (다중 시) `sub_jobs.job_key`는 이후 `/job-live-status`·`/generate-report` 조회 키가 됩니다.

> **f5-report 경계**: `f5-report`는 `directory` 문자열만 소비합니다(`ReportRequest.job_dir`로 사용). `JobStatus`는 소비하지 않습니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'success'` 고정 |
| `directory` | `str` | ✅ | 단일 = job 폴더 basename, 다중 = parent `custom_name`. 다운로드/리포트 키. **f5가 `ReportRequest.job_dir`로 사용하는 유일한 f4 소비 필드** |
| `is_multi` | `bool` | ⬜ | 다중구조일 때만 `true` |
| `sub_jobs` | `List[{filename:str, job_key:str}]` | ⬜ | 다중구조일 때만. 각 하위작업의 라이브상태 조회 키 |
| `message` | `str` | ✅ | 사용자 표시 메시지 |

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`, `f5-report`

### 예시 (단일 구조)

```json
{
  "status": "success",
  "directory": "TiO2_geoopt_run",
  "message": "시뮬레이션 오케스트레이션이 시작되었습니다 (SGE 제출 중)"
}
```

### 예시 (다중 구조)

```json
{
  "status": "success",
  "is_multi": true,
  "directory": "MultiCompare_20260612_143022",
  "sub_jobs": [
    { "filename": "TiO2_anatase.cif", "job_key": "MultiCompare_20260612_143022_TiO2_anatase" },
    { "filename": "TiO2_rutile.cif",  "job_key": "MultiCompare_20260612_143022_TiO2_rutile" }
  ],
  "message": "총 2개의 구조에 대한 병렬 계산 제출이 시작되었습니다."
}
```

---

## 12. JobStatus

**설명**: 오케스트레이터가 `job_status.json`에 영속화하고 `get_job_status`가 반환하는 단일 작업 상태. `/job-live-status` 단일 응답 및 프런트 실시간 그래프/로그/진행률 소스입니다. `message`/`healing_history`/`logs`는 응답 직전 문자열화되며, `job_key`가 주입됩니다.

> ⚠️ **이 계약은 f4 내부와 프런트 실시간 모니터 전용입니다.** `f5-report`(app/features/report/service.py)는 `JobStatus`를 **전혀 소비하지 않습니다**(reporter import에 orchestrator 없음; `get_job_status`/`step_histories`/`active_step`/`healing_history`를 읽는 코드 없음).
>
> `job_key`는 `get_job_key()`가 `simulations/` 뒤 경로의 `/`를 `_`로 치환해 생성합니다(예: `jobname_Compound_2`).

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'Running'`(초기, 대문자 R), `'all_finished'`, `'Failed'`, `'aborted'`, `'Submission Failed: <stderr>'`, `'System Error: <e>'`, `'Unknown'`(미발견 시) |
| `active_step` | `int` | ✅ | 현재 진행 1-based 단계. 초기 `1` |
| `total_steps` | `int` | ✅ | 활성 단계 수(`len(steps)`) |
| `job_id` | `str \| null` | ✅ | SGE 작업 ID 또는 `None`/`'UNKNOWN'`. qsub stdout에서 정규식 `(\d+)`로 추출 |
| `lang` | `str` | ✅ | `'ko'` \| `'en'` |
| `message` | `str` | ✅ | 사용자 메시지(`msg_to_text`로 문자열화). DB 원본에서는 `dict`(`{'key':str,'params':{...}}`)일 수 있음 |
| `healing_history` | `List[str]` | ✅ | 자가치유 이력(문자열화) 예 `'[AI Fix] ...'` |
| `updated_at` | `str` | ✅ | `HH:MM:SS` |
| `logs` | `List[str]` | ✅ | 실시간 로그(최근 500줄 capping). DB 원본에서는 dict 형태 가능 |
| `logs_pos` | `int` | ⬜ | 로그 파일 읽기 바이트 오프셋(`f.tell()`) |
| `current_scf_step` | `int` | ⬜ | 현재 SCF 스텝(`len(scf_list)`) |
| `energy_history` | `List[float]` | ⬜ | 현재 SCF 사이클 에너지 이력 |
| `scf_history` | `List[float]` | ⬜ | SCF 수렴 이력 |
| `macro_energy_history` | `List[float]` | ⬜ | 매크로(GEO/CELL_OPT) 에너지 이력 |
| `macro_conv_history` | `List[float]` | ⬜ | 매크로 수렴(max gradient) 이력 |
| `scf_progress` | `float` | ⬜ | 0~99.9 SCF 진행률(`log(현재수렴)/log(target_eps)*100`) |
| `macro_progress` | `float` | ⬜ | 0~100 매크로 진행률(`count/max_geo*100`) |
| `tddft_progress` | `{step:int,conv:float,converged_states:int,total_states:int} \| null` | ⬜ | TDDFPT Davidson 반복 진행 |
| `expert_tip` | `str \| null` | ⬜ | submit 시 `custom_options.expert_tip` |
| `steps` | `List[`[`PlanStep`](#5-planstep)`]` | ✅ | 재인덱싱된 활성 단계 |
| `step_histories` | `Dict[str, `[`StepHistory`](#13-stephistory)`]` | ✅ | 단계ID(`str(step_idx)`) → 이력 매핑 |
| `suite_params` | `Dict[str,Any]` | ⬜ | 재제출/재개용 전 파라미터 스냅샷(`job_dir`,`steps`,`atom_info`,`lang`,DFT파라미터) |
| `job_key` | `str` | ✅ | `get_job_status` 반환 시 주입되는 조회 키(DB 원본엔 없음) |

> **런타임 추가 키** (`_submit_step` 성공 후 update로 채워짐): `step_start_time:float`, `full_options_cache:dict`, `max_scf:int`(기본 50), `max_geo:int`(기본 200), `retry_count:int`(0~3), `tddft_total_states:int|null`(기본 20), `progress_min:int`, `energy:float`, `current_max_grad:float`, `max_force:float`.

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`

### 예시

```json
{
  "status": "Running",
  "active_step": 1,
  "total_steps": 2,
  "job_id": "184523",
  "lang": "ko",
  "message": "Step 1/2 실행 중 (SCF 수렴 진행)",
  "healing_history": ["[AI Fix] Increased MAX_SCF to 100 due to slow convergence"],
  "updated_at": "14:32:07",
  "logs": ["Step 1: 구조 최적화 시작", "SCF cycle 12: convergence 3.2E-5"],
  "logs_pos": 40960,
  "current_scf_step": 12,
  "energy_history": [-245.3401, -245.3398, -245.3397],
  "scf_history": [1.2e-3, 4.5e-4, 3.2e-5],
  "macro_energy_history": [-245.3397],
  "macro_conv_history": [0.0021],
  "scf_progress": 84.6,
  "macro_progress": 0.5,
  "tddft_progress": null,
  "steps": [
    { "step_idx": 1, "step_name": "Step 1: 구조 최적화", "run_type": "GEO_OPT", "inp_options": ["MOTION/GEO_OPT/OPTIMIZER BFGS"] }
  ],
  "step_histories": {
    "1": { "run_type": "GEO_OPT", "energy": [-245.3401, -245.3398], "scf": [1.2e-3, 4.5e-4], "macro_energy": [-245.3397], "macro_conv": [0.0021] }
  },
  "suite_params": {
    "job_dir": "simulations/TiO2_geoopt_run",
    "lang": "ko",
    "cutoff": 600.0, "rel_cutoff": 60.0, "functional": "PBE", "basis_set": "DZVP-MOLOPT-GTH",
    "method": "GPW", "scf_algo": "OT", "charge": 0, "multiplicity": 1,
    "use_smear": true, "smear_temp": 300.0, "kpoints": "8 8 3"
  },
  "job_key": "TiO2_geoopt_run"
}
```

---

## 13. StepHistory

**설명**: `JobStatus.step_histories`의 각 단계 값(`step_histories[str(step_idx)]`). 단계별 그래프용 시계열입니다. 오케스트레이터 초기화 형태(`start_job_suite`)와 `/job-live-status` 동적복원 형태가 약간 다릅니다.

> **f4 내부 및 프런트 모니터 전용**(f5는 소비하지 않음).

| key | type | required | notes |
|-----|------|:--------:|-------|
| `run_type` | `str` | ✅ | 예 `'ENERGY'`,`'GEO_OPT'`. 비면 `GLOBAL/RUN_TYPE`(`full_options_cache`)로 보정 |
| `energy` | `List[float]` | ✅ | SCF 에너지 시퀀스(`eng_list`) |
| `scf` | `List[float]` | ✅ | SCF 수렴값 시퀀스(`scf_list`). 동적복원 시 energies 앞 20개 |
| `change` | `List[float]` | ⬜ | 변화량. **orchestrator 초기화에만**(`start_job_suite`) 존재. 일부 갱신 경로에서만 포함 |
| `macro_energy` | `List[float]` | ⬜ | 매크로(GEO/CELL_OPT) 에너지(`macro_eng`) |
| `macro_conv` | `List[float]` | ⬜ | 매크로 수렴(max gradient, `macro_conv`) |
| `property` | `str` | ⬜ | **동적복원 시에만** 타겟 물성 문자열 예 `'λ_max: ... nm'` / `'... eV'` / `'N/A'` |

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`

### 예시 (orchestrator 초기화 형태)

```json
{
  "run_type": "GEO_OPT",
  "energy": [],
  "scf": [],
  "change": [],
  "macro_energy": [],
  "macro_conv": []
}
```

### 예시 (동적복원 형태)

```json
{
  "run_type": "GEO_OPT",
  "energy": [-245.3401, -245.3398, -245.3397],
  "scf": [1.2e-3, 4.5e-4, 3.2e-5],
  "macro_energy": [-245.3397],
  "macro_conv": [0.0021],
  "property": "Max Force Grad: 0.0021"
}
```

---

## 14. MultiMetadata

**설명**: 다중구조 제출 시 parent `job_dir/multi_metadata.json`에 기록되는 메타데이터. `/job-live-status`가 다중작업을 집계하고 `/generate-report`가 비교 리포트를 트리거하는 핵심 신호입니다.

> **f5-report 경계**: `app/features/report/service.py`는 이 파일을 **디스크에서 직접 읽어**(`sub_jobs[].filename` / `sub_jobs[].job_key`) 다중 비교 분기를 결정합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `is_multi` | `bool` | ✅ | 항상 `true` |
| `parent_job_key` | `str` | ✅ | 부모 job 폴더명(`custom_name`) |
| `sub_jobs` | `List[{filename:str, job_key:str}]` | ✅ | 각 하위작업의 원본 파일명과 조회 키. reporter가 `filename`(safe_name 경로 해석/비교 키)과 `job_key`(폴백 경로)를 `.get`으로 읽음 |
| `property` | `str` | ✅ | 물성 타입 |
| `steps` | `List[`[`PlanStep`](#5-planstep)`]` | ✅ | 단계 목록 |
| `timestamp` | `str` | ✅ | `YYYYmmdd_HHMMSS` |

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`, `f5-report`

### 예시

```json
{
  "is_multi": true,
  "parent_job_key": "MultiCompare_20260612_143022",
  "sub_jobs": [
    { "filename": "TiO2_anatase.cif", "job_key": "MultiCompare_20260612_143022_TiO2_anatase" },
    { "filename": "TiO2_rutile.cif",  "job_key": "MultiCompare_20260612_143022_TiO2_rutile" }
  ],
  "property": "geo_opt",
  "steps": [
    { "step_name": "구조 최적화", "run_type": "GEO_OPT", "inp_options": ["MOTION/GEO_OPT/OPTIMIZER BFGS"] }
  ],
  "timestamp": "20260612_143022"
}
```

---

## 15. SimulationArtifacts

**설명**: `f4`(또는 `f6`)가 작업 실행 시 `simulations/{directory}/` 하위에 기록하는 **디스크 산출물 계약**. `f5-report`가 `JobStatus`가 아니라 실제로 의존하는 두 번째 f4 산출물입니다(첫째는 `MultiMetadata`).

> reporter.`generate_report_logic`은 `simulations/{job_dir}`를 `os.walk`로 훑어 `.out`/`.pdos`/`.bs` 파일을 정규식(`PHYSICS_PATTERNS`) + AI(`ai_semantic_extract`)로 파싱합니다. 이 계약은 **코드 객체가 아니라 디스크 파일 포맷 약속**입니다.

> ⚠️ **`*.out` 총에너지 라인 표기 규칙(정본)**: CP2K가 실제로 출력하는 라인은 `ENERGY| Total FORCE_EVAL ( QS ) energy [a.u.]:` 형태입니다(단위 표기 `[a.u.]`, 콜론 `:` 포함). 모든 목업/예시는 이 정본 표기를 따라야 합니다(`[hartree]`나 콜론 누락 표기를 쓰지 말 것). 단, `PHYSICS_PATTERNS`의 `total_energy` 정규식 `r'ENERGY\|\s+Total\s+FORCE_EVAL\s+.*?energy\s+.*?(-?\d+\.\d+)'`은 `[단위]`와 콜론을 `.*?`로 흡수하므로 실제 파싱 동작에는 영향을 주지 않습니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `*.out` | `file (text)` | ✅ | CP2K 표준 출력 로그. reporter가 `'ENERGY\| Total FORCE_EVAL ...'` 및 `PHYSICS_PATTERNS` 정규식으로 총에너지/12종 물성 추출. `-r-`/`BAND` 접두 `.out`은 단일 리포트 walk에서 제외 규칙 있음 |
| `*.pdos` | `file (text)` | ⬜ | dos/band 물성 시 보조. a.u. → eV(`×27.2114`) 변환, fermi/gap 파싱(`parse_pdos_file`). occupation > 0.1 점유/비점유 판별 |
| `*.bs` | `file (text)` | ⬜ | band structure. `'# Point N'` 분할로 HOMO-LUMO gap(eV) 계산(`parse_bs_file`) |
| `multi_metadata.json` | `file (json)` | ⬜ | 존재 시 다중 비교 분기 트리거([`MultiMetadata`](#14-multimetadata) 형태). 부재 시 단일 리포트 |

- **produced_by**: `f4-jobs`
- **consumed_by**: `f5-report`

### 예시 (디스크 레이아웃)

```
simulations/TiO2_geoopt_run/
├── step1_GEO_OPT/
│   ├── calculation.out          # *.out — 총에너지/물성 추출 소스
│   ├── CP2K_AGENT-pos-1.xyz
│   └── CP2K_AGENT-1.pdos        # *.pdos — fermi/gap
├── step2_ENERGY/
│   └── calculation.out
└── multi_metadata.json          # (다중 구조일 때만) 비교 분기 트리거
```

### 예시 (`*.out` 발췌 — reporter가 정규식으로 읽는 라인)

```
 ENERGY| Total FORCE_EVAL ( QS ) energy [a.u.]:             -245.339712458201
 HOMO - LUMO gap [eV] :                                        3.21
 OPT| Maximum gradient                                         0.0019800000
```

---

## 16. JobLiveStatusResponse

**설명**: `GET /job-live-status/{job_key}` 응답. `multi_metadata.json` 유무로 단일/다중이 갈립니다. 단일은 [`JobStatus`](#12-jobstatus) 형태(또는 파일시스템 동적복원), 다중은 하위작업 상태 집계입니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | 단일 = `JobStatus.status`, 다중 = `'Running'` \| `'Completed'` |
| `is_multi` | `bool` | ⬜ | 다중작업일 때만 `true` |
| `sub_jobs` | `List[{filename:str, job_key:str, status:str}]` | ⬜ | 다중일 때 하위작업별 상태. `status`는 `'Completed'`/`'Failed'`/`'Running'`으로 정규화 |
| `message` | `str` | ⬜ | 다중일 때 요약 메시지 |
| `step_histories` | `Dict[str, `[`StepHistory`](#13-stephistory)`]` | ⬜ | 단일 = 시계열 그래프 데이터, 다중 = `{}` 빈 dict |
| `job_key` | `str` | ⬜ | 단일 동적복원 시 포함 |

> 단일 작업 응답은 [`JobStatus`](#12-jobstatus)의 전체 키를 그대로 포함합니다(위 표는 단일/다중을 가르는 핵심 키만 명시).

- **produced_by**: `f4-jobs`
- **consumed_by**: `f4-jobs`

### 예시 (다중 집계)

```json
{
  "status": "Running",
  "is_multi": true,
  "sub_jobs": [
    { "filename": "TiO2_anatase.cif", "job_key": "MultiCompare_20260612_143022_TiO2_anatase", "status": "Completed" },
    { "filename": "TiO2_rutile.cif",  "job_key": "MultiCompare_20260612_143022_TiO2_rutile",  "status": "Running" }
  ],
  "message": "2개 구조 중 1개 완료, 1개 실행 중",
  "step_histories": {}
}
```

---

## 17. ReportRequest

**설명**: `POST /generate-report` 요청 본문. `job_dir`([`SubmitJobResponse.directory`](#11-submitjobresponse))와 물성/언어를 받아 리포트를 생성합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `job_dir` | `str` | ✅ | `simulations` 하위 작업 폴더명(`SubmitJobResponse.directory`) |
| `property` | `str` | ⬜ | 기본 `'geo_opt'`. 12종 물성 키 |
| `lang` | `str` | ⬜ | 기본 `'ko'`. `'en'`이면 영문 리포트 |

- **produced_by**: `f5-report`
- **consumed_by**: `f5-report`

### 예시

```json
{
  "job_dir": "TiO2_geoopt_run",
  "property": "geo_opt",
  "lang": "ko"
}
```

---

## 18. ReportData

**설명**: `POST /generate-report` 응답(`{status:'success', **report_data}`). 마크다운 리포트 본문과 요약. 단일/다중에 따라 `summary` 형태가 다릅니다.

> ⚠️ 디렉토리 없음/추출 데이터 없음 에러 시에는 `status`/`is_multi` 키가 **누락된 축약형**(`{report, summary:{}}`)을 반환합니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'success'`(정상/폴백). 에러 축약형에는 키 부재 |
| `report` | `str` | ✅ | 마크다운 리포트 본문(LLM 또는 폴백 템플릿) |
| `summary` | `Dict[str,Any]` | ✅ | 단일 = `{final_energy:str, target_property:str}`, 다중 = `{파일명:{energy:str, target_property:str}}`. 에러 시 `{}` |
| `is_multi` | `bool` | ⬜ | 다중구조 비교 리포트일 때만 `true` |

- **produced_by**: `f5-report`
- **consumed_by**: (없음 — 프런트엔드 최종 소비)

### 예시 (단일 구조)

```json
{
  "status": "success",
  "report": "# 시뮬레이션 결과 리포트\n\n## 1. 개요\n본 계산은 TiO2 아나타제 구조의 기하학적 최적화를 수행하였습니다...\n",
  "summary": {
    "final_energy": "-245.339712 au",
    "target_property": "Max Force Grad: 0.0019800"
  }
}
```

### 예시 (다중 구조 비교)

```json
{
  "status": "success",
  "is_multi": true,
  "report": "# 다중 구조 비교 리포트\n\n| 구조 | 에너지 (au) | 안정성 |\n|---|---|---|\n| anatase | -245.339712 | 안정 |\n| rutile | -245.341508 | 더 안정 |\n",
  "summary": {
    "TiO2_anatase.cif": { "energy": "-245.339712 au", "target_property": "Max Force Grad: 0.0019" },
    "TiO2_rutile.cif":  { "energy": "-245.341508 au", "target_property": "Max Force Grad: 0.0015" }
  }
}
```

### 예시 (에러 축약형)

```json
{
  "report": "시뮬레이션 디렉토리를 찾을 수 없습니다.",
  "summary": {}
}
```

---

## 19. BenchmarkRequest

**설명**: `POST /api/benchmark/run` 요청 본문(Pydantic). 벤치마크할 레벨 목록(`levels`)과 세션ID + DFT 파라미터.

> ⚠️ **특징**: `atom_info`/`steps`/`files`가 없고 `levels`가 필수인 점이 다른 요청 모델과 다릅니다(구조는 레벨별 공식 CIF에서 로드). `property`는 레벨별 `LEVEL_TO_PROPERTY` 매핑으로 덮어써집니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `levels` | `List[int]` | ✅ | 벤치마크할 레벨(1~12) 목록. 비면 1~12 전체 |
| `session_id` | `str \| null` | ⬜ | 기본 `None`. 세션 식별자 |
| `basis_set` | `str` | ✅ | 기저함수 세트 |
| `cutoff` | `float` | ✅ | cutoff (Ry) |
| `rel_cutoff` | `float` | ✅ | relative cutoff |
| `functional` | `str` | ✅ | XC functional |
| `method` | `str` | ⬜ | 기본 `'GPW'` |
| `scf_algo` | `str` | ⬜ | 기본 `'OT'` |
| `charge` | `int` | ⬜ | 기본 `0` |
| `multiplicity` | `int` | ⬜ | 기본 `1` |
| `use_smear` | `bool` | ⬜ | 기본 `False` |
| `smear_temp` | `float` | ⬜ | 기본 `300.0` |
| `property` | `str` | ⬜ | 기본 `'energy'`(레벨별 `LEVEL_TO_PROPERTY`로 덮어씀) |
| `custom_options` | `Dict[str,Any]` | ⬜ | 기본 `{}` |
| `eps_scf` | `str` | ⬜ | 기본 `'1.0E-6'` |
| `periodic` | `str` | ⬜ | 기본 `'XYZ'` |
| `max_scf` | `int \| null` | ⬜ | 기본 `None` |
| `ignore_scf_failure` | `bool` | ⬜ | 기본 `False` |
| `basis_file` | `str \| null` | ⬜ | 기본 `None` |
| `pot_file` | `str \| null` | ⬜ | 기본 `None` |
| `lsd` | `bool` | ⬜ | 기본 `False` |
| `added_mos` | `str \| null` | ⬜ | 기본 `None` |

> **`LEVEL_TO_PROPERTY` 매핑** (프런트 UI 순서와 1:1):
> `1 geo_opt`, `2 energy`, `3 dos`, `4 band`, `5 aimd`, `6 vibrational`, `7 neb`, `8 adsorption`, `9 absorption`, `10 emission`, `11 work_function`, `12 hirshfeld`

- **produced_by**: `f6-benchmark`
- **consumed_by**: `f6-benchmark`

### 예시

```json
{
  "levels": [1, 2, 3],
  "session_id": "bench_20260612_001",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE",
  "method": "GPW",
  "scf_algo": "OT",
  "use_smear": false,
  "property": "energy",
  "custom_options": {}
}
```

---

## 20. BenchmarkReport

**설명**: 벤치마크 전역 진행상태(`benchmark_manager.results`). `GET /api/benchmark/status` 응답이며 `/api/benchmark/run`에서 상태 점유에 사용됩니다. 프런트 실시간 폴링 소스입니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `status` | `str` | ✅ | `'Idle'`(초기), `'Running'`, `'Finished'`(종료 시 finally), `'Failure'`(루프 치명 오류) |
| `current_level` | `int` | ✅ | 현재 레벨(0=시작 전, 1~12) |
| `total_levels` | `int` | ✅ | `12` 고정 |
| `reports` | `List[`[`BenchmarkLevelReport`](#21-benchmarklevelreport)`]` | ✅ | 레벨별 결과 12슬롯. `reports[level-1]`에 저장 |
| `logs` | `List[str]` | ✅ | 실시간 로그(한국어/이모지 라인) |
| `logs_pos` | `int` | ⬜ | `calculation.out` 실시간 펌프용 seek 오프셋. 단계 전환 시 `0`으로 리셋 |

- **produced_by**: `f6-benchmark`
- **consumed_by**: (없음 — 프런트엔드 폴링 소비)

### 예시

```json
{
  "status": "Running",
  "current_level": 2,
  "total_levels": 12,
  "reports": [
    { "level": 1, "status": "SUCCESS", "agent_energy": -17.1502, "official_energy": -17.1498, "diff": 0.0023, "message": "[Energy (Ha)] Error: 0.0023%", "healing_count": 0 },
    { "level": 2, "status": "Running", "agent_energy": null, "official_energy": null, "diff": null, "message": "계산 진행 중...", "healing_count": 0 }
  ],
  "logs": ["✅ Level 1 (geo_opt) 통과 (오차 0.0023%)", "▶️ Level 2 (energy) 시작"],
  "logs_pos": 8192
}
```

---

## 21. BenchmarkLevelReport

**설명**: `BenchmarkReport.reports[]` 요소. 에이전트 vs 공식 결과 정확도 비교. 레벨 → 물성 매핑(`1 geo_opt` … `12 hirshfeld`)을 따릅니다.

| key | type | required | notes |
|-----|------|:--------:|-------|
| `level` | `int` | ✅ | 1~12 |
| `status` | `str` | ✅ | `'Pending'`, `'Running'`, `'Recovering...'`, `'SUCCESS'`, `'INCORRECT'`, `'FAILURE'`, `'Skipped'` |
| `agent_energy` | `float \| null` | ✅ | 에이전트 계산 에너지/물성치(레벨별 의미 다름) |
| `official_energy` | `float \| null` | ✅ | 공식 기준 에너지/물성치 |
| `diff` | `float \| null` | ✅ | 상대 오차(%) = `abs((agent-official)/denom)*100` |
| `message` | `str` | ✅ | 상태/사유 메시지(한국어) 예 `'[Energy (Ha)] Error: 0.1234% (Healed 1x via SCF_NOT_CONVERGED)'` |
| `healing_count` | `int` | ⬜ | 자가치유 횟수. 초기 슬롯에만 `0` 명시, 실행 중 새 dict에는 키 미포함(`get`으로 0 폴백) |
| `last_diag` | `str` | ⬜ | 마지막 적용 진단 id(재시도 시 추가). **진단 id는 대문자 스네이크케이스로 통일**(예: `'SCF_NOT_CONVERGED'`). self_healing `diagnose`가 반환하는 `diag_id` 포맷과 일치하며, `message`의 `Healed Nx via ...` 문구에도 동일 id를 사용 |

- **produced_by**: `f6-benchmark`
- **consumed_by**: (없음 — `BenchmarkReport`에 중첩되어 프런트엔드 소비)

### 예시

```json
{
  "level": 9,
  "status": "SUCCESS",
  "agent_energy": 3.85,
  "official_energy": 3.82,
  "diff": 0.7853,
  "message": "[Excitation (eV)] Error: 0.7853% (Healed 1x via SCF_NOT_CONVERGED)",
  "healing_count": 1,
  "last_diag": "SCF_NOT_CONVERGED"
}
```

---

## 부록: 교차 참조 요약

| 계약 | 생산 | 소비 |
|------|------|------|
| `AtomInfo` | f1 | f2, f3, f4, f6 |
| `AnalyzeCifResponse` | f1 | (프런트) |
| `KpointCacheUpdate` | f1 | f1 |
| `PlanRequest` | f2 | f2 |
| `PlanStep` | f2 | f3, f4, f6 |
| `PlanResult` | f2 | f6 |
| `InpRequest` | f3 | f3 |
| `GeneratedFile` | f3 | f4, f6 |
| `GenerateInpResult` | f3 | f4 |
| `SubmitRequest` | f4 | f4 |
| `SubmitJobResponse` | f4 | f4, **f5(directory만)** |
| `JobStatus` | f4 | f4 (**f5 미소비**) |
| `StepHistory` | f4 | f4 (**f5 미소비**) |
| `MultiMetadata` | f4 | f4, **f5(디스크 직접 읽기)** |
| `SimulationArtifacts` | f4 | **f5(디스크 직접 읽기)** |
| `JobLiveStatusResponse` | f4 | f4 |
| `ReportRequest` | f5 | f5 |
| `ReportData` | f5 | (프런트) |
| `BenchmarkRequest` | f6 | f6 |
| `BenchmarkReport` | f6 | (프런트) |
| `BenchmarkLevelReport` | f6 | (`BenchmarkReport` 중첩) |