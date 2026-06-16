# 정확도 벤치마크 엔진 / Accuracy Benchmark Engine (f6-benchmark)

## 구현 위치 (폴더 구조)

이 기능은 `app/features/benchmark/` 아래에 도메인별로 구현된다: HTTP 표면(엔드포인트 핸들러)은 `router.py`, 벤치마크 오케스트레이션 로직(`BenchmarkManager` 등)은 `service.py`, 기능 전용 요청 모델은 `schemas.py`에 둔다. cross-feature 모델(`AtomInfo`/`PlanStep`/`GeneratedFile`/`JobStatus` 등)은 `app/schemas/common.py`에, 자가치유·물리 규칙·옵션 병합 같은 공유 엔진은 `app/shared/*`에 위치한다.

> **한 줄 책임:** `test/level1~12`의 공식 CIF/INP를 진실값(ground truth)으로 삼아 **CIF 분석 → AI 플랜 → INP 빌드 → SGE(qsub) 또는 로컬 실행 → 자가치유 재시도(최대 3회) → 공식 결과 대비 에너지/물성 오차 비교**를 12단계로 자동 수행하고, 실시간 진행상태와 레벨별 정확도 리포트를 제공한다.

| 항목 | 내용 |
| --- | --- |
| **담당 모듈** | `app/features/benchmark/service.py` (클래스 `BenchmarkManager`, 전역 싱글톤 `benchmark_manager`) |
| **소유 범위** | `BenchmarkManager` 클래스 전체, 전역 진행상태 객체 `benchmark_manager.results`, 두 엔드포인트 핸들러(`app/features/benchmark/router.py`), `test/level{N}/` 공식 데이터 읽기 로직, `simulations/benchmark_{timestamp}/` 산출물 쓰기 로직 |
| **소유하지 않음(외부 위임)** | AI 플랜 생성(`app/features/plan/service.py`), INP 렌더링(`app/features/inp/service.py`의 `build_full_inp`), 자가치유 진단/처방(`app/shared/self_healing.py`), SGE 템플릿(`app/core/sge.py`의 `SGE_TEMPLATE`), CIF 파싱(`app/features/structure/service.py`) — 본 기능은 **오케스트레이션만** 담당하며 물리 로직은 모두 공유 모듈에 위임한다. |
| **계약 기준** | clean (깔끔한 목표 설계). 현재 코드의 캡슐화 위반/중복 변수 등은 "현 구현 주의" 박스로 분리 표기. |

> 데이터 계약 상세 정의는 `data-models.md`를 단일 진실 소스(SSOT)로 한다. 본 문서는 이 기능의 **HTTP 표면**과 **계약 연결 관계**만 정의한다.

---

## HTTP API 명세

엔드포인트는 단 2개다. **실행 트리거(run)는 즉시 반환(fire-and-forget)** 하고, 실제 진행은 백그라운드 태스크로 돈다. 프런트엔드는 **status를 폴링**하여 UI를 그린다.

### 1. `POST /api/benchmark/run`

벤치마크 루프를 백그라운드로 기동한다. 이미 실행 중이면 점유를 거절한다.

**요청 본문** — `BenchmarkRequest` 계약 (Pydantic). `atom_info`/`steps`/`files`가 **없고** `levels`가 핵심인 점이 다른 요청 모델과 구분된다.

| 필드명 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `levels` | `List[int]` | ✅ | 벤치마크할 레벨(1~12) 목록. **빈 리스트면 1~12 전체 순회**. |
| `session_id` | `str \| null` | ❌ | 기본 `null`. 세션 식별자(추적용, 현 로직 미사용). |
| `basis_set` | `str` | ✅ | 기저함수 세트. 단, 공식 INP에서 추출된 값이 있으면 그쪽이 우선(SSOT). |
| `cutoff` | `float` | ✅ | 평면파 cutoff (Ry). 공식 INP 추출값 우선. |
| `rel_cutoff` | `float` | ✅ | relative cutoff. 공식 INP 추출값 우선. |
| `functional` | `str` | ✅ | XC functional 예 `'PBE'`. 공식 INP 추출값 우선. |
| `method` | `str` | ❌ | 기본 `'GPW'`. |
| `scf_algo` | `str` | ❌ | 기본 `'OT'`. |
| `charge` | `int` | ❌ | 기본 `0`. |
| `multiplicity` | `int` | ❌ | 기본 `1`. |
| `use_smear` | `bool` | ❌ | 기본 `false`. |
| `smear_temp` | `float` | ❌ | 기본 `300.0`. |
| `property` | `str` | ❌ | 기본 `'energy'`. **레벨별 `LEVEL_TO_PROPERTY`로 덮어쓰임**(요청값은 매핑에 없는 레벨에 대한 폴백). |
| `custom_options` | `Dict[str,Any]` | ❌ | 기본 `{}`. 리스트로 와도 `parse_path_based_options`로 dict 변환(방어 처리). |
| `eps_scf` | `str` | ❌ | 기본 `'1.0E-6'`. |
| `max_scf` | `int \| null` | ❌ | 기본 `null`. |
| `ignore_scf_failure` | `bool` | ❌ | 기본 `false`. |
| `basis_file` | `str \| null` | ❌ | 기본 `null`. 공식 INP의 `BASIS_SET_FILE_NAME` 우선. |
| `pot_file` | `str \| null` | ❌ | 기본 `null`. 공식 INP의 `POTENTIAL_FILE_NAME` 우선. |
| `lsd` | `bool` | ❌ | 기본 `false`. |
| `added_mos` | `str \| null` | ❌ | 기본 `null`. |
| `periodic` | `str` | ❌ | 기본 `'XYZ'`. 공식 INP 추출값 우선. |

**응답 JSON 스키마**

```jsonc
{
  "status": "string",   // "success" | "error"
  "message": "string"   // 사용자 표시 메시지(한국어)
}
```

**상태코드/에러**

| 상황 | HTTP | 응답 |
| --- | --- | --- |
| 정상 기동 | `200` | `{"status":"success","message":"벤치마크 루프가 기동되었습니다."}` |
| 이미 실행 중 | `200` | `{"status":"error","message":"이미 벤치마크가 진행 중입니다."}` (HTTP는 200이지만 `status="error"`로 거절 — **소비자는 본문의 `status`를 반드시 확인**) |
| 요청 본문 검증 실패 | `422` | `{"detail":[...]}` (FastAPI `RequestValidationError`) |
| 내부 예외 | `500` | `{"detail":"..."}` (백그라운드 진입 전 예외 시) |

> **동시성:** 실행 중복은 두 겹으로 막힌다. (1) 핸들러가 `results["status"] == "Running"`이면 즉시 거절, (2) `run_benchmark` 진입 시 `asyncio.Lock`을 잡는다. 따라서 run은 **멱등이 아니며**, 진행 중 재호출은 무시된다.

**요청 예시**

```json
{
  "levels": [1, 2, 3],
  "session_id": "hackathon-demo-01",
  "basis_set": "DZVP-MOLOPT-GTH",
  "cutoff": 400.0,
  "rel_cutoff": 50.0,
  "functional": "PBE",
  "scf_algo": "OT",
  "charge": 0,
  "multiplicity": 1
}
```

**응답 예시**

```json
{
  "status": "success",
  "message": "벤치마크 루프가 기동되었습니다."
}
```

---

### 2. `GET /api/benchmark/status`

진행상태 전체를 그대로 반환한다(`benchmark_manager.results`의 직접 직렬화). **프런트엔드 실시간 폴링 소스.** 권장 폴링 주기 2~3초.

**요청 본문:** 없음(쿼리/경로 파라미터 없음).

**응답 JSON 스키마** — `BenchmarkReport` 계약

```jsonc
{
  "status": "string",        // "Idle" | "Running" | "Finished" | "Failure"
  "current_level": 0,        // int, 0=시작 전, 1~12=처리 중
  "total_levels": 12,        // int, 고정 12
  "reports": [               // List[BenchmarkLevelReport], 항상 12 슬롯(인덱스 = level-1)
    {
      "level": 1,                  // int 1~12
      "status": "string",          // "Pending"|"Running"|"Recovering..."|"SUCCESS"|"INCORRECT"|"FAILURE"|"Skipped"
      "agent_energy": 0.0,         // float | null  (에이전트 계산 에너지/물성치)
      "official_energy": 0.0,      // float | null  (공식 기준 에너지/물성치)
      "diff": 0.0,                 // float | null  (상대 오차 %)
      "message": "string",         // 상태/사유 메시지(한국어/영문 혼용)
      "healing_count": 0,          // int (선택, .get으로 0 폴백)
      "last_diag": "string"        // str (선택, 마지막 적용 진단 id)
    }
  ],
  "logs": ["string"],        // List[str], 실시간 로그(한국어/이모지)
  "logs_pos": 0              // int (선택, 내부 파일 seek 오프셋 — 프런트는 무시 가능)
}
```

> **레벨↔물성 매핑(`LEVEL_TO_PROPERTY`)** — 프런트 UI 순서와 1:1. **물성 키는 f5-report의 지원 물성 12종 집합과 동일하다**(SSOT 일치: f6 벤치마크 산출물을 f5 리포트로 분석 가능).
> `1 geo_opt`, `2 energy`, `3 dos`, `4 band`, `5 aimd`, `6 vibrational`, `7 neb`, `8 adsorption`, `9 absorption`, `10 emission`, `11 work_function`, `12 bader`

**`status` (전역) 라이프사이클**

| 값 | 의미 |
| --- | --- |
| `Idle` | 초기 상태(서버 기동 직후). |
| `Running` | run 핸들러가 점유 직후 ~ 루프 종료 전. |
| `Finished` | 루프가 `finally`에서 정상/비정상 무관하게 종료 시 세팅(최종 안착값). |
| `Failure` | 루프 레벨에서 치명적 예외 발생 시 일시 세팅(직후 `finally`에서 `Finished`로 덮임 — **clean 재설계에서는 `Failure`를 보존하도록 finally 분기 권장**). |

**레벨별 `status`(reports[i].status)**

| 값 | 의미 |
| --- | --- |
| `Pending` | 슬롯 초기화 직후, 미착수. |
| `Running` | 계산/수렴 감시 중. |
| `Recovering...` | 자가치유 재시도 진행 중. |
| `SUCCESS` | 오차율 1.0% 미만 **또는** (에너지 비교 시) 에이전트 결과가 더 안정적(더 낮음). |
| `INCORRECT` | 계산은 끝났으나 오차율 1.0% 이상이며 더 안정적이지도 않음. |
| `FAILURE` | 자가치유 실패/타임아웃/수치 추출 실패/런타임 예외. |
| `Skipped` | 해당 레벨 `L{N}_Official.cif` 부재로 건너뜀. |

**응답 예시 (실행 중)**

```json
{
  "status": "Running",
  "current_level": 3,
  "total_levels": 12,
  "reports": [
    {
      "level": 1, "status": "SUCCESS",
      "agent_energy": -1029.4521, "official_energy": -1029.4498,
      "diff": 0.0002, "message": "[Energy (Ha)] Error: 0.0002%",
      "healing_count": 0
    },
    {
      "level": 2, "status": "SUCCESS",
      "agent_energy": -17.1893, "official_energy": -17.2011,
      "diff": 0.0686, "message": "[Energy (Ha)] Error: 0.0686% (Healed 1x via SCF_NOT_CONVERGED)",
      "healing_count": 1, "last_diag": "SCF_NOT_CONVERGED"
    },
    {
      "level": 3, "status": "Running",
      "agent_energy": null, "official_energy": null,
      "diff": null, "message": "계산 및 수렴 감시 중...", "healing_count": 0
    },
    {
      "level": 4, "status": "Pending",
      "agent_energy": null, "official_energy": null,
      "diff": null, "message": "대기 중...", "healing_count": 0
    }
  ],
  "logs": [
    "🚀 [BENCHMARK] Starting Level 3 / 12",
    "🚀 Step 3 JOB 28471 계산 시작!"
  ],
  "logs_pos": 10342
}
```

**상태코드/에러**

| 상황 | HTTP | 비고 |
| --- | --- | --- |
| 항상 | `200` | run 전이라도 `Idle` 슬롯 형태로 정상 반환. 에러 분기 없음. |

---

## 생산하는 데이터 계약

이 기능이 **내보내는** 구조. 소비자(프런트엔드 벤치마크 대시보드)는 아래 계약에만 의존해야 한다.

| 계약 이름 (→ `data-models.md`) | 노출 경로 | 소비자 | 비고 |
| --- | --- | --- | --- |
| **`BenchmarkRequest`** | `POST /api/benchmark/run` 요청 본문 | f6-benchmark(자체) | run의 입력 스키마. `produced_by: f6-benchmark`. |
| **`BenchmarkReport`** | `GET /api/benchmark/status` 응답 = `benchmark_manager.results` | 프런트엔드 폴링 UI | 전역 진행상태 객체. |
| **`BenchmarkLevelReport`** | `BenchmarkReport.reports[]` 요소 | 프런트엔드 레벨 카드/테이블 | 에이전트 vs 공식 정확도 비교 단위. |

**디스크 산출물(코드 객체가 아닌 파일 포맷 약속):** 본 기능은 실행 중 아래를 기록한다. 리포트 기능(f5)이 동일 포맷을 소비할 수 있으나, **벤치마크 경로는 자체 비교 로직(`_extract_energy`/`_extract_target_property`)으로 자급자족**한다.

```
<root>/simulations/benchmark_{YYYYmmdd_HHMMSS}/
├── level{N}/
│   ├── calculation.inp          # build_full_inp 렌더 결과
│   ├── run.sh                    # SGE_TEMPLATE.format(...) 결과 (chmod 0o755)
│   ├── calculation.out          # CP2K 표준 출력(폴링 대상, 에너지/물성 추출 소스)
│   └── (test/level{N} 공식 참조 파일 복사본 — *.out/*.log는 제출 전 정제 제거)
└── level{N}_retry_{n}/          # 자가치유 재시도 1~3회차 디렉토리
    ├── calculation.inp
    ├── run.sh
    └── calculation.out
```

---

## 소비하는 데이터 계약

이 기능이 **필요로 하는** 상위 기능의 출력. 상위 기능이 미완성이어도 아래 **목업 JSON으로 단독 개발을 시작**할 수 있다.

> ⚠️ 본 기능은 HTTP가 아니라 **공유 모듈 함수 호출**로 상위 출력을 받는다. 따라서 "목업"은 해당 함수를 **stub 함수로 대체**하는 형태가 된다(하단 [병렬 개발 가이드](#병렬-개발-가이드) 참고).

### (1) `AtomInfo` ← f1-structure

`app/features/structure/service.py`의 `analyze_cif_structure(cif_bytes, filename)` 반환값. `plan_req.atom_info`, `mandatory.atom_info`, `build_full_inp`의 두 번째 인자, AI 치유 메타로 흐른다. **세 가지 형태(정상/parse-failure 폴백/empty-CIF 폴백)**가 있으므로 선택적 키는 반드시 `.get`으로 읽을 것.

**목업 예시 (정상 경로 — 단원자 결정 가정)**

```json
{
  "filename": "L1_Official.cif",
  "atom_count": 2,
  "atoms": [
    {"element": "Si", "x": 0.0, "y": 0.0, "z": 0.0},
    {"element": "Si", "x": 1.3575, "y": 1.3575, "z": 1.3575}
  ],
  "elements": ["Si"],
  "element_counts": {"Si": 2},
  "element_indices": {"Si": [1, 2]},
  "cell": [5.43, 5.43, 5.43],
  "cell_angles": [90.0, 90.0, 90.0],
  "volume": 160.10,
  "full_coord_text": "      Si   0.00000000   0.00000000   0.00000000\n      Si   1.35750000   1.35750000   1.35750000",
  "full_cell_text": "      ABC 5.43 5.43 5.43\n      ALPHA_BETA_GAMMA 90.0 90.0 90.0",
  "use_scaled": false,
  "smear_recommended": false
}
```

> **방어 체크 필수:** `atom_count == 0` 및 `error` 키 유무로 폴백 형태를 판별. `cell_angles`/`volume`/`element_indices`/`smear_recommended` 등은 폴백에서 **부재**할 수 있으니 `.get(key, default)`로 접근. centering 로직은 `a['x'],a['y'],a['z'],a['element']`와 `cell`을 사용한다.

### (2) `PlanResult` ← f2-plan

`app/features/plan/service.py`의 `generate_plan_logic(plan_req)`의 비동기 반환값. **본 기능은 `steps`만 사용**하며(`expert_tip` 미사용, `atom_info`는 에코), 모든 step의 `inp_options`를 `app/shared/options.py`의 `deep_merge`로 통합해 가상 `final_step`을 만든다. AI JSON 파싱 실패 시 `steps=[]` 폴백 → 본 기능은 `ValueError("No valid simulation options ...")`로 해당 레벨을 FAILURE 처리.

**목업 예시**

```json
{
  "expert_tip": "Si 결정은 OT/DIIS와 적절한 cutoff로 안정적으로 수렴합니다. (벤치마크 미사용)",
  "steps": [
    {
      "step_name": "Geometry Optimization",
      "run_type": "GEO_OPT",
      "inp_options": {
        "FORCE_EVAL": {
          "DFT": {
            "MGRID": {"CUTOFF": 400, "REL_CUTOFF": 50},
            "SCF": {"EPS_SCF": "1.0E-6", "MAX_SCF": 50}
          }
        },
        "MOTION": {"GEO_OPT": {"OPTIMIZER": "BFGS", "MAX_ITER": 200}}
      },
      "exclude": false
    },
    {
      "step_name": "Final Single Point",
      "run_type": "ENERGY",
      "inp_options": ["FORCE_EVAL/DFT/SCF/SCF_GUESS RESTART"],
      "exclude": false
    }
  ],
  "atom_info": { "...": "요청 atom_info 그대로 에코 (SSOT)" }
}
```

> `inp_options`가 `List[str]`(경로 기반)이면 `app/shared/options.py`의 `parse_path_based_options`로 dict 변환 후 병합한다. `exclude: true`인 step은 통합에서 제외. `step.get(...)`으로 방어적으로 읽을 것.

### (3) `GeneratedFile` ← f3-inp

표준 계약상 `f3-inp`가 생산하나, **벤치마크 경로는 `/generate-inp`를 호출하지 않고 `app/features/inp/service.py`의 `build_full_inp`를 직접 호출**하여 `.inp` 텍스트를 자체 렌더링한다(즉 `GeneratedFile`의 `content` 필드와 **동일 포맷**의 문자열을 인-프로세스로 생성). 따라서 소비 형태는 "함수 반환 문자열"이다.

**목업 예시 (`build_full_inp` 반환 문자열 형태 = `GeneratedFile.content`)**

```json
{
  "filename": "calculation.inp",
  "content": "&GLOBAL\n  PROJECT calculation\n  RUN_TYPE GEO_OPT\n&END GLOBAL\n&FORCE_EVAL\n  METHOD QUICKSTEP\n  &DFT\n    &MGRID\n      CUTOFF 400\n      REL_CUTOFF 50\n    &END MGRID\n    &SCF\n      EPS_SCF 1.0E-6\n      MAX_SCF 50\n    &END SCF\n  &END DFT\n&END FORCE_EVAL\n"
}
```

> 벤치마크는 이 문자열을 `<job_dir>/calculation.inp`로 직접 기록한다. f3의 HTTP 응답(`GenerateInpResult.generated_files[]`)을 소비하지 않는다.

---

## 내부·공유 의존성

본 기능은 물리 로직을 직접 구현하지 않고 아래 공유 모듈을 **함수/싱글톤 호출**로 조립한다.

### `app/features/plan/service.py` · `app/features/inp/service.py` · `app/shared/options.py` (AI 플랜 · INP 빌드)

| 심볼 | 호출 방식 | 용도 |
| --- | --- | --- |
| `generate_plan_logic(plan_req)` (`app/features/plan/service.py`) | `await` (async) | `PlanRequest`로 AI 플랜 생성 → `PlanResult` 반환. `steps`만 사용. |
| `build_full_inp(options, atom_info, step_idx, all_steps=[final_step], run_type, force_sync, cutoff, ..., prop, ...)` (`app/features/inp/service.py`) | 동기 | 검증된 옵션 dict + atom_info를 CP2K `.inp` 텍스트로 렌더. `all_steps`엔 통합 `final_step` 하나만 전달. |
| `parse_path_based_options(paths: List[str])` (`app/shared/options.py`) | 동기 | 경로 리스트(`"A/B/KEY VAL"`)를 중첩 dict로 변환. |
| `deep_merge(base, overlay)` (`app/shared/options.py`) | 동기 | 중첩 dict 병합(계층 보존). 모든 step 옵션 통합 및 공식 INP + AI 플랜 오버레이에 사용. |
| `PHYSICS_PATTERNS` (`app/shared/physics_patterns.py`) | (간접) | 에너지/물성 정규식. 벤치마크는 자체 정규식을 우선 사용하나 일부 폴백에서 참조 가능. |

### `app/features/structure/service.py` (CIF 파싱)

| 심볼 | 호출 방식 | 용도 |
| --- | --- | --- |
| `analyze_cif_structure(cif_bytes: bytes, filename: str)` | 동기 | 공식 CIF 바이트를 `AtomInfo` dict로 변환. |

### `app/shared/self_healing.py` (자가치유 엔진 — 싱글톤 `healing_engine`)

| 메서드 | 시그니처(요지) | 용도 |
| --- | --- | --- |
| `validate_and_correct(options, mandatory_params)` | `→ (options, logs)` | SSOT 강제(`force_sync=True`) + 스키마 검증/교정. 최초 빌드 전 + 재시도 병합 후 호출. |
| `diagnose(out_content)` | `→ (diag_id, match_groups, msg)` | 규칙 기반 실패 진단. |
| `heal(options, diag_id, match_groups, retry_count)` | `→ (options, logs)` | 규칙 기반 처방(AI 실패 시 백업). |
| `heal_with_ai(options, out_content, retry_count, failure_history, ai_meta)` | `await → (options, ai_logs, ai_reason)` | **AI-FIRST** 처방. 규칙보다 우선 호출. `ai_meta`엔 `mode:"BENCHMARK"`, `property`, `force_sync:True` 주입. |
| `record_success()` | `→ None` | AI 처방으로 성공 시 지식베이스 영속화. |

### `app/core/sge.py`

| 심볼 | 호출 방식 | 용도 |
| --- | --- | --- |
| `SGE_TEMPLATE` | `.format(job_name=..., inp_filename="calculation.inp", out_filename="calculation.out")` | qsub용 `run.sh` 템플릿 문자열. **본 기능은 `app/features/jobs/service.py`의 `start_job_suite`를 쓰지 않고 직접 qsub/로컬 실행한다.** |

### `app/schemas/common.py` · `app/features/benchmark/schemas.py`

| 심볼 | 용도 |
| --- | --- |
| `BenchmarkRequest` (`app/features/benchmark/schemas.py`) | `run_benchmark(req)`의 입력 타입(run 핸들러가 주입). |
| `PlanRequest` (`app/schemas/common.py`) | `plan_req` 구성용. 공식 INP 추출 파라미터 + 레벨별 물성을 채워 `generate_plan_logic`에 전달. `property` 필드엔 물성명 + Reference Hint(JSON) + 통합 지침이 합성됨. |

### `app/main.py` (호스트)

- `app/features/benchmark/service.py`의 전역 싱글톤 `benchmark_manager`를 import.
- `run` 핸들러: `benchmark_manager.results["status"] == "Running"` 점검 → `results["status"]="Running"` 점유 → `background_tasks.add_task(benchmark_manager.run_benchmark, req)`.
- `status` 핸들러: `return benchmark_manager.results` (직접 직렬화).

---

## 외부 의존성

| 의존성 | 형태 | 비고 |
| --- | --- | --- |
| **Anthropic Claude API** | 간접 | `generate_plan_logic` 및 `healing_engine.heal_with_ai`가 `app/core/llm.py`의 클라이언트를 통해서만 호출. 본 모듈은 직접 호출하지 않음. 로그상 모델 `Claude-Sonnet-4-6`. |
| **환경변수 `CLAUDE_API_KEY`** | 필수 | `app/features/plan/service.py`/`app/shared/self_healing.py`(공통적으로 `app/core/llm.py` 경유)가 `os.getenv`로 사용. `.env`에 보관(값은 절대 커밋/문서화 금지). 미설정 시 플랜/치유 단계에서 실패. |
| **환경변수 `ANTHROPIC_MODEL`** | 선택 | 모델 ID 오버라이드(미설정 시 코드 기본값). |
| **환경변수 `APP_HOST` / `APP_PORT`** | 선택 | 서버 바인딩(기본 `0.0.0.0:8000`). |
| **SGE / `qsub` · `qstat`** | 필수(권장) | `subprocess.run(["qsub","run.sh"])`로 제출, `subprocess.run(["qstat"])`로 생존 확인. PATH에 두 바이너리 필요. |
| **로컬 폴백 실행 `cp2k.popt`** | 폴백 | qsub 실패/부재(`FileNotFoundError`) 시 `nohup cp2k.popt -i calculation.inp > calculation.out 2>&1 & echo $!`. **Unix `nohup`/셸 가정 → Windows 미지원.** PATH에 `cp2k.popt` 필요. |
| **파일시스템 — 입력** | 필수 | `<root>/test/level{N}/L{N}_Official.cif` 및 `*Official*.inp`, 공식 결과 `*.out`/`*.o2551`/`*.ener`/`*.bader`/`-r-0.out`. `<root>` = 모듈 상위의 상위 디렉토리. |
| **파일시스템 — 출력** | 필수 | `<root>/simulations/benchmark_{YYYYmmdd_HHMMSS}/level{N}/` 및 `level{N}_retry_{n}/`. |
| **`os.chmod(run.sh, 0o755)`** | POSIX | Windows에서는 무의미(무시됨). |
| **SGE_TEMPLATE 내장 환경** | 클러스터 고정 | 큐 `gp3`, PE `16cpu 16`, `CP2K_ROOT=/share/cp2k-2026.1_mkl`, `CP2K_DATA_DIR=/share/cp2k-2026.1_mkl/data`, venv `/DATA/lab07/hglee/cp2k_agent/venv`, Intel oneAPI `setvars.sh` (정의 위치: `app/core/sge.py`). |
| **타임아웃** | 고정 | 폴링 최대 **300회 × 5초 ≈ 25분**/레벨. `qstat` 미발견 유예 **6회(30초)**. |

---

## 병렬 개발 가이드

해커톤 팀원 한 명이 **이 기능을 풀스택으로 단독 개발**하기 위한 목업 전략과 완료 정의.

### 무엇을 목업하면 단독 개발 가능한가

본 기능의 진짜 의존은 **HTTP가 아니라 공유 모듈 함수**다. 따라서 함수 4개를 stub으로 대체하면 상위 기능(f1/f2/f3) 미완성 상태에서도 전 구간을 돌릴 수 있다.

1. **`app/features/structure/service.py`의 `analyze_cif_structure` → stub.** 소비 (1) `AtomInfo` 목업을 그대로 반환. CIF 실제 파싱 없이도 파이프라인 진입 가능.
2. **`app/features/plan/service.py`의 `generate_plan_logic` → async stub.** 소비 (2) `PlanResult` 목업을 반환. AI/네트워크/`CLAUDE_API_KEY` 없이 개발 가능.
3. **`app/features/inp/service.py`의 `build_full_inp` → stub.** 소비 (3)의 `content` 같은 고정 `.inp` 문자열 반환. CP2K 스키마 지식 없이도 빌드 단계 통과.
4. **`app/shared/self_healing.py`의 `healing_engine` → stub 싱글톤.** `validate_and_correct` 는 `(options, [])`, `diagnose` 는 `(None, {}, "")`, `heal_with_ai` 는 `(None, [], "")`(= 치유 없음 → 첫 실패 시 즉시 종료) 또는 의도적으로 `(options, ["mock heal"], "mock")` 반환으로 재시도 경로 테스트.

**실행 인프라 목업(클러스터 없이):**

- `qsub` 부재 시 자동으로 로컬 `cp2k.popt` 폴백을 타므로, **`cp2k.popt`를 가짜 스크립트로 대체**한다. 입력 `calculation.inp`를 읽어 `calculation.out`에 `ENERGY| Total FORCE_EVAL ( QS ) energy [hartree] -123.456` 한 줄 + 마지막에 `PROGRAM ENDED` 를 써넣으면 폴링이 성공으로 종료된다.
- **공식 진실값 목업:** `test/level{N}/`에 작은 `L{N}_Official.cif` 와 `*Official*.inp`, 그리고 같은 `ENERGY|` 라인을 가진 공식 `.out`을 두면 비교 로직(`_extract_energy`)이 동작해 `diff`가 산출된다.
- Windows 개발 시 `nohup`/셸 폴백이 동작하지 않으므로, 로컬 검증은 **WSL/Linux 컨테이너** 또는 위 "가짜 `cp2k.popt`"를 cross-platform 파이썬 스크립트로 PATH에 올리는 방식 권장.

**프런트엔드 단독 개발:** `GET /api/benchmark/status`의 응답 예시를 정적 JSON으로 고정해 폴링 UI(12개 레벨 카드, 로그 콘솔, status/diff 컬러링)를 백엔드 없이 완성할 수 있다. `status="error"` 거절 케이스와 `Skipped`/`FAILURE`/`Recovering...` 상태도 목업에 포함할 것.

### 완료 정의 (Definition of Done)

- [ ] `POST /api/benchmark/run`이 `BenchmarkRequest`를 검증하고, **중복 실행을 거절**(`status:"error"`)하며, 정상 시 `status:"success"`로 즉시 반환한다.
- [ ] `GET /api/benchmark/status`가 `BenchmarkReport` 스키마를 정확히 반환한다(항상 12 슬롯, 누락 키 없음, 선택 키는 `.get` 처리).
- [ ] `levels`가 빈 리스트면 1~12 전체, 부분 리스트면 해당 레벨만 순회한다.
- [ ] 각 레벨이 **CIF 분석 → 플랜 → INP 빌드 → 제출 → 폴링 → (실패 시)자가치유 ×최대 3회 → 공식 대비 비교** 전 구간을 수행한다.
- [ ] `L{N}_Official.cif` 부재 시 해당 레벨이 `Skipped`로 처리되고 루프가 계속된다.
- [ ] 비교 판정이 명세대로 동작: 오차율 < 1.0% **또는** 에너지가 더 낮으면 `SUCCESS`, 그 외 계산 성공은 `INCORRECT`, 추출/타임아웃/예외는 `FAILURE`.
- [ ] `reports[i].message`에 물성 라벨·오차율·치유 횟수(`Healed Nx via <diag>`)가 일관 포맷으로 채워진다.
- [ ] 폴링 타임아웃(300×5초)·`qstat` 유예(6회)가 동작하고, qsub 부재 시 로컬 `cp2k.popt` 폴백으로 자동 전환된다.
- [ ] `logs`가 실시간 append되고 단계 전환 시 `logs_pos`가 0으로 리셋된다.
- [ ] 루프 종료 시 `status`가 `Finished`로 안착한다(치명 예외 포함).
- [ ] 위 4개 stub만으로 상위 기능(f1/f2/f3) 없이 전 구간 통과가 재현된다.

> **현 구현 주의(clean 재설계 시 정리 대상):**
> 1. `run_benchmark` 안에서 `report` 변수가 슬롯 참조 → 새 dict 재할당으로 **두 번 바뀐다**. 초기화 `report`와 실행 `report`가 분리돼 있어 `healing_count` 키가 실행 dict엔 없을 수 있다(소비자 `.get(...,0)` 폴백 전제). clean에서는 단일 dict로 통일 권장.
> 2. `finally`가 `Failure`를 `Finished`로 덮어 **치명 실패가 status에 남지 않는다**. clean에서는 실패 플래그 보존 권장.
> 3. 폴링 함수 내 예외 핸들러가 미정의 변수(`plan_res`)를 참조하는 죽은 코드가 있다 → 제거 권장.
> 4. `pending_ai_rule` 등 중복 선언 변수 정리 권장.